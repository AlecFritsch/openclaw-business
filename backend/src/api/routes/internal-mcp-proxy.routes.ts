// Internal MCP Proxy — called by havoc-mcp plugin from agent containers
// Auth: X-Gateway-Token must match agent's gatewayToken
// Proxies MCP tool list + tool calls via Smithery Connect

import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../../config/database.js';
import { config } from '../../config/env.js';

async function resolveAgent(token: string, agentId: string): Promise<{ organizationId: string } | { error: string; code: number }> {
  const db = getDatabase();
  let oid: ObjectId;
  try { oid = new ObjectId(agentId); } catch { return { error: 'Invalid agentId', code: 400 }; }
  const agent = await db.collection('agents').findOne(
    { _id: oid, gatewayToken: token },
    { projection: { organizationId: 1, status: 1 } },
  );
  if (!agent) return { error: 'Invalid or expired gateway token', code: 401 };
  if (agent.status !== 'running') return { error: 'Agent is not running', code: 400 };
  const organizationId = agent.organizationId as string;
  if (!organizationId) return { error: 'Agent has no organization', code: 400 };
  return { organizationId };
}

export async function internalMcpProxyRoutes(fastify: FastifyInstance) {
  // GET /api/internal/mcp-proxy/tools — list MCP tools for agent's org connections
  fastify.get<{ Querystring: { agentId: string } }>('/mcp-proxy/tools', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });

    const resolved = await resolveAgent(token, agentId);
    if ('error' in resolved) return reply.code(resolved.code).send({ error: resolved.error });

    if (!config.smitheryApiKey) {
      return reply.code(503).send({ error: 'Smithery not configured' });
    }

    const db = getDatabase();
    const connections = await db.collection('smithery_connections')
      .find({ organizationId: resolved.organizationId, status: 'connected' })
      .toArray();

    const namespace = `havoc-${resolved.organizationId}`;
    const tools: Array<{ connectionId: string; mcpName: string; name: string; description?: string; parameters?: object }> = [];

    const Smithery = (await import('@smithery/api')).default;
    const smithery = new Smithery({ apiKey: config.smitheryApiKey });

    for (const conn of connections) {
      try {
        const res = await (smithery.connections.mcp as any).call(conn.connectionId, {
          namespace,
          method: 'tools/list',
          params: {},
        });
        const list = (res?.result as { tools?: Array<{ name: string; description?: string; inputSchema?: object }> })?.tools ?? [];
        const mcpName = (conn.mcpName || conn.connectionId).replace(/\W+/g, '_').toLowerCase();
        for (const t of list) {
          tools.push({
            connectionId: conn.connectionId,
            mcpName,
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          });
        }
      } catch (err) {
        fastify.log.warn({ err, connectionId: conn.connectionId }, 'MCP tools/list failed');
      }
    }

    return { tools };
  });

  // POST /api/internal/mcp-proxy/call — execute MCP tool
  fastify.post<{
    Body: { agentId: string; connectionId: string; tool: string; args: Record<string, unknown> };
  }>('/mcp-proxy/call', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, connectionId, tool, args } = request.body;
    if (!agentId || !connectionId || !tool) return reply.code(400).send({ error: 'agentId, connectionId, tool required' });

    const resolved = await resolveAgent(token, agentId);
    if ('error' in resolved) return reply.code(resolved.code).send({ error: resolved.error });

    const db = getDatabase();
    const conn = await db.collection('smithery_connections').findOne({
      connectionId,
      organizationId: resolved.organizationId,
      status: 'connected',
    });
    if (!conn) return reply.code(403).send({ error: 'Connection not found or not connected' });

    if (!config.smitheryApiKey) return reply.code(503).send({ error: 'Smithery not configured' });

    const Smithery = (await import('@smithery/api')).default;
    const smithery = new Smithery({ apiKey: config.smitheryApiKey });
    const namespace = `havoc-${resolved.organizationId}`;

    try {
      const res = await (smithery.connections.mcp as any).call(connectionId, {
        namespace,
        method: 'tools/call',
        params: { name: tool, arguments: args || {} },
      });
      const result = res?.result as { content?: Array<{ type?: string; text?: string }> } | undefined;
      const content = result?.content ?? [];
      const textParts = content.filter((c: { type?: string }) => c.type === 'text').map((c: { text?: string }) => c.text || '');
      return { content: textParts.join('\n') || JSON.stringify(res?.result ?? {}) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'MCP call failed';
      fastify.log.warn({ err, connectionId, tool }, 'MCP tools/call failed');
      return reply.code(500).send({ error: msg });
    }
  });
}
