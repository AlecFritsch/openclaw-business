import { ObjectId } from 'mongodb';
import type { OrgRole, OrgRoleOverrides } from './permission.types.js';

// ── Plan Limits (shared between frontend + backend) ──────────────────────────
export type PlanId = 'unpaid' | 'professional' | 'enterprise';

export interface PlanLimits {
  /** Max agents (0 = unlimited, enforced by billing) */
  agents: number;
  /** Messages per agent per month */
  messagesPerAgent: number;
  /** Storage in GB */
  storage: number;
  /** Max team members (0 = unlimited) */
  teamMembers: number;
  /** Max API keys the org can create (0 = no API access) */
  apiKeys: number;
  /** Max webhook endpoints per agent (0 = no webhooks) */
  webhooksPerAgent: number;
  /** API rate limit in requests per minute (0 = no API access) */
  apiRateLimit: number;
  /** Whether batch operations are available */
  batchOperations: boolean;
  /** Per-agent pricing — agents are billed individually */
  perAgent: boolean;
  /** Trial duration in days (0 = no trial, -1 = unlimited) — unused for unpaid */
  trialDays: number;
  /** Knowledge storage limit in MB (0 = unlimited) */
  knowledgeStorageMb: number;
  /** Knowledge search queries per month (0 = unlimited) */
  knowledgeQueries: number;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  unpaid:       { agents: 0,  messagesPerAgent: 0,     storage: 0,   teamMembers: 0,  apiKeys: 0,   webhooksPerAgent: 0,   apiRateLimit: 0,    batchOperations: false, perAgent: false, trialDays: 0,   knowledgeStorageMb: 0,     knowledgeQueries: 0      },
  professional: { agents: 3,  messagesPerAgent: 5000,  storage: 10,  teamMembers: 10, apiKeys: 5,   webhooksPerAgent: 5,   apiRateLimit: 600,  batchOperations: false, perAgent: true,  trialDays: 0,   knowledgeStorageMb: 5120,  knowledgeQueries: 10000  },
  enterprise:   { agents: 0,  messagesPerAgent: 0,     storage: 500, teamMembers: 0,  apiKeys: 999, webhooksPerAgent: 999, apiRateLimit: 5000, batchOperations: true,  perAgent: true,  trialDays: 0,   knowledgeStorageMb: 0,     knowledgeQueries: 0      },
};

/** Price per user per month in EUR (Professional plan) */
export const AGENT_PRICE_EUR = 250;

/** Havoc Basis price in EUR (new pricing: 200€ base + flexible setup fee) */
export const BASIS_PRICE_EUR = 200;

/** Workflow automation add-on price per month in EUR */
export const WORKFLOW_ADDON_PRICE_EUR = 29;
/** Workflow runs included in add-on per month */
export const WORKFLOW_ADDON_RUNS = 5000;

export const PLAN_PRICES: Record<PlanId, string> = {
  unpaid:       '—',
  professional: `€${AGENT_PRICE_EUR}/user/mo`,
  enterprise:   'Custom',
};

// ── Billing Usage Response (returned by GET /api/billing/usage) ──────────────
export interface BillingUsage {
  plan: PlanId;
  currentPeriod: string;
  trialEndsAt?: string | null;
  trialExpired?: boolean;
  agents: { used: number; limit: number };
  messages: { used: number; limit: number };
  storage: { used: number; limit: number; unit: string };
  knowledge: { storageMb: number; limitMb: number; queries: number; queryLimit: number };
  workflowAddon?: { active: boolean; runsUsed: number; runsLimit: number };
  limits: PlanLimits;
}

export interface User {
  _id?: ObjectId;
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  settings: {
    notifications: boolean;
    theme: 'light' | 'dark' | 'system';
    language: string;
  };
  subscription: {
    plan: PlanId;
    status: 'active' | 'canceled' | 'past_due';
    currentPeriodEnd?: Date;
    clerkSubscriptionId?: string;
    trialStartedAt?: Date;
    trialEndsAt?: Date;
  };
  apiKeys: Array<{
    id: string;
    name: string;
    key: string;
    createdAt: Date;
    lastUsed?: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organization {
  _id?: ObjectId;
  clerkId: string;
  name: string;
  slug: string;
  imageUrl?: string;
  members: Array<{
    userId: string;
    /** Legacy: 'admin' | 'member'. New: OrgRole granular roles. */
    role: OrgRole | 'admin' | 'member';
    joinedAt: Date;
    /** How the member was provisioned */
    provisionedVia?: 'manual' | 'scim';
  }>;
  /** Custom RBAC overrides per role (optional, Enterprise feature) */
  roleOverrides?: OrgRoleOverrides;
  subscription: {
    plan: PlanId;
    status: 'active' | 'canceled' | 'past_due';
    seats: number;
    currentPeriodEnd?: Date;
    clerkSubscriptionId?: string;
    trialStartedAt?: Date;
    trialEndsAt?: Date;
  };
  /** Feature flags for the organization */
  features?: {
    whiteLabel?: boolean;
  };
  /** SSO/SCIM Enterprise settings */
  ssoRequired?: boolean;
  allowedDomains?: string[];
  scimEnabled?: boolean;
  /**
   * Org-level tool API keys (NOT AI model keys — those are in `providers` collection).
   * Each key is AES-256 encrypted. Used by deployed agents for tool access.
   * Platform .env keys are NEVER passed to agent containers — orgs pay for their own usage.
   */
  toolApiKeys?: {
    /** Brave Search API key — required for agent web_search tool */
    braveApiKeyEncrypted?: string;
    /** Tavily API key — alternative web search provider */
    tavilyApiKeyEncrypted?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
