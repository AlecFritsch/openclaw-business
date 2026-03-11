import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import scalarPlugin from '@scalar/fastify-api-reference';
import { fastifyZodOpenApiPlugin, validatorCompiler, serializerCompiler } from 'fastify-zod-openapi';
import { config } from './config/env.js';
import { swaggerConfig } from './config/openapi.js';
import { connectDatabase, closeDatabase, runMigrations, getDatabase } from './config/database.js';
import { ObjectId } from 'mongodb';
import { seedTemplates } from './seeds/templates.js';
import { agentRoutes } from './api/routes/agent.routes.js';
import { agentAnalyticsRoutes } from './api/routes/agent-analytics.routes.js';
import { agentConfigRoutes } from './api/routes/agent-config.routes.js';
import { agentTeamRoutes } from './api/routes/agent-team.routes.js';
import { analyticsRoutes } from './api/routes/analytics.routes.js';
import { logsRoutes } from './api/routes/logs.routes.js';
import { webhooksRoutes } from './api/routes/webhooks.routes.js';
import { superchatWebhookRoutes } from './api/routes/superchat-webhook.routes.js';
import { internalSuperchatRoutes } from './api/routes/internal-superchat.routes.js';
import { internalKnowledgeRoutes } from './api/routes/internal-knowledge.routes.js';
import { internalMcpProxyRoutes } from './api/routes/internal-mcp-proxy.routes.js';
import { userWebhooksRoutes } from './api/routes/user-webhooks.routes.js';
import { sessionsRoutes } from './api/routes/sessions.routes.js';
import { channelsRoutes } from './api/routes/channels.routes.js';
import { usersRoutes } from './api/routes/users.routes.js';
import { organizationRoutes } from './api/routes/organization.routes.js';
import { billingRoutes } from './api/routes/billing.routes.js';
import { recoveryService } from './services/recovery.service.js';
import { operationsRoutes } from './api/routes/operations.routes.js';
import { activityRoutes } from './api/routes/activity.routes.js';
import { templatesRoutes } from './api/routes/templates.routes.js';
import { providersRoutes } from './api/routes/providers.routes.js';
import { supportRoutes } from './api/routes/support.routes.js';
import aiRoutes from './api/routes/ai.routes.js';
import { agentChannelsRoutes } from './api/routes/agent-channels.routes.js';
import { agentSkillsRoutes } from './api/routes/agent-skills.routes.js';
import { agentGatewayRoutes } from './api/routes/agent-gateway.routes.js';
import { agentAdvancedRoutes } from './api/routes/agent-advanced.routes.js';
import { agentWorkspaceRoutes } from './api/routes/agent-workspace.routes.js';
import { agentWorkflowsRoutes } from './api/routes/agent-workflows.routes.js';
import { workflowGenerateRoutes } from './api/routes/workflow-generate.routes.js';
import { missionRoutes, missionWebhookPublicRoutes } from './api/routes/mission.routes.js';
import { matchChannelMessage } from './services/mission-engine.service.js';
import { contactsRoutes } from './api/routes/contacts.routes.js';
import { eventsRoutes } from './api/routes/events.routes.js';
import { auditRoutes } from './api/routes/audit.routes.js';
import { approvalRoutes } from './api/routes/approval.routes.js';
import { invitationsRoutes } from './api/routes/invitations.routes.js';
import { knowledgeRoutes } from './api/routes/knowledge.routes.js';
import { knowledgeIntegrationRoutes, knowledgeOAuthCallbackRoutes } from './api/routes/knowledge-integrations.routes.js';
import { chatRoutes } from './api/routes/chat.routes.js';
import { smitheryRoutes } from './api/routes/smithery.routes.js';
import { smitheryIconRoutes } from './api/routes/smithery-icon.routes.js';
import rawBody from 'fastify-raw-body';
import websocket from '@fastify/websocket';
import { errorHandler } from './middleware/error.middleware.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { auditPlugin } from './middleware/audit.plugin.js';
import { clawHubService } from './services/clawhub.service.js';
import { gatewayManager } from './services/gateway-ws.service.js';
import { auditService } from './services/audit.service.js';
import { approvalService } from './services/approval.service.js';
import { gatewayMetricsSync } from './services/gateway-metrics.service.js';
import { startCrawlScheduler } from './services/crawl-scheduler.service.js';

