import { ObjectId } from 'mongodb';
import type { OpenClawConfig, OpenClawFullConfig } from './openclaw.types.js';

export interface Template {
  _id?: ObjectId;
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string;
  /** Legacy simplified config. Prefer `fullConfig` for new templates. */
  config: OpenClawConfig;
  /** Full OpenClaw config for new-style templates */
  fullConfig?: OpenClawFullConfig;
  channels: string[];
  features: string[];
  integrations: string[];
  pricing: {
    setup: number;
    monthly: number;
    perOutcome?: number;
    outcomeLabel?: string;
  };
  popularity: number; // deploy count
  isPublic: boolean;
  createdBy?: string; // userId
  createdAt: Date;
  updatedAt: Date;
}

export type TemplateCategory = 'sales' | 'support' | 'marketing' | 'operations' | 'finance';

export interface CreateTemplateRequest {
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string;
  config: OpenClawConfig;
  fullConfig?: OpenClawFullConfig;
  channels: string[];
  features?: string[];
  integrations?: string[];
  pricing: Template['pricing'];
  isPublic?: boolean;
}

export interface DeployFromTemplateRequest {
  name?: string;
  channels?: string[];
  systemPromptOverride?: string;
}
