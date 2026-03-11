import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { tavily } from '@tavily/core';
import { config } from '../config/env.js';
import { getDatabase } from '../config/database.js';
import { decrypt } from '../utils/encryption.js';

let tavilyClient: ReturnType<typeof tavily> | null = null;

// ── Model Tiers ──────────────────────────────────────────────
// Sonnet 4.6:  $3.00/$15.00 per 1M tokens -- default for all workloads, fast + smart
// Opus 4.6:    $5.00/$25.00 per 1M tokens -- premium, highest intelligence, complex multi-step
export const MODEL_TIERS = {
  fast: 'claude-sonnet-4-6',
  balanced: 'claude-sonnet-4-6',
  premium: 'claude-opus-4-6',
} as const;

export type ModelTier = keyof typeof MODEL_TIERS;

// ── Anthropic Client Cache ───────────────────────────────────
// Keyed by API key last-8 to avoid re-instantiation on every call.
// Platform key gets its own singleton. Org keys get cached too.
// Capped at 50 entries to prevent unbounded memory growth.
const CLIENT_CACHE_MAX = 50;
const clientCache = new Map<string, Anthropic>();

function getOrCreateAnthropicClient(apiKey: string): Anthropic {
  const cacheKey = apiKey.slice(-8);
  let client = clientCache.get(cacheKey);
  if (!client) {
    if (clientCache.size >= CLIENT_CACHE_MAX) {
      // Evict oldest entry (first inserted)
      const oldest = clientCache.keys().next().value!;
      clientCache.delete(oldest);
    }
    client = new Anthropic({ apiKey });
    clientCache.set(cacheKey, client);
  }
  return client;
}

/**
 * Resolve platform key — Anthropic or Gemini. Throws if neither is set.
 * Use for platform-owned AI features: Agent Architect (builder), support suggestions, analytics.
 * Returns { provider: 'anthropic' | 'gemini', apiKey: string }
 */
export function resolvePlatformKey(): { provider: 'anthropic' | 'gemini'; apiKey: string } {
  if (config.anthropicApiKey?.trim()) {
    return { provider: 'anthropic', apiKey: config.anthropicApiKey };
  }
  if (config.geminiApiKey?.trim()) {
    return { provider: 'gemini', apiKey: config.geminiApiKey };
  }
  throw new Error('Platform ANTHROPIC_API_KEY or GEMINI_API_KEY is not configured. Set one in the environment to enable AI features.');
}

/**
 * Resolve the Anthropic API key for a given organization (BYOK).
 * Looks up the org's own provider key from MongoDB — NO fallback to platform key.
 * Platform .env ANTHROPIC_API_KEY is only for platform-owned features (builder, etc.).
 * Use for org-owned workloads (deployed agent containers, org-specific AI calls).
 */
export async function resolveAnthropicKey(organizationId?: string): Promise<string> {
  if (organizationId) {
    try {
      const db = getDatabase();
      const provider = await db.collection('providers').findOne({
        organizationId,
        provider: 'anthropic',
        status: 'active',
      });
      if (provider?.apiKeyEncrypted) {
        return decrypt(provider.apiKeyEncrypted);
      }
    } catch {
      // DB lookup failed
    }
  }
  throw new Error('No Anthropic API key configured for this organization. Add one in Settings > AI Providers.');
}

function getTavilyClient() {
  if (!tavilyClient) {
    if (!config.tavilyApiKey) {
      throw new Error('TAVILY_API_KEY is not configured');
    }
    tavilyClient = tavily({ apiKey: config.tavilyApiKey });
  }
  return tavilyClient;
}

export async function tavilySearch(query: string, maxResults: number = 5): Promise<{ title: string; url: string; content: string }[]> {
  const client = getTavilyClient();
  const response = await client.search(query, { maxResults });
  return (response.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || '',
  }));
}

/**
 * Chat with Claude using tiered model selection and prompt caching.
 *
 * Model selection strategy:
 * - 'fast' (Sonnet 4.6): Default for all workloads. $3.00/$15.00 per 1M tokens.
 * - 'balanced' (Sonnet 4.6): Same as fast — Sonnet 4.6 handles both tiers.
 * - 'premium' (Opus 4.6): Only when user explicitly selects premium. $5.00/$25.00 per 1M tokens.
 *
 * Prompt caching: System prompts are automatically cached (90% cost reduction on cache hits).
 * For a 2000-token system prompt called 100 times:
 *   Without caching: 100 * 2000 * $3.00/1M = $0.60
 *   With caching:    1 write ($0.0075) + 99 reads ($0.0059) = $0.013 -- 98% savings
 */
export async function chatWithClaude(options: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string | unknown[] }[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
  model?: string;
  tier?: ModelTier;
  enableCaching?: boolean;
  apiKey?: string;  // REQUIRED: pass resolvePlatformKey() for platform features, or org key for BYOK
}): Promise<Anthropic.Message> {
  const key = options.apiKey || config.anthropicApiKey;
  if (!key) {
    throw new Error('No API key provided. Use resolvePlatformKey() for platform features or resolveAnthropicKey(orgId) for org workloads.');
  }
  const client = getOrCreateAnthropicClient(key);

  // Resolve model: explicit model string > tier > default to balanced
  const model = options.model || MODEL_TIERS[options.tier || 'balanced'];

  // Build system prompt with caching support
  // Prompt caching: cache_control marks the system prompt for caching
  // Cache writes cost 25% more, but cache reads cost only 10% of base price
  const systemContent: any = options.enableCaching !== false
    ? [{
        type: 'text',
        text: options.system,
        cache_control: { type: 'ephemeral' },
      }]
    : options.system;

  return client.messages.create({
    model,
    max_tokens: options.maxTokens || 4096,
    system: systemContent,
    messages: options.messages as Anthropic.MessageParam[],
    tools: options.tools,
  });
}

/**
 * Chat with Gemini as fallback for platform features.
 * Uses official @google/genai SDK.
 */
export async function chatWithGemini(options: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string | unknown[] }[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
  model?: string;
  apiKey: string;
}): Promise<{ content: string; toolCalls?: any[] }> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  // Strip provider prefix if present (e.g. "google/gemini-3-flash-preview" -> "gemini-3-flash-preview")
  const modelName = options.model?.replace(/^google\//, '') || 'gemini-3-flash-preview';

  // Prepend system instruction as first user message
  const contents = [
    { role: 'user' as const, parts: [{ text: options.system }] },
    { role: 'model' as const, parts: [{ text: 'Understood. I will follow these instructions.' }] },
    ...options.messages.map(msg => ({
      role: msg.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
    })),
  ];

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        maxOutputTokens: options.maxTokens || 4096,
        temperature: 0.7,
      } as any,
    });

    console.log('[Gemini] Full response:', JSON.stringify(response, null, 2));

    // Extract text from response - response.text getter doesn't work, access manually
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log('[Gemini] Extracted text length:', text.length);

    return {
      content: text,
      toolCalls: undefined,
    };
  } catch (error: any) {
    console.error('Gemini API error:', error);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

