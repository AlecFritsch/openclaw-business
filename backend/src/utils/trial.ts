import { type PlanId } from '@openclaw-business/shared';
import { getDatabase } from '../config/database.js';

// ── Plan Resolution (shared across all routes) ────────────────────

export interface ResolvedPlan {
  plan: PlanId;
  subscription: any;
  /** True when user has no paid plan (unpaid or legacy trial) — must pay to access */
  trialExpired: boolean;
}

/** Normalize plan: legacy 'trial' in DB is treated as 'unpaid' */
function normalizePlan(raw: string | undefined): PlanId {
  if (raw === 'professional' || raw === 'enterprise') return raw;
  return 'unpaid';
}

/**
 * Resolve the current plan for a given userId / organizationId pair.
 * Unpaid (and legacy trial) users have trialExpired=true — no platform access until they pay.
 */
export async function resolvePlan(
  userId: string,
  organizationId?: string,
): Promise<ResolvedPlan> {
  const db = getDatabase();

  let rawPlan: string | undefined;
  let subscription: any = null;

  if (organizationId) {
    const org = await db.collection('organizations').findOne({ clerkId: organizationId });
    rawPlan = org?.subscription?.plan;
    subscription = org?.subscription;
  } else {
    const user = await db.collection('users').findOne({ clerkId: userId });
    rawPlan = user?.subscription?.plan;
    subscription = user?.subscription;
  }

  const plan = normalizePlan(rawPlan);
  const trialExpired = plan === 'unpaid';

  return { plan, subscription, trialExpired };
}

/**
 * Build default unpaid subscription (for new users/orgs).
 * No access until they complete payment (Professional or Basis).
 */
export function buildUnpaidSubscription() {
  return {
    plan: 'unpaid' as PlanId,
    status: 'active' as const,
  };
}

/** @deprecated Use buildUnpaidSubscription */
export const buildTrialSubscription = buildUnpaidSubscription;

/** @deprecated Unpaid has no trial period. Returns null. Kept for billing API compatibility. */
export function resolveTrialEndsAt(_subscription: any, _createdAt?: Date | string | null): Date | null {
  return null;
}
