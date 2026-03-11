import { ObjectId } from 'mongodb';

// ─── AI Provider Management ─────────────────────────────────────
// Organization-level AI provider configuration.
// Keys are stored encrypted in MongoDB and written to
// OpenClaw auth-profiles.json on agent deploy/update.

export type AIProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'openrouter'
  | 'custom';

export interface AIProviderModel {
  id: string;            // e.g. "anthropic/claude-sonnet-4-6"
  name: string;          // e.g. "Claude Sonnet 4.5"
  provider: AIProviderType;
  tier: 'fast' | 'balanced' | 'premium';
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost?: {
    input: number;       // per 1M tokens
    output: number;      // per 1M tokens
  };
}

export interface AIProvider {
  _id?: ObjectId;
  organizationId: string;
  provider: AIProviderType;
  label: string;              // Display name, e.g. "Anthropic"
  status: 'active' | 'invalid' | 'unchecked';
  apiKeyEncrypted: string;    // AES-256-CBC encrypted
  apiKeyLastFour: string;     // Last 4 chars for display, e.g. "...4f2a"
  baseUrl?: string;           // For custom/openrouter providers
  availableModels: string[];  // Model IDs available with this key
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProviderRequest {
  provider: AIProviderType;
  apiKey: string;
  baseUrl?: string;       // For custom providers
  label?: string;
}

export interface UpdateProviderRequest {
  apiKey?: string;
  baseUrl?: string;
  label?: string;
}

export interface ValidateProviderRequest {
  provider: AIProviderType;
  apiKey: string;
  baseUrl?: string;
}

export interface ValidateProviderResponse {
  valid: boolean;
  error?: string;
  models?: string[];
}

// ─── Known Provider Catalog ─────────────────────────────────────
// Static catalog of known providers and their models.
// Used by the frontend to render the model picker.

// Model catalog aligned with OpenClaw-supported provider/model identifiers.
// See: https://docs.openclaw.ai/providers/models
export const PROVIDER_CATALOG: Record<AIProviderType, {
  label: string;
  description: string;
  authHint: string;
  models: Omit<AIProviderModel, 'provider'>[];
}> = {
  anthropic: {
    label: 'Anthropic',
    description: 'Claude models — best for reasoning, coding, and conversation',
    authHint: 'Get your API key at console.anthropic.com',
    models: [
      { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'balanced', reasoning: true, contextWindow: 200000, maxTokens: 16384, cost: { input: 3, output: 15 } },
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', tier: 'premium', reasoning: true, contextWindow: 200000, maxTokens: 32768, cost: { input: 15, output: 75 } },
    ],
  },
  openai: {
    label: 'OpenAI',
    description: 'GPT and o-series models',
    authHint: 'Get your API key at platform.openai.com',
    models: [
      { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', tier: 'fast', reasoning: false, contextWindow: 128000, maxTokens: 16384, cost: { input: 0.15, output: 0.60 } },
      { id: 'openai/gpt-5.2', name: 'GPT-5.2', tier: 'balanced', reasoning: true, contextWindow: 128000, maxTokens: 32768, cost: { input: 2.5, output: 10 } },
      { id: 'openai/o3', name: 'o3', tier: 'premium', reasoning: true, contextWindow: 200000, maxTokens: 100000, cost: { input: 10, output: 40 } },
      { id: 'openai/o4-mini', name: 'o4-mini', tier: 'balanced', reasoning: true, contextWindow: 128000, maxTokens: 65536, cost: { input: 1.1, output: 4.4 } },
    ],
  },
  google: {
    label: 'Google',
    description: 'Gemini models — massive context windows up to 1M tokens',
    authHint: 'Get your API key at aistudio.google.com',
    models: [
      { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', tier: 'fast', reasoning: false, contextWindow: 1000000, maxTokens: 65536, cost: { input: 0.075, output: 0.30 } },
      { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', tier: 'premium', reasoning: true, contextWindow: 1000000, maxTokens: 65536, cost: { input: 1.25, output: 10 } },
    ],
  },
  xai: {
    label: 'xAI',
    description: 'Grok models — frontier reasoning with real-time knowledge',
    authHint: 'Get your API key at console.x.ai',
    models: [
      { id: 'xai/grok-3', name: 'Grok 3', tier: 'balanced', reasoning: true, contextWindow: 131072, maxTokens: 32768, cost: { input: 3, output: 15 } },
      { id: 'xai/grok-4', name: 'Grok 4', tier: 'premium', reasoning: true, contextWindow: 131072, maxTokens: 32768, cost: { input: 5, output: 25 } },
    ],
  },
  mistral: {
    label: 'Mistral',
    description: 'European AI — GDPR-friendly, fast and affordable',
    authHint: 'Get your API key at console.mistral.ai',
    models: [
      { id: 'mistral/mistral-small', name: 'Mistral Small', tier: 'fast', reasoning: false, contextWindow: 128000, maxTokens: 8192, cost: { input: 0.1, output: 0.30 } },
      { id: 'mistral/mistral-large', name: 'Mistral Large', tier: 'premium', reasoning: true, contextWindow: 128000, maxTokens: 8192, cost: { input: 2, output: 6 } },
    ],
  },
  groq: {
    label: 'Groq',
    description: 'Ultra-fast inference — open-source models at lightning speed',
    authHint: 'Get your API key at console.groq.com',
    models: [
      { id: 'groq/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout', tier: 'fast', reasoning: false, contextWindow: 131072, maxTokens: 8192, cost: { input: 0.11, output: 0.34 } },
      { id: 'groq/llama-3.3-70b-versatile', name: 'Llama 3.3 70B', tier: 'balanced', reasoning: false, contextWindow: 131072, maxTokens: 32768, cost: { input: 0.59, output: 0.79 } },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    description: 'Access 200+ models through one API key — ultimate flexibility',
    authHint: 'Get your API key at openrouter.ai/keys',
    models: [
      { id: 'openrouter/auto', name: 'Auto (best available)', tier: 'balanced', reasoning: false, contextWindow: 128000, maxTokens: 16384 },
    ],
  },
  custom: {
    label: 'Custom Provider',
    description: 'Any OpenAI or Anthropic-compatible API endpoint',
    authHint: 'Enter the base URL and API key for your provider',
    models: [],
  },
};
