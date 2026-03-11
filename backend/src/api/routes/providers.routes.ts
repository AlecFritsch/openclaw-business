import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
  providerResponseSchema,
} from '../../validation/response-schemas.js';
import type {
  AIProvider,
  AIProviderType,
  CreateProviderRequest,
  UpdateProviderRequest,
  ValidateProviderResponse,
} from '@openclaw-business/shared';
import { PROVIDER_CATALOG } from '@openclaw-business/shared';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { validateObjectId } from '../../validation/schemas.js';

// ─── Provider API key validation helpers ────────────────────────

async function validateAnthropicKey(apiKey: string): Promise<ValidateProviderResponse> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    // 200 = success, 400 = bad request but key valid, 429 = rate-limited but key valid
    if (res.ok || res.status === 400 || res.status === 429) {
      return {
        valid: true,
        models: [
          'anthropic/claude-sonnet-4-6',
          'anthropic/claude-opus-4-6',
        ],
      };
    }
    const body = await res.json().catch(() => ({}));
    return { valid: false, error: (body as any)?.error?.message || `HTTP ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Connection failed' };
  }
}

async function validateOpenAIKey(apiKey: string): Promise<ValidateProviderResponse> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return {
        valid: true,
        models: ['openai/gpt-5-mini', 'openai/gpt-5.2', 'openai/o3', 'openai/o4-mini'],
      };
    }
    const body = await res.json().catch(() => ({}));
    return { valid: false, error: (body as any)?.error?.message || `HTTP ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Connection failed' };
  }
}

async function validateGoogleKey(apiKey: string): Promise<ValidateProviderResponse> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (res.ok) {
      return {
        valid: true,
        models: ['google/gemini-3-flash-preview', 'google/gemini-3-pro-preview'],
      };
    }
    const body = await res.json().catch(() => ({}));
    return { valid: false, error: (body as any)?.error?.message || `HTTP ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Connection failed' };
  }
}

async function validateOpenRouterKey(apiKey: string): Promise<ValidateProviderResponse> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return { valid: true, models: ['openrouter/auto'] };
    }
    return { valid: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Connection failed' };
  }
}

async function validateXAIKey(apiKey: string): Promise<ValidateProviderResponse> {
  try {
    const res = await fetch('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return {
        valid: true,
        models: ['xai/grok-3', 'xai/grok-4'],
      };
    }
    const body = await res.json().catch(() => ({}));
    return { valid: false, error: (body as any)?.error?.message || `HTTP ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Connection failed' };
  }
}

async function validateGroqKey(apiKey: string): Promise<ValidateProviderResponse> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return {
        valid: true,
        models: ['groq/llama-4-scout-17b-16e-instruct', 'groq/llama-3.3-70b-versatile'],
      };
    }
    const body = await res.json().catch(() => ({}));
    return { valid: false, error: (body as any)?.error?.message || `HTTP ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Connection failed' };
  }
}

async function validateMistralKey(apiKey: string): Promise<ValidateProviderResponse> {
  try {
    const res = await fetch('https://api.mistral.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return {
        valid: true,
        models: ['mistral/mistral-small', 'mistral/mistral-large'],
      };
    }
    const body = await res.json().catch(() => ({}));
    return { valid: false, error: (body as any)?.error?.message || `HTTP ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Connection failed' };
  }
}

async function validateProviderKey(
  provider: AIProviderType,
  apiKey: string,
  _baseUrl?: string
): Promise<ValidateProviderResponse> {
  switch (provider) {
    case 'anthropic':
      return validateAnthropicKey(apiKey);
    case 'openai':
      return validateOpenAIKey(apiKey);
    case 'google':
      return validateGoogleKey(apiKey);
    case 'openrouter':
      return validateOpenRouterKey(apiKey);
    case 'xai':
      return validateXAIKey(apiKey);
    case 'groq':
      return validateGroqKey(apiKey);
    case 'mistral':
      return validateMistralKey(apiKey);
    default:
      // For custom — accept without live validation
      return { valid: true, models: [] };
  }
}

// ─── Routes ─────────────────────────────────────────────────────