// ── App Factory ─────────────────────────────────────────────────
// Exported for testing: tests can call buildApp() + app.inject() without starting a server.

export interface BuildAppOptions {
  /** Override the auth middleware (e.g. for test auth bypass) */
  authHook?: typeof authMiddleware;
  /** Skip rate-limiting (useful in tests) */
  skipRateLimit?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : config.nodeEnv === 'production' ? 'info' : 'debug',
      transport: config.nodeEnv === 'development' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      } : undefined,
    },
  });

  // Error handler
  fastify.setErrorHandler(errorHandler);

  // Zod-OpenAPI type provider (validator compiler + OpenAPI plugin)
  fastify.setValidatorCompiler(validatorCompiler);

  fastify.setSerializerCompiler(() => {
    return (data) => JSON.stringify(data);
  });
  await fastify.register(fastifyZodOpenApiPlugin);

  // OpenAPI spec generation (@fastify/swagger)
  await fastify.register(fastifySwagger, swaggerConfig);

  // WebSocket support (for node relay)
  await fastify.register(websocket);

  // Sensible defaults (better error responses)
  await fastify.register(sensible);

  // Multipart file uploads (for knowledge base document upload)
  await fastify.register((await import('@fastify/multipart')).default, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20 MB max
      files: 1,
    },
  });

  // Raw body access (needed for Stripe webhook signature verification)
  await fastify.register(rawBody, {
    field: 'rawBody',
    global: false,        // only on routes that opt-in via { config: { rawBody: true } }
    runFirst: true,
  });

  // Security middleware
  await fastify.register(helmet, {
    contentSecurityPolicy: config.nodeEnv === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://*.clerk.accounts.dev", "https://*.clerk.dev", "https://challenges.cloudflare.com", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://img.clerk.com", "https://ucarecdn.com"],
        connectSrc: ["'self'", "https://*.clerk.accounts.dev", "https://*.clerk.dev", "https://api.clerk.com", "wss:"],
        frameSrc: ["'self'", "https://*.clerk.accounts.dev", "https://challenges.cloudflare.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    } : false,
  });

  await fastify.register(cors, {
    origin: config.nodeEnv === 'production'
      ? [config.frontendUrl, 'https://localhost:3000', 'http://localhost:3000']
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  });

  if (!opts.skipRateLimit) {
    await fastify.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute',
    });
  }

  // Health check (includes DB probe)
  fastify.get('/health', async (_req, reply) => {
    try {
      const db = getDatabase();
      await db.command({ ping: 1 });
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: 'degraded', reason: 'database unreachable', timestamp: new Date().toISOString() });
    }
  });

  fastify.get('/api/health', async (_req, reply) => {
    try {
      const db = getDatabase();
      await db.command({ ping: 1 });
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: 'degraded', reason: 'database unreachable', timestamp: new Date().toISOString() });
    }
  });

  // Register API Routes
  // Webhooks + internal (no Clerk auth — verified by provider or X-Gateway-Token)
  await fastify.register(webhooksRoutes, { prefix: '/api/webhooks' });
  await fastify.register(superchatWebhookRoutes, { prefix: '/api/webhooks' });
  await fastify.register(missionWebhookPublicRoutes, { prefix: '/api/public/agents' });
  await fastify.register(internalSuperchatRoutes, { prefix: '/api/internal' });
  await fastify.register(internalKnowledgeRoutes, { prefix: '/api/internal' });
  await fastify.register(internalMcpProxyRoutes, { prefix: '/api/internal' });

  // Admin routes (secured by X-Admin-Key header, no Clerk auth)
  const { adminRoutes } = await import('./api/routes/admin.routes.js');
  await fastify.register(adminRoutes, { prefix: '/api/admin' });

  // Public OAuth callback routes (no auth — called by provider redirects)
  await fastify.register(knowledgeOAuthCallbackRoutes, { prefix: '/api/knowledge' });

  // Smithery icon proxy — public (img tags send no Authorization header)
  await fastify.register(smitheryIconRoutes, { prefix: '/api/smithery' });

  // All other routes require authentication
  const authHook = opts.authHook || authMiddleware;
  await fastify.register(async (authenticatedRoutes) => {
    authenticatedRoutes.addHook('onRequest', authHook);
    await authenticatedRoutes.register(auditPlugin);

    await authenticatedRoutes.register(usersRoutes, { prefix: '/api/users' });
    await authenticatedRoutes.register(agentRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentAnalyticsRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentConfigRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentChannelsRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentTeamRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentSkillsRoutes, { prefix: '/api/skills' });
    await authenticatedRoutes.register(agentGatewayRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentAdvancedRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentWorkspaceRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(agentWorkflowsRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(workflowGenerateRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(missionRoutes, { prefix: '/api/agents' });
    await authenticatedRoutes.register(sessionsRoutes, { prefix: '/api/sessions' });
    await authenticatedRoutes.register(channelsRoutes, { prefix: '/api/channels' });
    await authenticatedRoutes.register(analyticsRoutes, { prefix: '/api/analytics' });
    await authenticatedRoutes.register(logsRoutes, { prefix: '/api/logs' });
    await authenticatedRoutes.register(userWebhooksRoutes, { prefix: '/api/webhooks' });
    await authenticatedRoutes.register(organizationRoutes, { prefix: '/api/organization' });
    await authenticatedRoutes.register(billingRoutes, { prefix: '/api/billing' });
    await authenticatedRoutes.register(operationsRoutes, { prefix: '/api/operations' });
    await authenticatedRoutes.register(activityRoutes, { prefix: '/api/activity' });
    await authenticatedRoutes.register(templatesRoutes, { prefix: '/api/templates' });
    await authenticatedRoutes.register(providersRoutes, { prefix: '/api/providers' });
    await authenticatedRoutes.register(supportRoutes, { prefix: '/api/support' });
    await authenticatedRoutes.register(aiRoutes, { prefix: '/api/ai' });
    await authenticatedRoutes.register(contactsRoutes, { prefix: '/api/contacts' });
    await authenticatedRoutes.register(eventsRoutes, { prefix: '/api/events' });
    await authenticatedRoutes.register(auditRoutes, { prefix: '/api/audit' });
    await authenticatedRoutes.register(approvalRoutes, { prefix: '/api/approvals' });
    await authenticatedRoutes.register(invitationsRoutes, { prefix: '/api/invitations' });
    await authenticatedRoutes.register(knowledgeRoutes, { prefix: '/api/knowledge' });
    await authenticatedRoutes.register(knowledgeIntegrationRoutes, { prefix: '/api/knowledge' });
    await authenticatedRoutes.register(chatRoutes, { prefix: '/api/chat' });
    await authenticatedRoutes.register(smitheryRoutes, { prefix: '/api/smithery' });
  });

  // ── OpenAPI Spec + Scalar Docs UI ──────────────────────────────
  // Disabled in production to avoid exposing API structure.
  if (config.nodeEnv !== 'production') {
    fastify.get('/api/openapi.json', async (_request, reply) => {
      try {
        const spec = fastify.swagger();
        return spec;
      } catch (err) {
        fastify.log.error(err, '[openapi] Failed to generate OpenAPI spec');
        return reply.code(500).send({ error: 'OpenAPI spec generation failed', message: (err as Error).message });
      }
    });

    await fastify.register(scalarPlugin, {
      routePrefix: '/api/docs',
      configuration: {
        theme: 'kepler',
        spec: {
          url: '/api/openapi.json',
        },
      } as Record<string, unknown>,
    });
  }

  return fastify;
}

// ── Server Start ────────────────────────────────────────────────
// Only runs when this file is the entry point (not when imported by tests).

async function start() {
  try {
    // Connect to MongoDB FIRST
    await connectDatabase();

    // Run idempotent data migrations (e.g. backfill trial dates)
    await runMigrations().catch((err) => console.warn('[migration] Migration failed:', err));

    // Seed initial template data if collections are empty
    await seedTemplates().catch((err) => console.warn('[seed] Template seeding failed:', err));

    const fastify = await buildApp();

    // Ensure MongoDB indexes and start the ClawHub security re-scanner
    await clawHubService.ensureIndexes();
    await auditService.ensureIndexes();
    await approvalService.ensureIndexes();
    clawHubService.startRescanTimer();

    // When a gateway connects, install any configured skills (fixes deploy race: container ~45s boot vs 3s auto-install)
    gatewayManager.on('agent_connected', (agentId) => {
      clawHubService.installSkillsWhenGatewayReady(agentId).catch(err =>
        console.warn('[clawhub] Gateway-ready skill install failed for', agentId, err instanceof Error ? err.message : err)
      );
    });

    // Log + persist agent health degradation (container disconnects)
    gatewayManager.on('agent_health_degraded', (agentId) => {
      console.error(`[health] Agent ${agentId} health degraded — gateway disconnected`);
      const db = getDatabase();
      db.collection('agents').updateOne(
        { _id: new ObjectId(agentId) },
        { $set: { lastHealthEvent: { status: 'degraded', at: new Date() } } },
      ).catch(err => console.warn('[health] Failed to persist health event:', err instanceof Error ? err.message : err));
    });

    // Mission Engine: route incoming channel messages to matching missions
    gatewayManager.on('gateway_event', (data: { agentId: string; event: string; payload: any }) => {
      if (data.event !== 'message:received' && data.event !== 'message:preprocessed') return;
      const p = data.payload || {};
      const message = p.content || p.bodyForAgent || p.body || '';
      const channel = p.channelId || '';
      const sender = p.from || p.metadata?.senderName || '';
      if (!message || !channel) return;
      matchChannelMessage(data.agentId, message, channel, sender).catch(err =>
        console.warn('[missions] Channel message match failed:', err instanceof Error ? err.message : err)
      );
    });

    // Start gateway metrics sync (polls gateways every 60s)
    gatewayMetricsSync.start();

    // Auto-connect all running agents to their gateways on startup
    (async () => {
      try {
        const db = getDatabase();
        const agents = await db.collection('agents').find(
          { status: 'running', gatewayUrl: { $exists: true }, gatewayToken: { $exists: true } },
          { projection: { _id: 1, gatewayUrl: 1, gatewayToken: 1 } },
        ).toArray();
        if (!agents.length) return;
        console.log(`[startup] Connecting ${agents.length} running agent(s) to gateways`);

        // Staggered connect: max 5 concurrent, 200ms between batches to avoid thundering herd
        const CONCURRENCY = 5;
        for (let i = 0; i < agents.length; i += CONCURRENCY) {
          const batch = agents.slice(i, i + CONCURRENCY);
          await Promise.allSettled(batch.map(agent =>
            gatewayManager.connectAgent({
              agentId: agent._id.toString(),
              url: agent.gatewayUrl,
              token: agent.gatewayToken,
            }).catch(err => console.warn(`[startup] Gateway connect failed for ${agent._id}:`, err instanceof Error ? err.message : err))
          ));
          if (i + CONCURRENCY < agents.length) await new Promise(r => setTimeout(r, 200));
        }
        console.log(`[startup] Gateway connect phase done (${agents.length} agents)`);
      } catch (err) {
        console.warn('[startup] Failed to auto-connect agents:', err instanceof Error ? err.message : err);
      }
    })();

    // Start crawl scheduler (checks for due re-crawls every 60s)
    startCrawlScheduler();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      fastify.log.info(`Received ${signal}, shutting down gracefully`);
      try {
        gatewayMetricsSync.stop();
        clawHubService.stopRescanTimer();
        recoveryService.stop();
        await fastify.close();
        await closeDatabase();
        process.exit(0);
      } catch (err) {
        fastify.log.error(err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Start automatic recovery service
    recoveryService.start();

    // Start server
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    fastify.log.info(`Backend running on port ${config.port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// Start server unless in test environment
if (process.env.NODE_ENV !== 'test') {
  start();
}
