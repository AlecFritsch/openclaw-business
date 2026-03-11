import { FastifyInstance } from 'fastify';
import { Webhook } from 'svix';
import Stripe from 'stripe';
import { getDatabase } from '../../config/database.js';
import { config } from '../../config/env.js';
import { dockerService } from '../../services/docker.service.js';
import { mapClerkRole, type PlanId } from '@openclaw-business/shared';

export async function webhooksRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const usersCollection = db.collection('users');

  // Clerk Webhook Handler
  fastify.post('/clerk', async (request, reply) => {
    const WEBHOOK_SECRET = config.clerkWebhookSecret;

    if (!WEBHOOK_SECRET) {
      return reply.code(500).send({ error: 'Webhook secret not configured' });
    }

    // Get headers
    const svix_id = request.headers['svix-id'] as string;
    const svix_timestamp = request.headers['svix-timestamp'] as string;
    const svix_signature = request.headers['svix-signature'] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return reply.code(400).send({ error: 'Missing svix headers' });
    }

    // Verify webhook
    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: any;

    try {
      evt = wh.verify(JSON.stringify(request.body), {
        'svix-id': svix_id,
        'svix-timestamp': svix_timestamp,
        'svix-signature': svix_signature,
      });
    } catch (err) {
      fastify.log.error({ err }, 'Webhook verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const { type, data } = evt;

    switch (type) {
      case 'user.created':
        // Upsert user (idempotent — Clerk may retry)
        await usersCollection.updateOne(
          { clerkId: data.id },
          {
            $setOnInsert: {
              clerkId: data.id,
              createdAt: new Date(data.created_at),
              settings: { notifications: true, theme: 'system', language: 'en' },
              apiKeys: [],
              subscription: {
                plan: 'unpaid' as PlanId,
                status: 'active',
              },
            },
            $set: {
              email: data.email_addresses[0]?.email_address,
              firstName: data.first_name,
              lastName: data.last_name,
              imageUrl: data.image_url,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
        
        fastify.log.info(`User created: ${data.id}`);
        break;

      case 'user.updated':
        await usersCollection.updateOne(
          { clerkId: data.id },
          {
            $set: {
              email: data.email_addresses[0]?.email_address,
              firstName: data.first_name,
              lastName: data.last_name,
              imageUrl: data.image_url,
              updatedAt: new Date(),
            },
          }
        );
        fastify.log.info(`User updated: ${data.id}`);
        break;

      case 'user.deleted':
        // Stop and remove all agent containers before deleting
        const userAgents = await db.collection('agents').find({ userId: data.id }).toArray();
        for (const agent of userAgents) {
          if (agent.containerId) {
            try {
              await dockerService.stopContainer(agent.containerId);
              await dockerService.deleteContainer(agent.containerId);
            } catch (err) {
              fastify.log.warn({ err, containerId: agent.containerId }, 'Failed to cleanup container on user deletion');
            }
          }
        }
        await usersCollection.deleteOne({ clerkId: data.id });
        await db.collection('agents').deleteMany({ userId: data.id });
        fastify.log.info(`User deleted: ${data.id}`);
        break;

      case 'organization.created': {
        // Clerk includes created_by (user ID of the creator) in the webhook payload.
        const creatorId = data.created_by;
        const initialMembers = creatorId
          ? [{ userId: creatorId, role: 'owner', joinedAt: new Date() }]
          : [];

        await db.collection('organizations').updateOne(
          { clerkId: data.id },
          {
            $setOnInsert: {
              clerkId: data.id,
              createdAt: new Date(data.created_at),
              metadata: { industry: null, teamSize: null, primaryUseCase: null },
              subscription: {
                plan: 'unpaid' as PlanId,
                status: 'active',
              },
            },
            $set: {
              name: data.name,
              slug: data.slug,
              imageUrl: data.image_url,
              members: initialMembers,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
        fastify.log.info(`Organization created: ${data.id} (creator: ${creatorId || 'unknown'})`);
        break;
      }

      case 'organization.updated':
        await db.collection('organizations').updateOne(
          { clerkId: data.id },
          {
            $set: {
              name: data.name,
              slug: data.slug,
              imageUrl: data.image_url,
              updatedAt: new Date(),
            },
          }
        );
        fastify.log.info(`Organization updated: ${data.id}`);
        break;

      case 'organization.deleted':
        // Stop and remove all agent containers before deleting
        const orgAgents = await db.collection('agents').find({ organizationId: data.id }).toArray();
        for (const agent of orgAgents) {
          if (agent.containerId) {
            try {
              await dockerService.stopContainer(agent.containerId);
              await dockerService.deleteContainer(agent.containerId);
            } catch (err) {
              fastify.log.warn({ err, containerId: agent.containerId }, 'Failed to cleanup container on org deletion');
            }
          }
        }
        await db.collection('agents').deleteMany({ organizationId: data.id });
        await db.collection('organizations').deleteOne({ clerkId: data.id });
        fastify.log.info(`Organization deleted: ${data.id} (${orgAgents.length} agents cleaned up)`);
        break;

      case 'organizationMembership.created':
        // Add member to org document — map Clerk role to Havoc RBAC role
        await db.collection('organizations').updateOne(
          { clerkId: data.organization.id },
          {
            $push: {
              members: {
                userId: data.public_user_data.user_id,
                role: mapClerkRole(data.role),
                joinedAt: new Date(data.created_at),
              },
            } as any,
          }
        );
        // Also set organizationId on the user document so GET /api/organization works
        await usersCollection.updateOne(
          { clerkId: data.public_user_data.user_id },
          { $set: { organizationId: data.organization.id, updatedAt: new Date() } }
        );
        fastify.log.info(`Member added to org: ${data.organization.id}`);
        break;

      case 'organizationMembership.deleted':
        await db.collection('organizations').updateOne(
          { clerkId: data.organization.id },
          {
            $pull: {
              members: { userId: data.public_user_data.user_id },
            } as any,
          }
        );
        fastify.log.info(`Member removed from org: ${data.organization.id}`);
        break;

      case 'organizationMembership.updated': {
        const orgId = data.organization.id;
        const userId = data.public_user_data.user_id;
        const newRole = data.role;

        if (orgId && userId) {
          await db.collection('organizations').updateOne(
            { clerkId: orgId, 'members.userId': userId },
            {
              $set: {
                'members.$.role': newRole === 'org:admin' ? 'admin' : 'editor',
                updatedAt: new Date(),
              },
            },
          );
        }
        fastify.log.info(`Member role updated in org: ${orgId} (user ${userId} → ${newRole})`);
        break;
      }

      // Note: Clerk Billing subscription events removed — billing is handled
      // entirely via Stripe webhooks at POST /api/webhooks/stripe.

      default:
        fastify.log.warn(`Unhandled webhook type: ${type}`);
    }

    return reply.code(200).send({ success: true });
  });

  // ── Stripe Webhook Handler ─────────────────────────────────────
  // Handles checkout.session.completed, customer.subscription.updated/deleted,
  // and invoice events to sync billing state into MongoDB.
  fastify.post('/stripe', {
    config: {
      rawBody: true,
    },
  }, async (request, reply) => {
    if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
      return reply.code(500).send({ error: 'Stripe not configured' });
    }

    const stripe = new Stripe(config.stripeSecretKey);
    const sig = request.headers['stripe-signature'] as string;

    if (!sig) {
      return reply.code(400).send({ error: 'Missing stripe-signature header' });
    }

    let event: Stripe.Event;
    try {
      // Use raw body for signature verification (provided by fastify-raw-body)
      const rawBody = (request as any).rawBody;
      if (!rawBody) {
        return reply.code(400).send({ error: 'Raw body not available' });
      }
      event = stripe.webhooks.constructEvent(rawBody, sig, config.stripeWebhookSecret);
    } catch (err) {
      fastify.log.error({ err }, 'Stripe webhook signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const orgsCollection = db.collection('organizations');

    switch (event.type) {
      // ── Checkout completed → upgrade to professional ──
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = session.metadata || {};
        const orgId = meta.organizationId;
        const userId = meta.userId;

        // ── Basis purchase (200€ + Setup Fee, one-time) → Professional ──
        if (meta.type === 'basis_purchase') {
          const orgId = meta.organizationId;
          const uid = meta.userId;
          const docFilter: any = orgId ? { clerkId: orgId } : { clerkId: uid };

          const existing = await db.collection('processed_checkouts').findOne({ stripeCheckoutId: session.id });
          if (existing) { fastify.log.info(`Basis purchase already processed: ${session.id}`); break; }

          const update = {
            $set: {
              'subscription.plan': 'professional' as PlanId,
              'subscription.status': 'active',
              'subscription.basisPurchasedAt': new Date(),
              updatedAt: new Date(),
            },
          };

          if (orgId) {
            await orgsCollection.updateOne({ clerkId: orgId }, update);
            fastify.log.info(`Basis purchase completed for org ${orgId} → professional`);
          } else if (uid) {
            await usersCollection.updateOne({ clerkId: uid }, update);
            fastify.log.info(`Basis purchase completed for user ${uid} → professional`);
          }
          await db.collection('processed_checkouts').insertOne({ stripeCheckoutId: session.id, processedAt: new Date() });
          break;
        }

        // ── Subscription checkout (Professional plan) ──
        const checkoutDedup = await db.collection('processed_checkouts').findOne({ stripeCheckoutId: session.id });
        if (checkoutDedup) { fastify.log.info(`Checkout already processed: ${session.id}`); break; }

        const update = {
          $set: {
            'subscription.plan': 'professional' as PlanId,
            'subscription.status': 'active',
            'subscription.stripeSubscriptionId': session.subscription as string,
            updatedAt: new Date(),
          },
        };

        if (orgId) {
          await orgsCollection.updateOne({ clerkId: orgId }, update);
          fastify.log.info(`Stripe checkout completed for org ${orgId} → professional`);
        } else if (userId) {
          await usersCollection.updateOne({ clerkId: userId }, update);
          fastify.log.info(`Stripe checkout completed for user ${userId} → professional`);
        }
        await db.collection('processed_checkouts').insertOne({ stripeCheckoutId: session.id, processedAt: new Date() });
        break;
      }

      // ── Subscription updated (plan change, past_due, etc.) ──
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const status = sub.status === 'active' ? 'active'
          : sub.status === 'past_due' ? 'past_due'
          : sub.status === 'canceled' ? 'canceled'
          : 'active';

        // current_period_end moved to subscription items in Stripe API 2025-03-31
        const firstItem = sub.items?.data?.[0];
        const rawPeriodEnd = (firstItem as any)?.current_period_end;
        const currentPeriodEnd = rawPeriodEnd
          ? new Date(rawPeriodEnd * 1000)
          : undefined;

        const updateFields: any = {
          'subscription.status': status,
          'subscription.stripeSubscriptionId': sub.id,
          updatedAt: new Date(),
        };
        if (currentPeriodEnd) {
          updateFields['subscription.currentPeriodEnd'] = currentPeriodEnd;
        }

        // Find who owns this customer
        const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        const orgId = customer.metadata?.organizationId;
        const userId = customer.metadata?.userId;

        if (orgId) {
          await orgsCollection.updateOne({ clerkId: orgId }, { $set: updateFields });
        } else if (userId) {
          await usersCollection.updateOne({ clerkId: userId }, { $set: updateFields });
        }

        fastify.log.info(`Stripe subscription updated: status=${status}`);
        break;
      }

      // ── Subscription deleted → revert to unpaid ──
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        const orgId = customer.metadata?.organizationId;
        const userId = customer.metadata?.userId;

        const revert = {
          $set: {
            'subscription.plan': 'unpaid' as PlanId,
            'subscription.status': 'canceled',
            updatedAt: new Date(),
          },
          $unset: { 'subscription.stripeSubscriptionId': '' },
        };

        if (orgId) {
          await orgsCollection.updateOne({ clerkId: orgId }, revert);
          fastify.log.info(`Stripe subscription deleted for org ${orgId} → unpaid`);
        } else if (userId) {
          await usersCollection.updateOne({ clerkId: userId }, revert);
          fastify.log.info(`Stripe subscription deleted for user ${userId} → unpaid`);
        }
        break;
      }

      // ── Subscription paused ──
      case 'customer.subscription.paused': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        const orgId = customer.metadata?.organizationId;
        const userId = customer.metadata?.userId;

        const pauseUpdate = { $set: { 'subscription.status': 'paused', updatedAt: new Date() } };

        if (orgId) {
          await orgsCollection.updateOne({ clerkId: orgId }, pauseUpdate);
        } else if (userId) {
          await usersCollection.updateOne({ clerkId: userId }, pauseUpdate);
        }
        fastify.log.info(`Stripe subscription paused for ${orgId || userId}`);
        break;
      }

      // ── Subscription resumed ──
      case 'customer.subscription.resumed': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        const orgId = customer.metadata?.organizationId;
        const userId = customer.metadata?.userId;

        const resumeUpdate = { $set: { 'subscription.status': 'active', updatedAt: new Date() } };

        if (orgId) {
          await orgsCollection.updateOne({ clerkId: orgId }, resumeUpdate);
        } else if (userId) {
          await usersCollection.updateOne({ clerkId: userId }, resumeUpdate);
        }
        fastify.log.info(`Stripe subscription resumed for ${orgId || userId}`);
        break;
      }

      // ── Invoice paid → store invoice record ──
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customer = await stripe.customers.retrieve(invoice.customer as string) as Stripe.Customer;
        const orgId = customer.metadata?.organizationId;
        const userId = customer.metadata?.userId;

        // Deduplicate — don't insert if we already have this invoice
        const existing = await db.collection('invoices').findOne({ stripeInvoiceId: invoice.id });
        if (!existing) {
          await db.collection('invoices').insertOne({
            stripeInvoiceId: invoice.id,
            organizationId: orgId || undefined,
            userId: userId || undefined,
            amount: (invoice.amount_paid || 0) / 100, // cents → EUR
            currency: invoice.currency || 'eur',
            status: 'paid',
            invoiceUrl: invoice.hosted_invoice_url || undefined,
            invoiceNumber: invoice.number || undefined,
            periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : undefined,
            periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : undefined,
            createdAt: new Date(),
          });
        }

        fastify.log.info(`Stripe invoice ${invoice.id} stored`);
        break;
      }

      // ── Invoice payment failed → mark subscription as past_due ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customer = await stripe.customers.retrieve(invoice.customer as string) as Stripe.Customer;
        const orgId = customer.metadata?.organizationId;
        const userId = customer.metadata?.userId;

        const failUpdate = { $set: { 'subscription.status': 'past_due', updatedAt: new Date() } };

        if (orgId) {
          await orgsCollection.updateOne({ clerkId: orgId }, failUpdate);
        } else if (userId) {
          await usersCollection.updateOne({ clerkId: userId }, failUpdate);
        }

        // Store the failed invoice too
        const existingFailed = await db.collection('invoices').findOne({ stripeInvoiceId: invoice.id });
        if (!existingFailed) {
          await db.collection('invoices').insertOne({
            stripeInvoiceId: invoice.id,
            organizationId: orgId || undefined,
            userId: userId || undefined,
            amount: (invoice.amount_due || 0) / 100,
            currency: invoice.currency || 'eur',
            status: 'failed',
            invoiceUrl: invoice.hosted_invoice_url || undefined,
            invoiceNumber: invoice.number || undefined,
            createdAt: new Date(),
          });
        }

        fastify.log.warn(`Stripe invoice payment failed: ${invoice.id} for ${orgId || userId}`);
        break;
      }

      // ── Invoice requires customer action (3D Secure, etc.) ──
      case 'invoice.payment_action_required': {
        const invoice = event.data.object as Stripe.Invoice;
        const customer = await stripe.customers.retrieve(invoice.customer as string) as Stripe.Customer;
        const orgId = customer.metadata?.organizationId;
        const userId = customer.metadata?.userId;

        // Mark as pending action so frontend can show a banner
        const actionUpdate = { $set: { 'subscription.status': 'past_due', 'subscription.requiresAction': true, updatedAt: new Date() } };

        if (orgId) {
          await orgsCollection.updateOne({ clerkId: orgId }, actionUpdate);
        } else if (userId) {
          await usersCollection.updateOne({ clerkId: userId }, actionUpdate);
        }

        fastify.log.warn(`Stripe invoice requires action: ${invoice.id} for ${orgId || userId}`);
        break;
      }

      default:
        fastify.log.debug(`Unhandled Stripe event: ${event.type}`);
    }

    return reply.code(200).send({ received: true });
  });
}
