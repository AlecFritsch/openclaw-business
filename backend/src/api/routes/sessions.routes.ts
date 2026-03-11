import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import type { Session, Message, CreateSessionRequest, SendMessageRequest, ActivityEvent } from '@openclaw-business/shared';
import { PLAN_LIMITS, type PlanId } from '@openclaw-business/shared';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { createSessionSchema, sendMessageSchema, paginationSchema, validateObjectId } from '../../validation/schemas.js';
import { serializeDoc } from '../../utils/sanitize.js';
import { gatewayManager } from '../../services/gateway-ws.service.js';
import {
  listSessionsResponseSchema,
  getSessionResponseSchema,
  sessionMessagesResponseSchema,
  sendMessageResponseSchema,
  messageSchema,
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

/**
 * Send a message to an OpenClaw agent via the proper Gateway WebSocket protocol.
 * Uses GatewayWSClient with connect handshake, token auth, and req/res protocol.
 *
 * Note: The primary chat path is now /api/agents/:id/gateway/send (agent-gateway.routes.ts).
 * This function exists for the legacy /sessions/:id/messages endpoint.
 */
/**
 * Send a message to an OpenClaw agent and wait for the response.
 * Uses the agent.wait RPC to block until the agent finishes its turn,
 * then fetches the latest assistant message from history.
 * Falls back to polling if agent.wait is not available.
 */
async function sendToAgent(
  agentId: string,
  gatewayUrl: string,
  gatewayToken: string,
  sessionKey: string,
  content: string,
): Promise<string> {
  // Ensure we have a proper gateway connection with auth
  if (!gatewayManager.isConnected(agentId)) {
    await gatewayManager.connectAgent({
      agentId,
      url: gatewayUrl,
      token: gatewayToken,
    });
  }

  const client = gatewayManager.getClient(agentId);
  if (!client) {
    throw new Error('Failed to connect to agent gateway');
  }

  // Send via proper OpenClaw protocol (req:send with idempotency key)
  const sendResult = await client.sendMessage(sessionKey, content);
  const runId = sendResult?.runId;

  // Strategy: Try agent.wait first (blocks until turn ends), then fall back to polling
  if (runId) {
    try {
      // agent.wait blocks until the run completes (up to 60s timeout)
      await client.request('agent.wait', { runId, timeoutMs: 60000 });
    } catch {
      // agent.wait may not be available or may timeout — fall through to polling
    }
  }

  // Poll for the assistant response with exponential backoff
  // Intervals: 1s, 2s, 3s, 5s, 8s = 19s total max wait
  const pollIntervals = [1000, 2000, 3000, 5000, 8000];
  
  for (const interval of pollIntervals) {
    await new Promise(resolve => setTimeout(resolve, interval));
    
    try {
      const history = await client.getSessionHistory(sessionKey, 5);
      const lastAssistant = history
        .filter((m: any) => m.role === 'assistant' || m.from === 'assistant')
        .pop();

      if (lastAssistant?.content) {
        return lastAssistant.content;
      }
    } catch {
      // History fetch failed — retry on next interval
    }
  }

  return 'Message sent to agent. The response is still being generated — check the session for the full reply.';
}

export async function sessionsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const sessionsCollection = db.collection<Session>('sessions');
  const messagesCollection = db.collection<Message>('messages');
  const agentsCollection = db.collection('agents');
  const activityCollection = db.collection<ActivityEvent>('activity');

  // GET /api/sessions - List all sessions
  fastify.get('/', {
    schema: {
      tags: ['Sessions'],
      summary: 'List sessions',
      description: 'Returns all sessions, optionally filtered by agentId and status.',
      querystring: z.object({
        agentId: z.string().optional(),
        status: z.enum(['active', 'ended']).optional(),
        limit: z.coerce.number().min(1).max(1000).default(50).optional(),
        offset: z.coerce.number().min(0).default(0).optional(),
      }),
      response: { 200: listSessionsResponseSchema },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const { agentId, status, limit = 50, offset = 0 } = request.query as any;

    // Sessions haben kein organizationId – bei Org über agentIds filtern
    const filter: any = await (async () => {
      if (organizationId) {
        const agentIds = (await getDatabase().collection('agents').find({ organizationId }).project({ _id: 1 }).toArray())
          .map(a => a._id!.toString());
        if (agentIds.length === 0) return { _id: { $exists: false } };
        const f: any = { agentId: { $in: agentIds } };
        if (agentId) f.agentId = agentId;
        if (status) f.status = status;
        return f;
      }
      const f: any = { userId };
      if (agentId) f.agentId = agentId;
      if (status) f.status = status;
      return f;
    })();

    const sessions = await sessionsCollection
      .find(filter)
      .sort({ lastMessageAt: -1 })
      .limit(Number(limit) || 50)
      .skip(Number(offset) || 0)
      .toArray();

    const total = await sessionsCollection.countDocuments(filter);
  });

  // POST /api/sessions - Create new session
  fastify.post<{ Body: CreateSessionRequest }>('/', {
    schema: {
      tags: ['Sessions'],
      summary: 'Create session',
      description: 'Creates a new chat session for the specified agent.',
      body: createSessionSchema,
      response: {
        201: z.object({ session: getSessionResponseSchema.shape.session }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const validation = createSessionSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid request', details: validation.error.errors });
    }

    const { agentId, channelType, channelUserId, metadata } = validation.data;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agentId format' });
    }

    // Agent-Ownership: Session nur für eigene Agents
    const ownershipFilter: any = { _id: new ObjectId(agentId) };
    if (organizationId) ownershipFilter.organizationId = organizationId;
    else ownershipFilter.userId = userId;
    const agent = await getDatabase().collection('agents').findOne(ownershipFilter);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const session: Session = {
      agentId,
      userId,
      channelType,
      channelUserId,
      status: 'active',
      metadata: metadata || {},
      startedAt: new Date(),
      lastMessageAt: new Date(),
    };

    const result = await sessionsCollection.insertOne(session as any);

    // Log activity
    await activityCollection.insertOne({
      userId,
      organizationId,
      agentId,
      sessionId: result.insertedId.toString(),
      type: 'session.started',
      title: 'Session started',
      description: `New ${channelType} session started`,
      createdAt: new Date(),
    } as any);
    
    return reply.code(201).send({ 
      session: serializeDoc({ ...session, _id: result.insertedId.toString() }) 
    });
  });

  // GET /api/sessions/:id - Get session details
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Sessions'],
      summary: 'Get session by ID',
      description: 'Returns session details including metadata and status.',
      params: z.object({ id: z.string().describe('Session ID') }),
      response: {
        200: getSessionResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const session = await sessionsCollection.findOne({ _id: new ObjectId(request.params.id) as any });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    // Ownership: Agent muss User/Org gehören
    const agentFilter: any = { _id: new ObjectId(session.agentId) };
    if (organizationId) agentFilter.organizationId = organizationId;
    else agentFilter.userId = userId;
    const agent = await getDatabase().collection('agents').findOne(agentFilter);
    if (!agent) return reply.code(404).send({ error: 'Session not found' });

    return { session: serializeDoc(session) };
  });

  // GET /api/sessions/:id/messages - Get session messages
  fastify.get<{ Params: { id: string } }>('/:id/messages', {
    schema: {
      tags: ['Sessions'],
      summary: 'Get session messages',
      description: 'Returns all messages in a session, ordered chronologically. Supports pagination.',
      params: z.object({ id: z.string().describe('Session ID') }),
      querystring: z.object({
        limit: z.coerce.number().min(1).max(1000).default(100).optional(),
        offset: z.coerce.number().min(0).default(0).optional(),
      }),
      response: {
        200: sessionMessagesResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const { limit = 100, offset = 0 } = request.query as any;

    const session = await sessionsCollection.findOne({ _id: new ObjectId(request.params.id) as any });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    // Ownership: Agent muss User/Org gehören
    const agentFilter: any = { _id: new ObjectId(session.agentId) };
    if (organizationId) agentFilter.organizationId = organizationId;
    else agentFilter.userId = userId;
    const agent = await getDatabase().collection('agents').findOne(agentFilter);
    if (!agent) return reply.code(404).send({ error: 'Session not found' });

    const messages = await messagesCollection
      .find({ sessionId: request.params.id })
      .sort({ createdAt: 1 })
      .limit(Number(limit) || 100)
      .skip(Number(offset) || 0)
      .toArray();

    const total = await messagesCollection.countDocuments({ sessionId: request.params.id });

    return { messages: messages.map(serializeDoc), total };
  });

  // POST /api/sessions/:id/messages - Send message to agent
  // DEPRECATED: Use POST /api/agents/:id/gateway/send for new integrations.
  // This endpoint maps MongoDB session IDs to OpenClaw sessionKey (session_${id}) which may not exist on the gateway.
  // The workspace chat uses gateway routes exclusively.
  fastify.post<{ Params: { id: string }; Body: SendMessageRequest }>('/:id/messages', {
    schema: {
      tags: ['Sessions'],
      summary: 'Send message (deprecated)',
      description: '[DEPRECATED] Use POST /api/agents/:id/gateway/send instead. This endpoint maps MongoDB session IDs to OpenClaw and may fail if the session key does not exist on the gateway. Waits for the agent to complete its turn (up to ~19s).',
      params: z.object({ id: z.string().describe('Session ID') }),
      body: sendMessageSchema,
      response: {
        200: z.object({ message: messageSchema }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('sessions.send'),
  }, async (request, reply) => {
    reply.header('Deprecation', 'true');
    reply.header('Sunset', 'Use /api/agents/:id/gateway/send for OpenClaw integration.');
    const userId = request.userId;
    const organizationId = request.organizationId;

    // ── Trial Expiration Check ─────────────────────────────────────────
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Trial expired',
        message: 'Your 7-day trial has expired. Upgrade to Professional to continue.',
      });
    }

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const validation = sendMessageSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid request', details: validation.error.errors });
    }

    const { content } = validation.data;

    const session = await sessionsCollection.findOne({ _id: new ObjectId(request.params.id) as any });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const agentFilter: any = { _id: new ObjectId(session.agentId) };
    if (organizationId) agentFilter.organizationId = organizationId;
    else agentFilter.userId = userId;
    const owningAgent = await agentsCollection.findOne(agentFilter);
    if (!owningAgent) return reply.code(404).send({ error: 'Session not found' });

    // ── Message Quota Check ────────────────────────────────────────────
    const plan = (request.plan || 'unpaid') as PlanId;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.unpaid;
    if (limits.messagesPerAgent > 0) {
      // Use gateway-synced message count (real channel messages) if available
      const gatewayMsgs = (owningAgent as any).metrics?.gatewayMessages || 0;
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const workspaceMsgs = await messagesCollection.countDocuments({
        agentId: session.agentId,
        createdAt: { $gte: startOfMonth },
      });
      const monthlyMessages = Math.max(gatewayMsgs, workspaceMsgs);
      if (monthlyMessages >= limits.messagesPerAgent) {
        return reply.code(403).send({
          error: 'Message quota exceeded',
          message: `Your ${plan} plan allows ${limits.messagesPerAgent} messages per agent per month.`,
          used: monthlyMessages,
          limit: limits.messagesPerAgent,
        });
      }
    }

    // Save user message
    const userMessage: Message = {
      sessionId: request.params.id,
      agentId: session.agentId,
      role: 'user',
      content,
      createdAt: new Date(),
    };

    await messagesCollection.insertOne(userMessage as any);

    // Get the agent to find its gateway URL (already verified above as owningAgent)
    const agent = owningAgent;

    let assistantContent: string;
    let responseMetadata: Message['metadata'] = {};

    if (agent?.gatewayUrl && agent?.gatewayToken && agent.status === 'running') {
      // Send to real OpenClaw agent via proper Gateway WebSocket protocol
      try {
        const startTime = Date.now();
        // Use the session's agentId as the session key for OpenClaw
        const sessionKey = `session_${request.params.id}`;
        assistantContent = await sendToAgent(
          session.agentId,
          agent.gatewayUrl,
          agent.gatewayToken,
          sessionKey,
          content,
        );
        const latency = Date.now() - startTime;

        // Model-aware cost estimation
        // Pricing per 1M tokens (input/output)
        const modelPricing: Record<string, { input: number; output: number }> = {
          // Anthropic
          'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
          'claude-opus-4-6': { input: 15.00, output: 75.00 },
          // OpenAI
          'gpt-5-mini': { input: 0.15, output: 0.60 },
          'gpt-5.2': { input: 2.50, output: 10.00 },
          'o1': { input: 15.00, output: 60.00 },
          // Google
          'gemini-3-flash': { input: 0.075, output: 0.30 },
          'gemini-3-pro': { input: 1.25, output: 10.00 },
          // Z.AI
          'glm-4.7': { input: 0.50, output: 2.00 },
          'glm-5': { input: 1.00, output: 4.00 },
        };

        const agentModel = agent.config?.model || 'unknown';
        const modelKey = Object.keys(modelPricing).find(k => agentModel.includes(k));
        const pricing = modelKey ? modelPricing[modelKey] : { input: 3.00, output: 15.00 };

        const inputTokens = Math.ceil(content.length / 4);
        const outputTokens = Math.ceil(assistantContent.length / 4);
        const estimatedCost = (inputTokens * pricing.input / 1_000_000) + (outputTokens * pricing.output / 1_000_000);

        responseMetadata = {
          model: agentModel,
          tokens: inputTokens + outputTokens,
          inputTokens,
          outputTokens,
          cost: Math.round(estimatedCost * 10000) / 10000,
          latency,
        };
      } catch (error) {
        // If agent communication fails, return error message
        assistantContent = `I'm currently unable to process your request. The agent may be experiencing issues. Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        responseMetadata = { model: 'error' };
      }
    } else {
      // Agent not running or no gateway URL
      assistantContent = agent?.status === 'stopped'
        ? 'This agent is currently paused. Please resume the agent to continue the conversation.'
        : 'This agent is not available. Please check the agent status and try again.';
      responseMetadata = { model: 'system' };
    }

    const assistantMessage: Message = {
      sessionId: request.params.id,
      agentId: session.agentId,
      role: 'assistant',
      content: assistantContent,
      metadata: responseMetadata,
      createdAt: new Date(),
    };

    await messagesCollection.insertOne(assistantMessage as any);

    // Update session last message time
    await sessionsCollection.updateOne(
      { _id: new ObjectId(request.params.id) } as any,
      { $set: { lastMessageAt: new Date() } }
    );

    // Update agent metrics (including token tracking)
    if (agent) {
      await agentsCollection.updateOne(
        { _id: new ObjectId(session.agentId) } as any,
        {
          $inc: {
            'metrics.totalMessages': 2,
            'metrics.totalCost': responseMetadata.cost || 0,
            'metrics.totalInputTokens': responseMetadata.inputTokens || 0,
            'metrics.totalOutputTokens': responseMetadata.outputTokens || 0,
            'metrics.totalTokens': responseMetadata.tokens || 0,
          },
          $set: {
            'metrics.lastActive': new Date(),
            updatedAt: new Date(),
          },
        }
      );
    }

    return { message: serializeDoc(assistantMessage) };
  });

  // POST /api/sessions/:id/end - End session
  fastify.post<{ Params: { id: string } }>('/:id/end', {
    schema: {
      tags: ['Sessions'],
      summary: 'End session',
      description: 'Marks the session as ended. No further messages can be sent.',
      params: z.object({ id: z.string().describe('Session ID') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const session = await sessionsCollection.findOne({ _id: new ObjectId(request.params.id) as any });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const agentFilter: any = { _id: new ObjectId(session.agentId) };
    if (organizationId) agentFilter.organizationId = organizationId;
    else agentFilter.userId = userId;
    if (!(await agentsCollection.findOne(agentFilter))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    await sessionsCollection.updateOne(
      { _id: new ObjectId(request.params.id) as any },
      { $set: { status: 'ended', endedAt: new Date() } }
    );

    // Log activity
    await activityCollection.insertOne({
      userId,
      organizationId: request.organizationId,
      agentId: session.agentId,
      sessionId: request.params.id,
      type: 'session.ended',
      title: 'Session ended',
      description: `${session.channelType} session ended`,
      createdAt: new Date(),
    } as any);

    return { success: true };
  });
}
