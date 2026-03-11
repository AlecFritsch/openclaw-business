// Model Failover Service - Manages model provider configuration and failover
// Configures model allowlists, auth profiles, and fallback chains

import { getDatabase } from '../config/database.js';
import { deploymentService } from './deployment.service.js';
import type {
  ModelConfig,
  ModelEntry,
  ModelProviderConfig,
  OpenClawFullConfig,
} from '@openclaw-business/shared';

// ── Types ───────────────────────────────────────────────────────

export interface AgentModelConfig {
  agentId: string;
  userId: string;
  primaryModel: string;
  fallbackModels: string[];
  modelAllowlist: Record<string, { alias?: string; params?: Record<string, unknown> }>;
  providers: Record<string, {
    apiKey?: string;
    baseUrl?: string;
  }>;
  openaiCompatEnabled: boolean;
  updatedAt: Date;
}

export interface UpdateModelConfigRequest {
  primaryModel?: string;
  fallbackModels?: string[];
  addModel?: { id: string; alias?: string; params?: Record<string, unknown> };
  removeModel?: string;
  setProvider?: { name: string; apiKey?: string; baseUrl?: string };
  removeProvider?: string;
  openaiCompatEnabled?: boolean;
}

// ── Available Models ────────────────────────────────────────────

export const AVAILABLE_MODELS = [
  // Anthropic
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', tier: 'premium' },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', tier: 'balanced' },
  // OpenAI
  { id: 'openai/gpt-5.2', name: 'GPT-5.2', provider: 'openai', tier: 'premium' },
  { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', tier: 'fast' },
  // Google
  { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'google', tier: 'balanced' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google', tier: 'fast' },
  // OpenRouter
  { id: 'openrouter/auto', name: 'OpenRouter Auto', provider: 'openrouter', tier: 'balanced' },
];

// ── Model Failover Service ──────────────────────────────────────

export class ModelFailoverService {
  private get collection() {
    return getDatabase().collection<AgentModelConfig>('agent_model_configs');
  }

  /**
   * Get model configuration for an agent
   */
  async getModelConfig(agentId: string, userId: string): Promise<AgentModelConfig | null> {
    return this.collection.findOne({ agentId, userId });
  }

  /**
   * Initialize model config for a new agent
   */
  async initModelConfig(agentId: string, userId: string, primaryModel: string): Promise<AgentModelConfig> {
    const config: AgentModelConfig = {
      agentId,
      userId,
      primaryModel,
      fallbackModels: [],
      modelAllowlist: {
        [primaryModel]: { alias: primaryModel.split('/').pop() },
      },
      providers: {},
      openaiCompatEnabled: false,
      updatedAt: new Date(),
    };

    const result = await this.collection.insertOne(config as any);
    return { ...config, _id: result.insertedId } as any;
  }

  /**
   * Update model configuration
   */
  async updateModelConfig(
    agentId: string,
    userId: string,
    request: UpdateModelConfigRequest
  ): Promise<void> {
    let config = await this.collection.findOne({ agentId, userId });
    if (!config) {
      config = await this.initModelConfig(agentId, userId, request.primaryModel || '') as any;
    }

    const updates: any = { updatedAt: new Date() };

    if (request.primaryModel) {
      updates.primaryModel = request.primaryModel;
      // Ensure primary is in allowlist
      updates[`modelAllowlist.${request.primaryModel}`] = {
        alias: request.primaryModel.split('/').pop(),
      };
    }

    if (request.fallbackModels) {
      updates.fallbackModels = request.fallbackModels;
    }

    if (request.addModel) {
      updates[`modelAllowlist.${request.addModel.id}`] = {
        alias: request.addModel.alias || request.addModel.id.split('/').pop(),
        params: request.addModel.params,
      };
    }

    if (request.removeModel) {
      updates[`modelAllowlist.${request.removeModel}`] = null;
    }

    if (request.setProvider) {
      updates[`providers.${request.setProvider.name}`] = {
        apiKey: request.setProvider.apiKey,
        baseUrl: request.setProvider.baseUrl,
      };
    }

    if (request.removeProvider) {
      updates[`providers.${request.removeProvider}`] = null;
    }

    if (request.openaiCompatEnabled !== undefined) {
      updates.openaiCompatEnabled = request.openaiCompatEnabled;
    }

    await this.collection.updateOne(
      { agentId, userId },
      { $set: updates }
    );

    // Sync to OpenClaw config
    await this.syncModelConfigToOpenClaw(agentId, userId);
  }

  /**
   * Sync model config to OpenClaw
   */
  private async syncModelConfigToOpenClaw(agentId: string, userId: string): Promise<void> {
    try {
      const config = await this.collection.findOne({ agentId, userId });
      if (!config) return;

      const openclawUpdates: Partial<OpenClawFullConfig> = {};

      // Model config
      const model: ModelConfig = {
        primary: config.primaryModel,
        fallbacks: config.fallbackModels.length > 0 ? config.fallbackModels : undefined,
      };

      const models: Record<string, ModelEntry> = {};
      for (const [modelId, entry] of Object.entries(config.modelAllowlist)) {
        if (entry) {
          models[modelId] = entry;
        }
      }

      openclawUpdates.agents = {
        defaults: {
          model,
          models,
        },
      };

      // Provider config
      if (Object.keys(config.providers).length > 0) {
        const providers: Record<string, ModelProviderConfig> = {};
        for (const [name, providerConf] of Object.entries(config.providers)) {
          if (providerConf) {
            providers[name] = {
              apiKey: providerConf.apiKey,
              baseUrl: providerConf.baseUrl,
            };
          }
        }
        openclawUpdates.models = { providers };
      }

      // OpenAI-compatible API
      if (config.openaiCompatEnabled) {
        openclawUpdates.gateway = {
          http: {
            endpoints: {
              chatCompletions: { enabled: true },
              responses: { enabled: false },
            },
          },
        };
      }

      await deploymentService.updateAgentConfig(agentId, openclawUpdates);
    } catch (error) {
      console.error(`Failed to sync model config for ${agentId}:`, error);
    }
  }

  /**
   * Get available models list
   */
  getAvailableModels() {
    return AVAILABLE_MODELS;
  }
}

export const modelFailoverService = new ModelFailoverService();