export async function providersRoutes(fastify: FastifyInstance) {
  // Trial guard: block mutations when trial expired
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && request.trialExpired) {
      return reply.code(403).send({ error: 'Trial expired. Please upgrade to continue.' });
    }
  });

  const db = getDatabase();
  const collection = db.collection<AIProvider>('providers');

  // GET /api/providers — list org providers
  fastify.get('/', {
    schema: {
      tags: ['Providers'],
      summary: 'List organization providers',
      description: 'Returns all AI providers configured for the current organization, with encrypted API keys stripped to last four characters only.',
      response: {
        200: z.object({
          providers: z.array(providerResponseSchema),
        }),
      },
    },
  }, async (request) => {
    const orgId = request.organizationId;
    if (!orgId) {
      return { providers: [] };
    }

    const providers = await collection
      .find({ organizationId: orgId })
      .sort({ createdAt: 1 })
      .toArray();

    // Strip encrypted keys — return last four only, convert MongoDB types to strings
    return {
      providers: providers.map((p) => ({
        _id: p._id!.toString(),
        provider: p.provider,
        label: p.label,
        status: p.status,
        apiKeyLastFour: p.apiKeyLastFour,
        baseUrl: p.baseUrl,
        availableModels: p.availableModels,
        createdAt: new Date(p.createdAt).toISOString(),
        updatedAt: new Date(p.updatedAt).toISOString(),
      })),
    };
  });

  // POST /api/providers — add a provider
  fastify.post<{ Body: CreateProviderRequest }>('/', {
    schema: {
      tags: ['Providers'],
      summary: 'Add a new provider',
      description: 'Registers a new AI provider for the organization. Validates the API key against the provider and stores it encrypted.',
      body: z.object({
        provider: z.string().describe('Provider type (e.g. anthropic, openai, google)'),
        apiKey: z.string().describe('Provider API key'),
        baseUrl: z.string().optional().describe('Custom base URL for the provider'),
        label: z.string().optional().describe('Human-readable label'),
      }),
      response: {
        201: providerResponseSchema.extend({
          validation: z.object({
            valid: z.boolean(),
            models: z.array(z.string()).optional(),
            error: z.string().optional(),
          }),
        }),
        400: errorResponseSchema,
        403: errorResponseSchema,
        409: errorResponseSchema,
      },
    },
    preHandler: requirePermission('providers.manage'),
  }, async (request, reply) => {
    const orgId = request.organizationId;
    if (!orgId) {
      return reply.code(403).send({ error: 'Organization required' });
    }

    const { provider, apiKey, baseUrl, label } = request.body;

    if (!provider || !apiKey) {
      return reply.code(400).send({ error: 'provider and apiKey are required' });
    }

    // Check for duplicate
    const existing = await collection.findOne({
      organizationId: orgId,
      provider,
    });
    if (existing) {
      return reply.code(409).send({ error: `Provider ${provider} already configured. Use PATCH to update.` });
    }

    // Validate the key
    const validation = await validateProviderKey(provider, apiKey, baseUrl);

    const now = new Date();
    const doc: AIProvider = {
      organizationId: orgId,
      provider,
      label: label || providerDefaultLabel(provider),
      status: validation.valid ? 'active' : 'invalid',
      apiKeyEncrypted: encrypt(apiKey),
      apiKeyLastFour: apiKey.slice(-4),
      baseUrl,
      availableModels: validation.models || [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await collection.insertOne(doc as any);

    if (request.audit) {
      await request.audit({
        category: 'security.change',
        action: 'security.provider_key_added',
        title: `AI Provider "${doc.label || provider}" hinzugefügt`,
        description: `API Key für ${provider} hinzugefügt (****${doc.apiKeyLastFour}). ${doc.availableModels.length} Modelle verfügbar.`,
        reasoning: 'Benutzer hat einen neuen AI Provider konfiguriert für Agent-Inferenz',
        riskLevel: 'high',
        outcome: 'success',
        resource: { type: 'provider', id: result.insertedId.toString(), name: doc.label || provider },
        metadata: { provider, apiKeyLastFour: doc.apiKeyLastFour, modelCount: doc.availableModels.length },
      });
    }

    return reply.code(201).send({
      _id: result.insertedId.toString(),
      provider: doc.provider,
      label: doc.label,
      status: doc.status,
      apiKeyLastFour: doc.apiKeyLastFour,
      baseUrl: doc.baseUrl,
      availableModels: doc.availableModels,
      validation,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    });
  });

  // PATCH /api/providers/:id — update a provider (rotate key, change label)
  fastify.patch<{ Params: { id: string }; Body: UpdateProviderRequest }>(
    '/:id',
    {
      schema: {
        tags: ['Providers'],
        summary: 'Update a provider',
        description: 'Updates an existing provider configuration. Can rotate the API key, change label, or update the base URL.',
        params: z.object({
          id: z.string().describe('Provider ID'),
        }),
        body: z.object({
          apiKey: z.string().optional().describe('New API key to rotate to'),
          baseUrl: z.string().optional().describe('Updated base URL'),
          label: z.string().optional().describe('Updated label'),
        }),
        response: {
          200: successResponseSchema.extend({
            status: z.string(),
          }),
          403: errorResponseSchema,
          404: notFoundErrorSchema,
        },
      },
      preHandler: requirePermission('providers.manage'),
    },
    async (request, reply) => {
      const orgId = request.organizationId;
      if (!orgId) {
        return reply.code(403).send({ error: 'Organization required' });
      }
      if (!validateObjectId(request.params.id)) {
        return reply.code(400).send({ error: 'Invalid provider ID format' });
      }

      const { ObjectId } = await import('mongodb');
      const existing = await collection.findOne({
        _id: new ObjectId(request.params.id),
        organizationId: orgId,
      });
      if (!existing) {
        return reply.code(404).send({ error: 'Provider not found' });
      }

      const { apiKey, baseUrl, label } = request.body;
      const update: Record<string, any> = { updatedAt: new Date() };

      if (label) update.label = label;
      if (baseUrl !== undefined) update.baseUrl = baseUrl;

      if (apiKey) {
        // Validate new key
        const validation = await validateProviderKey(existing.provider, apiKey, baseUrl || existing.baseUrl);
        update.apiKeyEncrypted = encrypt(apiKey);
        update.apiKeyLastFour = apiKey.slice(-4);
        update.status = validation.valid ? 'active' : 'invalid';
        update.availableModels = validation.models || existing.availableModels;
      }

      await collection.updateOne(
        { _id: existing._id },
        { $set: update }
      );

      return { success: true, status: update.status || existing.status };
    }
  );

  // DELETE /api/providers/:id — remove a provider
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Providers'],
      summary: 'Delete a provider',
      description: 'Removes an AI provider configuration from the organization permanently.',
      params: z.object({
        id: z.string().describe('Provider ID'),
      }),
      response: {
        200: successResponseSchema,
        403: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('providers.manage'),
  }, async (request, reply) => {
    const orgId = request.organizationId;
    if (!orgId) {
      return reply.code(403).send({ error: 'Organization required' });
    }
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid provider ID format' });
    }

    const { ObjectId } = await import('mongodb');
    const existing = await collection.findOne({
      _id: new ObjectId(request.params.id),
      organizationId: orgId,
    });

    const result = await collection.deleteOne({
      _id: new ObjectId(request.params.id),
      organizationId: orgId,
    });

    if (result.deletedCount === 0) {
      return reply.code(404).send({ error: 'Provider not found' });
    }

    if (request.audit) {
      await request.audit({
        category: 'security.change',
        action: 'security.provider_key_removed',
        title: `AI Provider "${existing?.label || existing?.provider || 'unbekannt'}" entfernt`,
        description: `API Key für ${existing?.provider || 'unbekannt'} (****${existing?.apiKeyLastFour || '????'}) entfernt. Alle Agenten die diesen Provider nutzten verlieren Zugang.`,
        reasoning: 'Benutzer hat einen AI Provider entfernt',
        riskLevel: 'high',
        outcome: 'success',
        resource: { type: 'provider', id: request.params.id, name: existing?.label || existing?.provider },
      });
    }

    return { success: true };
  });

  // POST /api/providers/validate — validate a key without saving
  fastify.post<{ Body: { provider: AIProviderType; apiKey: string; baseUrl?: string } }>(
    '/validate',
    {
      schema: {
        tags: ['Providers'],
        summary: 'Validate a provider API key',
        description: 'Tests an API key against the specified provider without saving it. Returns whether the key is valid and which models are available.',
        body: z.object({
          provider: z.string().describe('Provider type to validate against'),
          apiKey: z.string().describe('API key to validate'),
          baseUrl: z.string().optional().describe('Custom base URL'),
        }),
        response: {
          200: z.object({
            valid: z.boolean(),
            models: z.array(z.string()).optional(),
            error: z.string().optional(),
          }),
        },
      },
    },
    async (request) => {
      const { provider, apiKey, baseUrl } = request.body;
      return validateProviderKey(provider, apiKey, baseUrl);
    }
  );

  // Helper: resolve model IDs to catalog entries (PROVIDER_CATALOG)
  function resolveModelsToCatalog(
    modelIds: string[],
    plan: string
  ): Array<{ id: string; name: string; provider: AIProviderType; tier: string; reasoning: boolean; contextWindow: number; maxTokens: number; cost?: { input: number; output: number } }> {
    const premiumIds = new Set<string>();
    if (plan === 'unpaid') {
      for (const catalog of Object.values(PROVIDER_CATALOG)) {
        for (const m of catalog.models) {
          if (m.tier === 'premium') premiumIds.add(m.id);
        }
      }
    }
    const filtered = plan === 'unpaid' ? modelIds.filter((id) => !premiumIds.has(id)) : modelIds;
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string; provider: AIProviderType; tier: string; reasoning: boolean; contextWindow: number; maxTokens: number; cost?: { input: number; output: number } }> = [];

    for (const id of filtered) {
      if (seen.has(id)) continue;
      seen.add(id);
      let found = false;
      for (const [provider, catalog] of Object.entries(PROVIDER_CATALOG)) {
        const m = catalog.models.find((mm) => mm.id === id);
        if (m) {
          out.push({
            id: m.id,
            name: m.name,
            provider: provider as AIProviderType,
            tier: m.tier,
            reasoning: m.reasoning,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            cost: m.cost,
          });
          found = true;
          break;
        }
      }
      if (!found) {
        const [provider] = id.split('/');
        out.push({
          id,
          name: id.split('/').pop() || id,
          provider: (provider || 'custom') as AIProviderType,
          tier: 'balanced',
          reasoning: false,
          contextWindow: 128000,
          maxTokens: 16384,
        });
      }
    }
    return out;
  }

  // GET /api/providers/models/detailed — available models with tier, cost, context
  fastify.get('/models/detailed', {
    schema: {
      tags: ['Providers'],
      summary: 'List available models (detailed)',
      description: 'Returns all available AI models with tier, cost, contextWindow. Trial plans exclude premium models.',
      response: {
        200: z.object({
          models: z.array(z.object({
            id: z.string(),
            name: z.string(),
            provider: z.string(),
            tier: z.string(),
            reasoning: z.boolean(),
            contextWindow: z.number(),
            maxTokens: z.number(),
            cost: z.object({ input: z.number(), output: z.number() }).optional(),
          })),
          providers: z.array(z.string()),
        }),
      },
    },
  }, async (request) => {
    const orgId = request.organizationId;
    if (!orgId) {
      return { models: [], providers: [] };
    }
    const providers = await collection
      .find({ organizationId: orgId, status: 'active' })
      .toArray();
    let modelIds = providers.flatMap((p) => {
      const fromProvider = p.availableModels || [];
      if (fromProvider.length > 0) return fromProvider;
      const catalog = PROVIDER_CATALOG[p.provider];
      return catalog?.models.map((m) => m.id) ?? [];
    });
    modelIds = [...new Set(modelIds)];
    const catalog = resolveModelsToCatalog(modelIds, request.plan || 'professional');
    return {
      models: catalog,
      providers: providers.map((p) => p.provider),
    };
  });

  // GET /api/providers/models — get all available models for this org
  fastify.get('/models', {
    schema: {
      tags: ['Providers'],
      summary: 'List available models',
      description: 'Returns all available AI models across active providers for the current organization. Trial plans are restricted to non-premium models.',
      response: {
        200: z.object({
          models: z.array(z.string()),
          providers: z.array(z.string()),
        }),
      },
    },
  }, async (request) => {
    const orgId = request.organizationId;
    if (!orgId) {
      return { models: [] };
    }

    const providers = await collection
      .find({ organizationId: orgId, status: 'active' })
      .toArray();

    let models = providers.flatMap((p) => {
      const fromProvider = p.availableModels || [];
      if (fromProvider.length > 0) return fromProvider;
      const catalog = PROVIDER_CATALOG[p.provider];
      return catalog?.models.map((m) => m.id) ?? [];
    });
    models = [...new Set(models)];

    if (request.plan === 'unpaid') {
      const premiumModelIds = new Set<string>();
      for (const catalog of Object.values(PROVIDER_CATALOG)) {
        for (const m of catalog.models) {
          if (m.tier === 'premium') premiumModelIds.add(m.id);
        }
      }
      models = models.filter((m) => !premiumModelIds.has(m));
    }

    return { models, providers: providers.map((p) => p.provider) };
  });
}

function providerDefaultLabel(provider: AIProviderType): string {
  const labels: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    xai: 'xAI',
    mistral: 'Mistral',
    groq: 'Groq',
    openrouter: 'OpenRouter',
    custom: 'Custom Provider',
  };
  return labels[provider] || provider;
}
