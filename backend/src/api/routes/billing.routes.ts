import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { getDatabase } from '../../config/database.js';
import { config } from '../../config/env.js';
import { PLAN_LIMITS, BASIS_PRICE_EUR, type PlanId } from '@openclaw-business/shared';
import { serializeDoc } from '../../utils/sanitize.js';
import { resolvePlan } from '../../utils/trial.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

// Lazy-init Stripe (only when keys are configured)
let stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripe) {
    if (!config.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY not configured');
    stripe = new Stripe(config.stripeSecretKey);
  }
  return stripe;
}

export async function billingRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const usersCollection = db.collection('users');
  const agentsCollection = db.collection('agents');
  const sessionsCollection = db.collection('sessions');

  // GET /api/billing/usage - Get current usage vs plan limits
  fastify.get('/usage', {
    schema: {
      tags: ['Billing'],
      summary: 'Get current usage',
      description: 'Returns the current resource usage (agents, messages, storage) compared against the plan limits for the current billing period.',
      response: {
        200: z.object({
          usage: z.object({
            plan: z.string(),
            currentPeriod: z.string(),
            trialEndsAt: z.string().nullable().optional(),
            trialExpired: z.boolean().optional(),
            agents: z.object({ used: z.number(), limit: z.number() }),
            messages: z.object({ used: z.number(), limit: z.number() }),
            storage: z.object({ used: z.number(), limit: z.number(), unit: z.string() }),
            limits: z.record(z.any()),
          }),
        }),
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const agentFilter: any = organizationId ? { organizationId } : { userId };

    const agentCount = await agentsCollection.countDocuments(agentFilter);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Get agents with metrics (gatewayMessages synced by gateway-metrics from OpenClaw)
    const agents = await agentsCollection.find(agentFilter).project({ _id: 1, metrics: 1 }).toArray();
    const agentIds = agents.map(a => a._id!.toString());

    // Real message count: sum of gatewayMessages from all agents (synced from OpenClaw gateway)
    // Falls back to messages collection count for workspace-only messages
    const gatewayMessages = agents.reduce((s, a) => s + ((a as any).metrics?.gatewayMessages || 0), 0);
    const workspaceMessages = agentIds.length > 0
      ? await db.collection('messages').countDocuments({ agentId: { $in: agentIds }, createdAt: { $gte: startOfMonth } })
      : 0;
    const messageCount = Math.max(gatewayMessages, workspaceMessages);

    // Real storage: sum of collection sizes for this owner's data
    const sessionFilter: any = agentIds.length > 0
      ? { agentId: { $in: agentIds } }
      : { _id: { $exists: false } };
    const sessionCount = await sessionsCollection.countDocuments(sessionFilter);
    // Estimate: ~2KB per message, ~5KB per session (conservative)
    const storageBytes = (messageCount * 2048) + (sessionCount * 5120);
    const storageGb = Math.round((storageBytes / (1024 * 1024 * 1024)) * 100) / 100;

    // Resolve plan + subscription via shared helper
    const resolved = await resolvePlan(userId, organizationId);
    const { plan, subscription, trialExpired } = resolved;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.unpaid;

    // Calculate trial end date for frontend display (pass createdAt as fallback for legacy docs)
    let createdAt: Date | null = null;
    if (organizationId) {
      const org = await db.collection('organizations').findOne({ clerkId: organizationId });
      createdAt = org?.createdAt || null;
    } else {
      const user = await usersCollection.findOne({ clerkId: userId });
      createdAt = user?.createdAt || null;
    }
    const trialEndsAt = null;

    // Fetch knowledge stats
    let knowledgeStats = { storageMb: 0, queries: 0 };
    if (organizationId) {
      try {
        const { getKnowledgeStats } = await import('../../services/knowledge.service.js');
        const stats = await getKnowledgeStats(organizationId);
        knowledgeStats.storageMb = stats.storageMb;
      } catch (e: any) { request.log.debug({ err: e?.message }, "suppressed"); }
    }

    return {
      usage: {
        plan,
        currentPeriod: `${startOfMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        trialEndsAt: null,
        trialExpired,
        agents: { used: agentCount, limit: limits.agents },
        messages: {
          used: messageCount,
          limit: limits.messagesPerAgent > 0 ? limits.messagesPerAgent : -1,
        },
        storage: { used: storageGb, limit: limits.storage, unit: 'GB' },
        knowledge: {
          storageMb: knowledgeStats.storageMb,
          limitMb: limits.knowledgeStorageMb,
          queries: knowledgeStats.queries,
          queryLimit: limits.knowledgeQueries,
        },
        limits,
      },
    };
  });

  // GET /api/billing/subscription - Get subscription details (read-only)
  fastify.get('/subscription', {
    schema: {
      tags: ['Billing'],
      summary: 'Get subscription details',
      description: 'Returns the current subscription details for the organization or user, including plan, status, and billing info.',
      response: {
        200: z.object({
          subscription: z.object({
            plan: z.string(),
            status: z.string(),
            currentPeriodEnd: z.string().optional(),
            clerkSubscriptionId: z.string().optional(),
            trialEndsAt: z.string().nullable().optional(),
            trialExpired: z.boolean().optional(),
          }),
        }),
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    let subscription: any = { plan: 'unpaid', status: 'active' };
    let createdAt: Date | null = null;

    if (organizationId) {
      const org = await db.collection('organizations').findOne({ clerkId: organizationId });
      if (org?.subscription) subscription = org.subscription;
      createdAt = org?.createdAt || null;
    } else {
      const user = await usersCollection.findOne({ clerkId: userId });
      if (user?.subscription) subscription = user.subscription;
      createdAt = user?.createdAt || null;
    }

    const trialExpired = (subscription?.plan === 'unpaid' || subscription?.plan === 'trial');

    return {
      subscription: {
        ...serializeDoc(subscription),
        trialEndsAt: null,
        trialExpired,
      },
    };
  });

  // GET /api/billing/invoices - Read invoices from MongoDB (created by webhook sync)
  fastify.get('/invoices', {
    schema: {
      tags: ['Billing'],
      summary: 'List invoices',
      description: 'Returns up to 50 most recent invoices for the organization or user, sorted by creation date descending.',
      response: {
        200: z.object({
          invoices: z.array(z.object({
            _id: z.string(),
            amount: z.number(),
            currency: z.string().optional(),
            status: z.string(),
            invoiceUrl: z.string().optional(),
            periodStart: z.string().optional(),
            periodEnd: z.string().optional(),
            createdAt: z.string(),
          })),
        }),
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const filter: any = organizationId ? { organizationId } : { userId };

    const invoices = await db.collection('invoices')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return { invoices: invoices.map(serializeDoc) };
  });

  // ── Stripe Checkout: Create a checkout session for Professional plan ──
  fastify.post('/create-checkout', {
    schema: {
      tags: ['Billing'],
      summary: 'Create Stripe checkout session',
      description: 'Creates a Stripe Checkout session for upgrading to the Professional plan. Returns the checkout URL.',
      response: {
        200: z.object({ url: z.string() }),
        400: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
    preHandler: requirePermission('billing.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    if (!config.stripeSecretKey || !config.stripePriceId) {
      return reply.code(500).send({ error: 'Stripe not configured' });
    }

    const s = getStripe();

    // Look up or create Stripe customer
    const collection = organizationId
      ? db.collection('organizations')
      : usersCollection;
    const filter: any = organizationId
      ? { clerkId: organizationId }
      : { clerkId: userId };

    const doc = await collection.findOne(filter);
    if (!doc) {
      return reply.code(400).send({ error: 'Account not found' });
    }

    let customerId = doc.stripeCustomerId as string | undefined;

    if (!customerId) {
      // Create Stripe customer
      const customer = await s.customers.create({
        email: doc.email || undefined,
        name: organizationId ? doc.name : `${doc.firstName || ''} ${doc.lastName || ''}`.trim() || undefined,
        metadata: {
          ...(organizationId ? { organizationId } : { userId }),
        },
      });
      customerId = customer.id;

      // Store on our doc
      try {
        await collection.updateOne(filter, {
          $set: { stripeCustomerId: customerId, updatedAt: new Date() },
        });
      } catch (err) {
        fastify.log.error({ err, stripeCustomerId: customerId, organizationId, userId }, 'Failed to store Stripe customer ID in database - manual cleanup required');
        throw err;
      }
    }

    // Count current agents to set initial subscription quantity
    const agentFilter: any = organizationId ? { organizationId } : { userId };
    const currentAgentCount = await agentsCollection.countDocuments(agentFilter);
    const initialQuantity = Math.max(1, currentAgentCount);

    const frontendUrl = config.frontendUrl;
    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: config.stripePriceId, quantity: initialQuantity }],
      success_url: `${frontendUrl}/billing?upgraded=true`,
      cancel_url: `${frontendUrl}/billing`,
      // Allow promotion/coupon codes at checkout
      allow_promotion_codes: true,
      // Collect billing address for tax compliance
      billing_address_collection: 'required',
      // Automatic tax calculation (requires Stripe Tax to be enabled in Dashboard)
      automatic_tax: { enabled: true },
      // Pre-fill customer email
      customer_update: {
        address: 'auto',
      },
      metadata: {
        ...(organizationId ? { organizationId } : { userId }),
      },
    });

    if (request.audit) {
      await request.audit({
        category: 'billing.action',
        action: 'billing.subscription_changed',
        title: 'Checkout Session für Professional Plan erstellt',
        description: `Stripe Checkout Session erstellt für Upgrade auf Professional Plan. Kunde wird zu Stripe weitergeleitet.`,
        reasoning: 'Benutzer hat Upgrade auf Professional Plan initiiert',
        riskLevel: 'medium',
        outcome: 'success',
        resource: { type: 'subscription', id: session.id, name: 'Professional Plan' },
        metadata: { stripeSessionId: session.id, customerId },
      });
    }

    return { url: session.url! };
  });

  // ── Stripe Checkout: Havoc Basis (200€) + flexible Setup Fee ──
  // Sales-Call-Flow: Kunde will → Checkout 200€ + Setup → Provisioning
  fastify.post('/create-basis-checkout', {
    schema: {
      tags: ['Billing'],
      summary: 'Create Basis + Setup Fee checkout',
      description: 'Creates a one-time Stripe Checkout for Havoc Basis (200€) + optional setup fee. Used after sales call.',
      body: z.object({
        setupFeeEur: z.number().min(0).optional().default(0),
      }),
      response: {
        200: z.object({ url: z.string() }),
        400: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
    preHandler: requirePermission('billing.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    const { setupFeeEur = 0 } = request.body as { setupFeeEur?: number };

    if (isNaN(setupFeeEur)) return reply.badRequest('Invalid setup fee');

    if (!config.stripeSecretKey) {
      return reply.code(500).send({ error: 'Stripe not configured' });
    }

    const s = getStripe();
    const totalCents = Math.round((BASIS_PRICE_EUR + setupFeeEur) * 100);
    if (totalCents < 100) {
      return reply.code(400).send({ error: 'Invalid amount' });
    }

    const collection = organizationId ? db.collection('organizations') : usersCollection;
    const filter: any = organizationId ? { clerkId: organizationId } : { clerkId: userId };
    const doc = await collection.findOne(filter);
    if (!doc) {
      return reply.code(400).send({ error: 'Account not found' });
    }

    let customerId = doc.stripeCustomerId as string | undefined;
    if (!customerId) {
      const customer = await s.customers.create({
        email: doc.email || undefined,
        name: organizationId ? doc.name : `${doc.firstName || ''} ${doc.lastName || ''}`.trim() || undefined,
        metadata: { ...(organizationId ? { organizationId } : { userId }) },
      });
      customerId = customer.id;
      try {
        await collection.updateOne(filter, { $set: { stripeCustomerId: customerId, updatedAt: new Date() } });
      } catch (err) {
        fastify.log.error({ err, stripeCustomerId: customerId, organizationId, userId }, 'Failed to store Stripe customer ID in database - manual cleanup required');
        throw err;
      }
    }

    const frontendUrl = config.frontendUrl;
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Havoc Basis',
            description: setupFeeEur > 0
              ? `Basis (€${BASIS_PRICE_EUR}) + Setup Fee (€${setupFeeEur})`
              : `Havoc Basis – einmalig`,
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      },
    ];

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: lineItems,
      success_url: `${frontendUrl}/billing?basis_purchased=true`,
      cancel_url: `${frontendUrl}/billing`,
      billing_address_collection: 'required',
      automatic_tax: { enabled: true },
      metadata: {
        type: 'basis_purchase',
        basisEur: String(BASIS_PRICE_EUR),
        setupFeeEur: String(setupFeeEur),
        ...(organizationId ? { organizationId } : { userId }),
      },
    });

    if (request.audit) {
      await request.audit({
        category: 'billing.action',
        action: 'billing.basis_checkout_created',
        title: `Basis Checkout erstellt (€${BASIS_PRICE_EUR} + €${setupFeeEur} Setup)`,
        description: `Stripe Checkout für Havoc Basis. Gesamt: €${BASIS_PRICE_EUR + setupFeeEur}`,
        reasoning: 'Sales-Call-Flow: Kunde zahlt Basis + Setup Fee',
        riskLevel: 'low',
        outcome: 'success',
        resource: { type: 'checkout', id: session.id },
        metadata: { totalEur: BASIS_PRICE_EUR + setupFeeEur, setupFeeEur },
      });
    }

    return { url: session.url! };
  });

  // ── Stripe Customer Portal: Manage existing subscription ──
  fastify.post('/create-portal', {
    schema: {
      tags: ['Billing'],
      summary: 'Create Stripe customer portal session',
      description: 'Creates a Stripe Customer Portal session so the user can manage their subscription, payment methods, and invoices.',
      response: {
        200: z.object({ url: z.string() }),
        400: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
    preHandler: requirePermission('billing.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    if (!config.stripeSecretKey) {
      return reply.code(500).send({ error: 'Stripe not configured' });
    }

    const s = getStripe();

    const collection = organizationId
      ? db.collection('organizations')
      : usersCollection;
    const filter: any = organizationId
      ? { clerkId: organizationId }
      : { clerkId: userId };

    const doc = await collection.findOne(filter);
    const customerId = doc?.stripeCustomerId as string | undefined;

    if (!customerId) {
      return reply.code(400).send({ error: 'No active subscription found' });
    }

    const frontendUrl = config.frontendUrl;
    const portalParams: any = {
      customer: customerId,
      return_url: `${frontendUrl}/billing`,
    };
    if (config.stripePortalConfigId) {
      portalParams.configuration = config.stripePortalConfigId;
    }
    const session = await s.billingPortal.sessions.create(portalParams);

    return { url: session.url };
  });
}
