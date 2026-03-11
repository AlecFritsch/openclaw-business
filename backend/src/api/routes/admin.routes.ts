/**
 * Admin API routes — secured by ADMIN_API_KEY header.
 * Intended for internal admin dashboard.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { getDatabase } from '../../config/database.js';
import { config } from '../../config/env.js';
import { gatewayMetricsSync } from '../../services/gateway-metrics.service.js';

// ── Auth guard ───────────────────────────────────────────────────────────────

async function requireAdminKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!config.adminApiKey) {
    return reply.status(503).send({ error: 'Admin API not configured' });
  }
  const key = request.headers['x-admin-key'] as string;
  if (!key || key.length !== config.adminApiKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminApiKey))) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', requireAdminKey);

  // ── Overview: all orgs ───────────────────────────────────────────────────

  fastify.get('/orgs', async (_request, reply) => {
    const db = getDatabase();
    const orgs = await db.collection('organizations').find({}).project({
      clerkId: 1, name: 1, subscription: 1, trialEndsAt: 1, stripeCustomerId: 1, updatedAt: 1,
    }).sort({ updatedAt: -1 }).toArray();

    const users = await db.collection('users').find({}).project({
      clerkId: 1, email: 1, firstName: 1, subscription: 1, trialEndsAt: 1, updatedAt: 1,
    }).sort({ updatedAt: -1 }).toArray();

    return reply.send({ orgs, users });
  });

  // ── Agent overview (all agents with status) ──────────────────────────────

  fastify.get('/agents', async (_request, reply) => {
    const db = getDatabase();
    const agents = await db.collection('agents').find({}).project({
      _id: 1, name: 1, status: 1, pausedReason: 1, organizationId: 1, userId: 1,
      containerId: 1, updatedAt: 1,
    }).sort({ updatedAt: -1 }).toArray();

    return reply.send({ agents });
  });

  // ── Activate customer: set plan to professional + trial period ───────────

  fastify.post<{ Body: { ownerKey: string; days?: number } }>(
    '/activate',
    async (request, reply) => {
      const { ownerKey, days = 20 } = request.body;
      if (!ownerKey) return reply.status(400).send({ error: 'ownerKey required' });
      if (days < 1 || days > 365) return reply.status(400).send({ error: 'days must be 1-365' });

      const db = getDatabase();
      const trialEndsAt = new Date(Date.now() + days * 86400000);
      const update = { $set: { 'subscription.plan': 'professional', 'subscription.status': 'active', trialEndsAt, updatedAt: new Date() } };

      let doc = await db.collection('organizations').findOneAndUpdate({ clerkId: ownerKey }, update, { returnDocument: 'after' });
      if (!doc) {
        doc = await db.collection('users').findOneAndUpdate({ clerkId: ownerKey }, update, { returnDocument: 'after' });
      }
      if (!doc) return reply.status(404).send({ error: 'Owner not found' });

      return reply.send({ ok: true, plan: 'professional', trialEndsAt: trialEndsAt.toISOString(), days });
    },
  );

  // ── Metrics ───────────────────────────────────────────────────────────────

  fastify.get('/metrics', async (_request, reply) => {
    const db = getDatabase();
    const agentCounts = await db.collection('agents').aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray();

    return reply.send({
      agentsByStatus: Object.fromEntries(agentCounts.map((a: any) => [a._id, a.count])),
    });
  });

  // ── Force metrics sync (gateway message counts) ─
  fastify.post('/metrics/force-sync', async (_request, reply) => {
    await gatewayMetricsSync.forcePoll();
    return reply.send({ ok: true });
  });

  // ── Search customers by email/name ───────────────────────────────────────

  fastify.get<{ Querystring: { q: string } }>('/search', async (request, reply) => {
    const q = (request.query.q || '').trim();
    if (!q) return reply.send({ results: [] });
    const db = getDatabase();
    const regex = { $regex: q, $options: 'i' };

    const [orgs, users] = await Promise.all([
      db.collection('organizations').find({ $or: [{ name: regex }, { slug: regex }] }).limit(20).toArray(),
      db.collection('users').find({ $or: [{ email: regex }, { firstName: regex }, { lastName: regex }] }).limit(20).toArray(),
    ]);

    return reply.send({
      results: [
        ...orgs.map((o: any) => ({ type: 'org', key: o.clerkId, name: o.name, plan: o.subscription?.plan, trialEndsAt: o.trialEndsAt, members: o.members?.length ?? 0 })),
        ...users.map((u: any) => ({ type: 'user', key: u.clerkId, name: u.email || `${u.firstName} ${u.lastName}`, plan: u.subscription?.plan, trialEndsAt: u.trialEndsAt })),
      ],
    });
  });

  // ── Quick activate: set plan to professional (BYOK: no credits) ──────────

  fastify.post<{ Body: { ownerKey: string; days?: number } }>(
    '/quick-activate',
    async (request, reply) => {
      const { ownerKey, days = 30 } = request.body;
      if (!ownerKey) return reply.status(400).send({ error: 'ownerKey required' });

      const db = getDatabase();
      const trialEndsAt = new Date(Date.now() + Math.min(days, 365) * 86400000);
      const update = {
        $set: {
          'subscription.plan': 'professional',
          'subscription.status': 'active',
          trialEndsAt,
          updatedAt: new Date(),
        },
      };

      const doc = await db.collection('organizations').findOne({ clerkId: ownerKey });
      if (!doc) {
        return reply.status(404).send({ error: 'Organization not found. Activate the org, not the user.' });
      }

      await db.collection('organizations').updateOne({ clerkId: ownerKey }, update);
      return reply.send({ ok: true, plan: 'professional', days, trialEndsAt: trialEndsAt.toISOString() });
    },
  );

  // ── Dashboard summary (single call for all stats) ────────────────────────

  fastify.get('/dashboard', async (_request, reply) => {
    const db = getDatabase();

    const [orgCount, userCount, agentCount, runningAgents, unpaidOrgs] = await Promise.all([
      db.collection('organizations').countDocuments(),
      db.collection('users').countDocuments(),
      db.collection('agents').countDocuments(),
      db.collection('agents').countDocuments({ status: 'running' }),
      db.collection('organizations').find({
        'subscription.plan': { $in: ['unpaid', 'trial'] },
      }).project({ clerkId: 1, name: 1, subscription: 1 }).limit(10).toArray(),
    ]);

    return reply.send({
      stats: { orgs: orgCount, users: userCount, agents: agentCount, running: runningAgents },
      alerts: { expiredTrials: unpaidOrgs },
    });
  });
}
