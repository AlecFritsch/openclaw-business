// Agent Channels Routes - Manage OpenClaw channels per agent

import { FastifyInstance } from 'fastify';
import { validateObjectId } from '../../validation/schemas.js';
import { channelService, type AddChannelRequest } from '../../services/channel.service.js';
import { workspaceService } from '../../services/workspace.service.js';
import { listSuperchatChannels } from '../../services/superchat-bridge.service.js';
import type { ChannelType, DmPolicy, GroupPolicy } from '@openclaw-business/shared';
import { requirePermission } from '../../middleware/permission.middleware.js';

const VALID_CHANNEL_TYPES: ChannelType[] = [
  'whatsapp', 'telegram', 'discord', 'slack', 'webchat',
  'signal', 'imessage', 'googlechat', 'msteams', 'mattermost',
  'matrix', 'feishu', 'line', 'bluebubbles', 'superchat',
];

export async function agentChannelsRoutes(fastify: FastifyInstance) {
  // ── Trial guard: block mutations when trial has expired ──────────
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return;
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Trial expired',
        message: 'Your 7-day trial has expired. Upgrade to Professional to continue.',
      });
    }
  });

  // GET /api/agents/:id/channels/superchat/live - List Superchat live channels (WhatsApp, Instagram, etc.)
  fastify.get<{ Params: { id: string } }>('/:id/channels/superchat/live', {
    preHandler: requirePermission('agents.channels.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const apiKey = await channelService.getSuperchatApiKey(agentId, userId);
    if (!apiKey) {
      return reply.code(404).send({
        error: 'Superchat not configured',
        message: 'Add Superchat channel with API key first to list live channels.',
      });
    }

    try {
      const channels = await listSuperchatChannels(apiKey);
      return { channels };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch Superchat channels';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/channels - List all channels for an agent
  fastify.get<{ Params: { id: string } }>('/:id/channels', async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const channels = await channelService.getChannels(agentId, userId);
    return { channels };
  });

  // POST /api/agents/:id/channels - Add a channel to an agent
  fastify.post<{
    Params: { id: string };
    Body: {
      type: ChannelType;
      credentials?: { botToken?: string; appToken?: string; apiKey?: string };
      dmPolicy?: DmPolicy;
      allowFrom?: string[];
      groupPolicy?: GroupPolicy;
      groupAllowFrom?: string[];
    };
  }>('/:id/channels', {
    preHandler: requirePermission('agents.channels.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const body = request.body;
    if (!body.type || !VALID_CHANNEL_TYPES.includes(body.type)) {
      return reply.code(400).send({
        error: `Invalid channel type. Must be one of: ${VALID_CHANNEL_TYPES.join(', ')}`,
      });
    }

    // OpenClaw requires allowFrom: ["*"] when dmPolicy is "open"
    if (body.dmPolicy === 'open') {
      if (!body.allowFrom || !body.allowFrom.includes('*')) {
        body.allowFrom = ['*'];
      }
    }

    try {
      const addRequest: AddChannelRequest = {
        type: body.type,
        credentials: body.credentials,
        dmPolicy: body.dmPolicy,
        allowFrom: body.allowFrom,
        groupPolicy: body.groupPolicy,
        groupAllowFrom: body.groupAllowFrom,
      };

      const channel = await channelService.addChannel(agentId, userId, addRequest);

      // Regenerate persona files (AGENTS.md + TOOLS.md reference channels)
      workspaceService.regeneratePersonaFiles(agentId).catch(err =>
        console.warn(`[channels] Persona regen failed after add for ${agentId}:`, err instanceof Error ? err.message : err)
      );

      if (request.audit) {
        await request.audit({
          agentId,
          category: 'agent.channel',
          action: 'agent.channel.connected',
          title: `Channel "${body.type}" hinzugefügt`,
          description: `${body.type}-Channel zum Agent hinzugefügt. DM Policy: ${body.dmPolicy || 'default'}, Group Policy: ${body.groupPolicy || 'default'}`,
          reasoning: 'Benutzer hat einen neuen Kommunikationskanal für den Agent konfiguriert',
          riskLevel: 'medium',
          outcome: 'success',
          resource: { type: 'channel', id: `${agentId}:${body.type}`, name: body.type },
          metadata: { channelType: body.type, dmPolicy: body.dmPolicy, groupPolicy: body.groupPolicy },
        });
      }

      return reply.code(201).send({ channel });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add channel';
      return reply.code(400).send({ error: message });
    }
  });

  // PATCH /api/agents/:id/channels/:type - Update channel config
  fastify.patch<{
    Params: { id: string; type: string };
    Body: {
      dmPolicy?: DmPolicy;
      allowFrom?: string[];
      groupPolicy?: GroupPolicy;
      groupAllowFrom?: string[];
    };
  }>('/:id/channels/:type', {
    preHandler: requirePermission('agents.channels.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;
    const channelType = request.params.type as ChannelType;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    if (!VALID_CHANNEL_TYPES.includes(channelType)) {
      return reply.code(400).send({ error: 'Invalid channel type' });
    }

    const body = request.body;

    // OpenClaw requires allowFrom: ["*"] when dmPolicy is "open"
    if (body.dmPolicy === 'open') {
      if (!body.allowFrom || !body.allowFrom.includes('*')) {
        body.allowFrom = ['*'];
      }
    }

    try {
      await channelService.updateChannelConfig(agentId, userId, channelType, body);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update channel';
      return reply.code(400).send({ error: message });
    }
  });

  // DELETE /api/agents/:id/channels/:type - Remove a channel
  fastify.delete<{ Params: { id: string; type: string } }>('/:id/channels/:type', {
    preHandler: requirePermission('agents.channels.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;
    const channelType = request.params.type as ChannelType;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      await channelService.removeChannel(agentId, userId, channelType);

      // Regenerate persona files (AGENTS.md + TOOLS.md reference channels)
      workspaceService.regeneratePersonaFiles(agentId).catch(err =>
        console.warn(`[channels] Persona regen failed after remove for ${agentId}:`, err instanceof Error ? err.message : err)
      );

      if (request.audit) {
        await request.audit({
          agentId,
          category: 'agent.channel',
          action: 'agent.channel.disconnected',
          title: `Channel "${channelType}" entfernt`,
          description: `${channelType}-Channel vom Agent entfernt. Alle Verbindungen über diesen Kanal sind getrennt.`,
          reasoning: 'Benutzer hat einen Kommunikationskanal vom Agent entfernt',
          riskLevel: 'medium',
          outcome: 'success',
          resource: { type: 'channel', id: `${agentId}:${channelType}`, name: channelType },
        });
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove channel';
      return reply.code(400).send({ error: message });
    }
  });
}
