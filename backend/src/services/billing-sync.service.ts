import Stripe from 'stripe';
import { config } from '../config/env.js';
import { getDatabase } from '../config/database.js';

let stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!config.stripeSecretKey) return null;
  if (!stripe) stripe = new Stripe(config.stripeSecretKey);
  return stripe;
}

/**
 * Sync the Stripe subscription quantity with the current agent count.
 * Called after agent creation or deletion for Professional plan users.
 *
 * - Finds the Stripe subscription ID from the org/user document
 * - Counts current agents
 * - Updates the subscription item quantity to match
 * - Stripe prorates automatically (default behavior)
 */
export async function syncAgentQuantity(
  userId: string,
  organizationId?: string,
): Promise<void> {
  const s = getStripe();
  if (!s) return;

  const db = getDatabase();

  const collection = organizationId
    ? db.collection('organizations')
    : db.collection('users');
  const filter: any = organizationId
    ? { clerkId: organizationId }
    : { clerkId: userId };

  const doc = await collection.findOne(filter);
  if (!doc) return;

  const subscriptionId = doc.subscription?.stripeSubscriptionId;
  if (!subscriptionId) return;
  if (doc.subscription?.plan !== 'professional') return;

  const agentFilter: any = organizationId ? { organizationId } : { userId };
  const agentCount = await db.collection('agents').countDocuments(agentFilter);

  const quantity = Math.max(1, agentCount);

  try {
    const subscription = await s.subscriptions.retrieve(subscriptionId);
    const item = subscription.items?.data?.[0];
    if (!item) return;

    if (item.quantity !== quantity) {
      await s.subscriptionItems.update(item.id, {
        quantity,
        proration_behavior: 'create_prorations',
      });
    }
  } catch (err) {
    console.error(`[billing-sync] Failed to sync quantity for ${organizationId || userId}:`, err);
  }
}
