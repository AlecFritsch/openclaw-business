import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Custom transform: convert Zod schemas to JSON Schema directly,
// bypassing zod-openapi which crashes on complex nested schemas.
function isZodSchema(val: unknown): val is ZodType {
  return val != null && typeof val === 'object' && '_def' in (val as any);
}

function convertZodSchemas(schema: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(schema)) {
    if (val == null) continue;
    if (key === 'response') {
      // response is { 200: zodSchema, 404: zodSchema, ... }
      const resp: Record<string, any> = {};
      for (const [code, s] of Object.entries(val as Record<string, any>)) {
        if (isZodSchema(s)) {
          try {
            resp[code] = zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' });
          } catch { resp[code] = {}; }
        } else {
          resp[code] = s;
        }
      }
      out[key] = resp;
    } else if (isZodSchema(val)) {
      try {
        out[key] = zodToJsonSchema(val, { target: 'openApi3', $refStrategy: 'none' });
      } catch { out[key] = {}; }
    } else {
      out[key] = val;
    }
  }
  return out;
}

const safeTransform = ({ schema, url }: any) => {
  try {
    return { schema: schema ? convertZodSchemas(schema) : {}, url };
  } catch (err) {
    console.warn(`[openapi] Transform failed for ${url}:`, (err as Error).message);
    return { schema: {}, url };
  }
};

export const swaggerConfig: FastifyDynamicSwaggerOptions = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'OpenClaw Business API',
      description: 'AI Agent Deployment Platform — Full API Reference.\n\nAuthenticate with either a Clerk JWT (frontend) or an API Key (`agx_*`, Pro+ plan required).',
      version: '1.0.0',
      contact: { name: 'OpenClaw Business', url: 'https://github.com/openclaw/openclaw-business' },
    },
    servers: [
      { url: 'http://localhost:8080', description: 'Local' },
      { url: 'http://localhost:8080', description: 'Development' },
    ],
    tags: [
      { name: 'Health', description: 'Service health checks' },
      { name: 'Agents', description: 'Agent lifecycle management (CRUD, pause, resume, delete)' },
      { name: 'Agent Configuration', description: 'Full agent configuration (80+ fields)' },
      { name: 'Agent Channels', description: 'Per-agent channel connections' },
      { name: 'Agent Team', description: 'Agent team member management' },
      { name: 'Agent Analytics', description: 'Per-agent analytics and metrics' },
      { name: 'Sessions', description: 'Chat sessions and messaging' },
      { name: 'Channels', description: 'Global channel management' },
      { name: 'Gateway', description: 'Live agent gateway — RPC proxy to OpenClaw container' },
      { name: 'Workspace', description: 'Agent workspace files (AGENTS.md, SOUL.md, etc.)' },
      { name: 'Memory', description: 'Agent memory management and search' },
      { name: 'Skills', description: 'ClawHub skill marketplace — browse, install, manage' },
      { name: 'Workflows', description: 'Lobster workflow pipelines' },
      { name: 'Sub-Agents', description: 'Multi-agent routing and sub-agent management' },
      { name: 'Analytics', description: 'Dashboard-level usage and performance metrics' },
      { name: 'Organization', description: 'Organization settings and team members' },
      { name: 'Billing', description: 'Subscription, usage, and invoices' },
      { name: 'Users', description: 'User profile and API key management' },
      { name: 'Providers', description: 'AI model provider management (API keys, models)' },
      { name: 'Templates', description: 'Agent templates — browse and deploy' },
      { name: 'Webhooks', description: 'User webhook management and Clerk webhooks' },
      { name: 'Integrations', description: 'Third-party integration connections' },
      { name: 'Support', description: 'Support ticket system' },
      { name: 'AI Helpers', description: 'AI-powered assistants (Agent Architect, Support Suggest, Analytics Insights)' },
      { name: 'Operations', description: 'Operations dashboard overview' },
      { name: 'Activity', description: 'Activity feed and event logging' },
      { name: 'Logs', description: 'System and agent log queries' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Clerk JWT Token — obtained from the frontend via Clerk authentication.',
        },
        apiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'agx_*',
          description: 'API Key — generated in Settings > API Keys. Requires Pro plan or higher.',
        },
      },
    },
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  },
  transform: safeTransform,
};
