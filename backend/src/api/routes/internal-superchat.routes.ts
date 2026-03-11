// Internal API — called by agent containers (superchat_send plugin)
// Auth: X-Gateway-Token must match agent's gatewayToken

import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../../config/database.js';
import { decrypt } from '../../utils/encryption.js';
import { sendMessageViaSuperchat, listSuperchatChannels } from '../../services/superchat-bridge.service.js';

/** Resolve decrypted Superchat API key for an agent. Returns null on failure. */
async function resolveApiKey(agentId: string, token: string): Promise<{ apiKey: string } | { error: string; code: number }> {
  const db = getDatabase();
  let oid: ObjectId;
  try { oid = new ObjectId(agentId); } catch { return { error: 'Invalid agentId', code: 400 }; }
  const agent = await db.collection('agents').findOne({ _id: oid, gatewayToken: token }, { projection: { status: 1 } });
  if (!agent) return { error: 'Invalid or expired gateway token', code: 401 };
  if (agent.status !== 'running') return { error: 'Agent is not running', code: 400 };
  const channel = await db.collection('agent_channels').findOne({ agentId, type: 'superchat' }, { projection: { credentials: 1 } });
  if (!channel?.credentials?.encrypted) return { error: 'Superchat not configured', code: 400 };
  try {
    const creds = JSON.parse(decrypt(channel.credentials.encrypted));
    if (!creds.apiKey) return { error: 'Superchat API key missing', code: 400 };
    return { apiKey: creds.apiKey };
  } catch { return { error: 'Failed to decrypt credentials', code: 500 }; }
}

const SUPERCHAT_API_BASE = process.env.SUPERCHAT_API_BASE_URL || 'https://api.superchat.com';

