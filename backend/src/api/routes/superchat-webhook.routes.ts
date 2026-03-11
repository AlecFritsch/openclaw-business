// Superchat Webhook Routes - Unauthenticated (called by Superchat)
// Must be registered BEFORE authMiddleware
// Note: Context7/docs have no webhook signature verification — if Superchat adds it, verify here

import { FastifyInstance } from 'fastify';
import { validateObjectId } from '../../validation/schemas.js';
import * as superchatBridge from '../../services/superchat-bridge.service.js';
import type { SuperchatWebhookPayload } from '@openclaw-business/shared';
import { config } from '../../config/env.js';
import { createHmac, timingSafeEqual } from 'crypto';

export async function superchatWebhookRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Params: { agentId: string };
    Body: SuperchatWebhookPayload;
  }>('/superchat/:agentId', {
    config: { rawBody: true },
  }, async (request, reply) => {
      const { agentId } = request.params;

      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      if (config.superchatWebhookSecret) {
        const rawBody = (request as any).rawBody as string | Buffer | undefined;
        if (!rawBody) {
          return reply.code(400).send({ error: 'Missing raw request body for signature verification' });
        }
        const provided = request.headers['x-superchat-signature'];
        if (!provided || typeof provided !== 'string') {
          return reply.code(401).send({ error: 'Missing Superchat signature' });
        }
        const normalizedProvided = provided.startsWith('sha256=')
          ? provided.slice('sha256='.length)
          : provided;
        const expected = createHmac('sha256', config.superchatWebhookSecret)
          .update(rawBody)
          .digest('hex');
        const providedBuf = Buffer.from(normalizedProvided, 'hex');
        const expectedBuf = Buffer.from(expected, 'hex');
        if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
          return reply.code(401).send({ error: 'Invalid Superchat signature' });
        }
      } else {
        fastify.log.warn({ agentId }, 'Superchat webhook secret not configured - signature verification disabled');
      }

      const payload = request.body;
      if (!payload || typeof payload !== 'object') {
        return reply.code(400).send({ error: 'Invalid webhook payload' });
      }

      try {
        await superchatBridge.handleIncomingWebhook(agentId, payload);
        return reply.code(200).send({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fastify.log.warn({ err, agentId }, 'Superchat webhook handling failed');
        return reply.code(500).send({ error: message });
      }
    },
  );
}
