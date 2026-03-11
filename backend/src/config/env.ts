import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory
// In production, PM2 uses ecosystem.config.cjs with node --env-file=.env
// In test, env vars are set directly
if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: join(__dirname, '../../.env') });
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || '',
  
  // MongoDB
  mongodbUri: process.env.MONGODB_URI || '',
  
  // API Keys
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  braveApiKey: process.env.BRAVE_API_KEY || '',
  
  // Auth
  clerkSecretKey: process.env.CLERK_SECRET_KEY || '',
  clerkWebhookSecret: process.env.CLERK_WEBHOOK_SECRET || '',
  
  // OpenClaw
  // Default: ~/openclaw-data (writable by the backend process without sudo)
  openclawWorkspaceDir: process.env.OPENCLAW_WORKSPACE_DIR || join(homedir(), 'openclaw-data'),
  openclawBasePort: parseInt(process.env.OPENCLAW_BASE_PORT || '18789', 10),
  // Docker image tag for agent containers (set via OPENCLAW_IMAGE_TAG env var)
  // Use versioned tags in production: openclaw-secure:1.2.3
  openclawImageTag: process.env.OPENCLAW_IMAGE_TAG || 'openclaw-secure:latest',
  // Project root for docker build (must contain openclaw-secure/).
  // Default: OPENCLAW_PROJECT_ROOT env, or cwd, or cwd/.. (PM2 runs from backend/).
  openclawProjectRoot: (() => {
    if (process.env.OPENCLAW_PROJECT_ROOT) return process.env.OPENCLAW_PROJECT_ROOT;
    const cwd = process.cwd();
    if (existsSync(join(cwd, 'openclaw-secure', 'Dockerfile'))) return cwd;
    const parent = resolve(cwd, '..');
    if (existsSync(join(parent, 'openclaw-secure', 'Dockerfile'))) return parent;
    return cwd;
  })(),
  
  // Security
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  gatewayAllowlist: (process.env.GATEWAY_ALLOWLIST || '').split(',').filter(Boolean),
  networkEgressAllowlist: (process.env.NETWORK_EGRESS_ALLOWLIST || '').split(',').filter(Boolean),

  // Superchat (optional, for Superchat API base URL — default: https://api.superchat.com)
  superchatApiBaseUrl: process.env.SUPERCHAT_API_BASE_URL || 'https://api.superchat.com',
  // Optional HMAC secret to verify Superchat webhook signatures (x-superchat-signature)
  superchatWebhookSecret: process.env.SUPERCHAT_WEBHOOK_SECRET || '',

  // Backend URL for agent containers (superchat_send plugin callbacks)
  // Default: host.docker.internal (Docker Desktop) or 172.17.0.1 (Linux bridge)
  havocBackendUrl: process.env.HAVOC_BACKEND_URL || 'http://host.docker.internal:8080',

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeProductId: process.env.STRIPE_PRODUCT_ID || '',
  stripePriceId: process.env.STRIPE_PRICE_ID || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePortalConfigId: process.env.STRIPE_PORTAL_CONFIG_ID || '',
  stripeBasisProductId: process.env.STRIPE_BASIS_PRODUCT_ID || '',

  // Resend (Team Invites)
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFromEmail: process.env.RESEND_FROM_EMAIL || 'OpenClaw Business <invites@example.com>',

  // LlamaParse (document parsing for RAG)
  llamaParseApiKey: process.env.LLAMA_PARSE_API_KEY || '',

  // Google Drive (OAuth for knowledge sync)
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',

  // Notion (OAuth for knowledge sync)
  notionClientId: process.env.NOTION_CLIENT_ID || '',
  notionClientSecret: process.env.NOTION_CLIENT_SECRET || '',
  notionRedirectUri: process.env.NOTION_REDIRECT_URI || '',


  // Smithery (MCP Connect — OAuth-managed MCP connections)
  smitheryApiKey: process.env.SMITHERY_API_KEY || '',

  // Admin
  adminApiKey: process.env.ADMIN_API_KEY || '',
} as const;

// Validate required env vars (throws instead of process.exit so tests can catch)
export function validateConfig(): void {
  const isProd = config.nodeEnv === 'production';
  
  // In production, DB + Auth + Encryption are required.
  // AI keys (ANTHROPIC_API_KEY, etc.) are now optional — orgs configure their own in Settings > AI Providers.
  const required = isProd
    ? ['MONGODB_URI', 'CLERK_SECRET_KEY', 'ENCRYPTION_KEY', 'FRONTEND_URL', 'CLERK_WEBHOOK_SECRET']
    : ['MONGODB_URI', 'CLERK_SECRET_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Please set these variables in your .env file`);
  }

  if (config.encryptionKey && config.encryptionKey.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters long. Generate a secure key with: openssl rand -hex 32');
  }

  if (config.adminApiKey && config.adminApiKey.length < 32) {
    throw new Error('ADMIN_API_KEY must be at least 32 characters long. Generate with: openssl rand -hex 32');
  }

  // Platform AI (builder, support, analytics) requires Anthropic
  if (!config.anthropicApiKey) {
    console.warn('⚠ ANTHROPIC_API_KEY not set — platform AI (builder, support, analytics) will be unavailable');
  }
  if (!isProd && !config.frontendUrl) {
    console.warn('⚠ FRONTEND_URL not set — CORS will only allow localhost origins');
  }
  if (!config.tavilyApiKey) {
    console.warn('⚠ TAVILY_API_KEY not set — builder web search will be unavailable');
  }
  if (!isProd && !config.clerkWebhookSecret) {
    console.warn('⚠ CLERK_WEBHOOK_SECRET not set — webhook verification disabled');
  }
  if (!config.braveApiKey) {
    console.warn('⚠ BRAVE_API_KEY not set — agents without org-level Brave key will have no web_search');
  }
  // GEMINI_API_KEY: used for agent memory_search embedding when org has no own key
  if (!config.geminiApiKey) {
    console.warn('⚠ GEMINI_API_KEY not set — agents without org-level embedding key will have no memory_search');
  }
  if (!config.stripeSecretKey) {
    console.warn('⚠ STRIPE_SECRET_KEY not set — Stripe billing disabled');
  }
  if (!config.stripePriceId) {
    console.warn('⚠ STRIPE_PRICE_ID not set — Stripe checkout will fail (set to your Professional plan price ID)');
  }
  if (!config.smitheryApiKey) {
    console.warn('⚠ SMITHERY_API_KEY not set — MCP integrations (Smithery Connect) will be unavailable');
  }
  if (!config.superchatWebhookSecret) {
    console.warn('⚠ SUPERCHAT_WEBHOOK_SECRET not set — Superchat webhook signature verification disabled');
  }
  if (!config.resendApiKey) {
    console.warn('⚠ RESEND_API_KEY not set — team invites will use Clerk’s default emails');
  }
}

// Run validation at import time for non-test environments
if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}