export async function internalSuperchatRoutes(fastify: FastifyInstance) {
  // POST /api/internal/superchat/send — agent-initiated proactive send
  fastify.post<{
    Body: {
      agentId: string;
      contactIdentifier: string;
      channelId: string;
      text: string;
    };
  }>('/superchat/send', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
    schema: {
      tags: ['Internal'],
      summary: 'Proactive Superchat send (agent tool)',
      description: 'Called by superchat_send tool from agent container. Validates X-Gateway-Token.',
      body: {
        type: 'object',
        required: ['agentId', 'contactIdentifier', 'channelId', 'text'],
        properties: {
          agentId: { type: 'string' },
          contactIdentifier: { type: 'string' },
          channelId: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, contactIdentifier, channelId, text } = request.body;
    if (!agentId || !contactIdentifier || !channelId || !text) return reply.code(400).send({ error: 'agentId, contactIdentifier, channelId, text required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      await sendMessageViaSuperchat(result.apiKey, contactIdentifier, channelId, text);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      request.log.warn({ err, agentId }, 'superchat_send failed');
      return reply.code(500).send({ error: msg });
    }
  });

  // GET /api/internal/superchat/conversations — list recent conversations
  fastify.get<{ Querystring: { agentId: string; limit?: string } }>('/superchat/conversations', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, limit } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const l = Math.min(parseInt(limit || '20', 10) || 20, 100);
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/conversations?limit=${l}&sort=-updated_at`, {
        headers: { 'X-API-KEY': result.apiKey },
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/internal/superchat/messages — list messages in a conversation
  fastify.get<{ Querystring: { agentId: string; conversationId: string; limit?: string } }>('/superchat/messages', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, conversationId, limit } = request.query;
    if (!agentId || !conversationId) return reply.code(400).send({ error: 'agentId and conversationId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const l = Math.min(parseInt(limit || '20', 10) || 20, 100);
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/conversations/${conversationId}/messages?limit=${l}`, {
        headers: { 'X-API-KEY': result.apiKey },
      });
      if (res.status === 403) return reply.code(403).send({ error: 'ENTERPRISE_REQUIRED: Nachrichten-Inhalte lesen erfordert Superchat Enterprise. Upgrade im Superchat-Dashboard unter Einstellungen → Abo.' });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/internal/superchat/contacts — list contacts
  fastify.get<{ Querystring: { agentId: string; limit?: string; next?: string } }>('/superchat/contacts', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, limit, next } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const l = Math.min(parseInt(limit || '20', 10) || 20, 100);
      const params = new URLSearchParams({ limit: String(l) });
      if (next) params.set('next', next);
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/contacts?${params}`, {
        headers: { 'X-API-KEY': result.apiKey },
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // POST /api/internal/superchat/contacts/search — search contacts by email/phone
  fastify.post<{ Body: { agentId: string; field: string; value: string } }>('/superchat/contacts/search', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, field, value } = request.body;
    if (!agentId || !field || !value) return reply.code(400).send({ error: 'agentId, field, value required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/contacts/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': result.apiKey },
        body: JSON.stringify({ query: { value: [{ field, operator: '=', value }] } }),
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/internal/superchat/contacts/:contactId — get single contact
  fastify.get<{ Params: { contactId: string }; Querystring: { agentId: string } }>('/superchat/contacts/:contactId', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    const { contactId } = request.params;
    if (!agentId || !contactId) return reply.code(400).send({ error: 'agentId and contactId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/contacts/${contactId}`, {
        headers: { 'X-API-KEY': result.apiKey },
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/internal/superchat/contacts/:contactId/conversations — conversations for a contact
  fastify.get<{ Params: { contactId: string }; Querystring: { agentId: string } }>('/superchat/contacts/:contactId/conversations', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    const { contactId } = request.params;
    if (!agentId || !contactId) return reply.code(400).send({ error: 'agentId and contactId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/contacts/${contactId}/conversations`, {
        headers: { 'X-API-KEY': result.apiKey },
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/internal/superchat/channels — list connected Superchat channels
  fastify.get<{ Querystring: { agentId: string } }>('/superchat/channels', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const channels = await listSuperchatChannels(result.apiKey);
      return { channels };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/internal/superchat/conversations/:conversationId — single conversation detail
  fastify.get<{ Params: { conversationId: string }; Querystring: { agentId: string } }>('/superchat/conversations/:conversationId', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    const { conversationId } = request.params;
    if (!agentId || !conversationId) return reply.code(400).send({ error: 'agentId and conversationId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/conversations/${conversationId}`, { headers: { 'X-API-KEY': result.apiKey } });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // PATCH /api/internal/superchat/conversations/:conversationId — update conversation status
  fastify.patch<{ Params: { conversationId: string }; Body: { agentId: string; status?: string } }>('/superchat/conversations/:conversationId', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, ...updateData } = request.body;
    const { conversationId } = request.params;
    if (!agentId || !conversationId) return reply.code(400).send({ error: 'agentId and conversationId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/conversations/${conversationId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-API-KEY': result.apiKey }, body: JSON.stringify(updateData),
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // DELETE /api/internal/superchat/conversations/:conversationId
  fastify.delete<{ Params: { conversationId: string }; Querystring: { agentId: string } }>('/superchat/conversations/:conversationId', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    const { conversationId } = request.params;
    if (!agentId || !conversationId) return reply.code(400).send({ error: 'agentId and conversationId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/conversations/${conversationId}`, {
        method: 'DELETE', headers: { 'X-API-KEY': result.apiKey },
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json().catch(() => ({ ok: true }));
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // POST /api/internal/superchat/contacts/create
  fastify.post<{ Body: { agentId: string; first_name?: string; last_name?: string; handles?: Array<{ type: string; value: string }> } }>('/superchat/contacts/create', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, ...contactData } = request.body;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': result.apiKey }, body: JSON.stringify(contactData),
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // PATCH /api/internal/superchat/contacts/:contactId — update contact
  fastify.patch<{ Params: { contactId: string }; Body: { agentId: string; first_name?: string; last_name?: string; gender?: string; handles?: Array<{ type: string; value: string }>; custom_attributes?: Array<{ id: string; value: string }> } }>('/superchat/contacts/:contactId', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, ...updateData } = request.body;
    const { contactId } = request.params;
    if (!agentId || !contactId) return reply.code(400).send({ error: 'agentId and contactId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/contacts/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-API-KEY': result.apiKey }, body: JSON.stringify(updateData),
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // DELETE /api/internal/superchat/contacts/:contactId
  fastify.delete<{ Params: { contactId: string }; Querystring: { agentId: string } }>('/superchat/contacts/:contactId', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    const { contactId } = request.params;
    if (!agentId || !contactId) return reply.code(400).send({ error: 'agentId and contactId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/contacts/${contactId}`, {
        method: 'DELETE', headers: { 'X-API-KEY': result.apiKey },
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json().catch(() => ({ ok: true }));
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/internal/superchat/templates
  fastify.get<{ Querystring: { agentId: string } }>('/superchat/templates', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/templates`, { headers: { 'X-API-KEY': result.apiKey } });
      if (!res.ok) return reply.code(res.status).send({ error: `Superchat API ${res.status}` });
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // POST /api/internal/superchat/messages/template — send WhatsApp template message
  fastify.post<{ Body: { agentId: string; contactIdentifier: string; channelId: string; templateName: string; templateLanguage: string; variables?: string[] } }>('/superchat/messages/template', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });
    const { agentId, contactIdentifier, channelId, templateName, templateLanguage, variables } = request.body;
    if (!agentId || !contactIdentifier || !channelId || !templateName || !templateLanguage) return reply.code(400).send({ error: 'agentId, contactIdentifier, channelId, templateName, templateLanguage required' });
    const result = await resolveApiKey(agentId, token);
    if ('error' in result) return reply.code(result.code).send({ error: result.error });
    try {
      const res = await fetch(`${SUPERCHAT_API_BASE}/v1.0/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': result.apiKey },
        body: JSON.stringify({ to: [{ identifier: contactIdentifier }], from: { channel_id: channelId }, content: { type: 'template', template: { name: templateName, language: templateLanguage, ...(variables ? { variables } : {}) } } }),
      });
      if (!res.ok) { const e = await res.text(); return reply.code(res.status).send({ error: e }); }
      return await res.json();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });
}
