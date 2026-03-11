// Agent Skills Routes - Manage ClawHub skills per agent
// Full security pipeline: ClawHub moderation + VirusTotal verification

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateObjectId } from '../../validation/schemas.js';
import { clawHubService } from '../../services/clawhub.service.js';
import { workspaceService } from '../../services/workspace.service.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

export async function agentSkillsRoutes(fastify: FastifyInstance) {
  // ── Trial guard: block mutations when trial has expired ──────────
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return;
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Trial expired',
        message: 'Your 7-day trial has expired. Upgrade to Professional to continue.',
      });
    }
  });

  // GET /api/skills/browse - Browse available skills from ClawHub (real API)
  fastify.get('/browse', {
    schema: {
      tags: ['Skills'],
      summary: 'Browse available skills',
      description: 'Browse available skills from the ClawHub marketplace. Supports filtering by category, search query, and pagination.',
      querystring: z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      }),
      response: {
        200: z.object({
          skills: z.array(z.any()),
          total: z.number().optional(),
        }),
      },
    },
  }, async (request) => {
    const { category, search, limit, offset } = request.query as any;
    // Guard against literal "undefined" strings from URLSearchParams serialization
    const cleanStr = (v: unknown) => (typeof v === 'string' && v !== 'undefined' && v.trim()) ? v.trim() : undefined;
    return clawHubService.browseSkills({
      category: cleanStr(category),
      search: cleanStr(search),
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  });

  // GET /api/skills/browse/:slug - Get single skill details with security info
  fastify.get<{ Params: { slug: string } }>('/browse/:slug', {
    schema: {
      tags: ['Skills'],
      summary: 'Get skill details',
      description: 'Retrieve detailed information about a single skill from ClawHub, including security metadata.',
      params: z.object({ slug: z.string().describe('Skill slug identifier') }),
      response: {
        200: z.object({ skill: z.any() }),
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const skill = await clawHubService.getSkill(request.params.slug);
    if (!skill) {
      return reply.code(404).send({ error: 'Skill not found' });
    }
    return { skill };
  });

  // GET /api/skills/security/:slug - Pre-install security check
  fastify.get<{ Params: { slug: string } }>('/security/:slug', {
    schema: {
      tags: ['Skills'],
      summary: 'Pre-install security check',
      description: 'Run a security check on a skill before installation. Returns security status, warnings, and whether the skill is allowed.',
      params: z.object({ slug: z.string().describe('Skill slug identifier') }),
      response: {
        200: z.object({
          slug: z.string(),
          allowed: z.boolean(),
          security: z.any(),
          warnings: z.array(z.string()).optional(),
          skill: z.any().nullable(),
        }),
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { slug } = request.params;

    try {
      const check = await clawHubService.securityCheck(slug);
      return {
        slug,
        allowed: check.allowed,
        security: check.security,
        warnings: check.warnings,
        skill: check.skill ? {
          name: check.skill.name,
          version: check.skill.version,
          owner: check.skill.owner,
          stats: check.skill.stats,
        } : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Security check failed';
      return reply.code(500).send({ error: message });
    }
  });

  // GET /api/skills/requirements/:slug - Parse SKILL.md for env/primaryEnv requirements
  fastify.get<{ Params: { slug: string } }>('/requirements/:slug', {
    schema: {
      tags: ['Skills'],
      summary: 'Get skill requirements',
      description: 'Parse SKILL.md for required env vars and primaryEnv. Enforces configure-before-enable.',
      params: z.object({ slug: z.string().describe('Skill slug') }),
      response: { 200: z.object({ envVars: z.array(z.string()), primaryEnv: z.string().nullable() }) },
    },
  }, async (request) => clawHubService.getSkillRequirements(request.params.slug));

  // GET /api/skills/readme/:slug - Get SKILL.md content for review
  fastify.get<{ Params: { slug: string } }>('/readme/:slug', {
    schema: {
      tags: ['Skills'],
      summary: 'Get skill readme',
      description: 'Retrieve the SKILL.md content for a skill, allowing users to review instructions before installation.',
      params: z.object({ slug: z.string().describe('Skill slug identifier') }),
      response: {
        200: z.object({ content: z.string() }),
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const content = await clawHubService.getSkillReadme(request.params.slug);
    if (!content) {
      return reply.code(404).send({ error: 'SKILL.md not found' });
    }
    return { content };
  });

  // GET /api/skills/agents/:id - Get installed skills for an agent
  fastify.get<{ Params: { id: string } }>('/agents/:id', {
    schema: {
      tags: ['Skills'],
      summary: 'List installed skills',
      description: 'Get all skills currently installed on a specific agent.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ skills: z.array(z.any()) }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const skills = await clawHubService.getInstalledSkills(agentId, userId);
    return { skills };
  });

  // POST /api/skills/agents/:id/install - Install a skill for an agent (with security check)
  fastify.post<{
    Params: { id: string };
    Body: {
      slug: string;
      env?: Record<string, string>;
      apiKey?: string;
      acknowledgedWarnings?: boolean;
    };
  }>('/agents/:id/install', {
    schema: {
      tags: ['Skills'],
      summary: 'Install a skill',
      description: 'Install a ClawHub skill on an agent. Runs a security check first and may return warnings that require acknowledgement.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        slug: z.string().describe('Skill slug to install'),
        env: z.record(z.string()).optional().describe('Environment variables for the skill'),
        apiKey: z.string().optional().describe('API key for the skill'),
        acknowledgedWarnings: z.boolean().optional().describe('Acknowledge security warnings to proceed'),
      }),
      response: {
        201: z.object({ skill: z.any() }),
        400: errorResponseSchema,
        403: errorResponseSchema,
        422: z.object({
          error: z.literal('security_warning'),
          warnings: z.array(z.string()),
          security: z.any(),
          message: z.string(),
        }),
      },
    },
    preHandler: requirePermission('agents.skills.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { slug, env, apiKey, acknowledgedWarnings } = request.body;
    if (!slug) {
      return reply.code(400).send({ error: 'Skill slug is required' });
    }

    try {
      const installed = await clawHubService.installSkill(
        agentId, userId, slug, env, apiKey, acknowledgedWarnings
      );

      // Regenerate persona files (AGENTS.md + TOOLS.md reference skills)
      workspaceService.regeneratePersonaFiles(agentId).catch(err =>
        console.warn(`[skills] Persona regen failed after install for ${agentId}:`, err instanceof Error ? err.message : err)
      );

      return reply.code(201).send({ skill: installed });
    } catch (error) {
      if (error instanceof Error) {
        // Security blocked — return 403
        if (error.message.startsWith('SECURITY_BLOCKED:')) {
          return reply.code(403).send({
            error: 'blocked',
            message: error.message.replace('SECURITY_BLOCKED: ', ''),
          });
        }

        // Security warning — return 422 with warnings for user confirmation
        if (error.message === 'SECURITY_WARNING') {
          return reply.code(422).send({
            error: 'security_warning',
            warnings: (error as any).warnings,
            security: (error as any).security,
            message: 'Security warnings require acknowledgement. Set acknowledgedWarnings: true to proceed.',
          });
        }
      }

      const message = error instanceof Error ? error.message : 'Failed to install skill';
      return reply.code(400).send({ error: message });
    }
  });

  // DELETE /api/skills/agents/:id/:slug - Uninstall a skill
  fastify.delete<{ Params: { id: string; slug: string } }>('/agents/:id/:slug', {
    schema: {
      tags: ['Skills'],
      summary: 'Uninstall a skill',
      description: 'Remove an installed skill from an agent and regenerate persona files.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        slug: z.string().describe('Skill slug to uninstall'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.skills.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      await clawHubService.uninstallSkill(agentId, userId, request.params.slug);

      // Regenerate persona files (AGENTS.md + TOOLS.md reference skills)
      workspaceService.regeneratePersonaFiles(agentId).catch(err =>
        console.warn(`[skills] Persona regen failed after uninstall for ${agentId}:`, err instanceof Error ? err.message : err)
      );

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to uninstall skill';
      return reply.code(400).send({ error: message });
    }
  });

  // PATCH /api/skills/agents/:id/:slug - Update skill config
  fastify.patch<{
    Params: { id: string; slug: string };
    Body: { enabled?: boolean; env?: Record<string, string>; apiKey?: string };
  }>('/agents/:id/:slug', {
    schema: {
      tags: ['Skills'],
      summary: 'Update skill configuration',
      description: 'Update an installed skill\'s configuration, including toggling enabled state and updating environment variables or API key.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        slug: z.string().describe('Skill slug to update'),
      }),
      body: z.object({
        enabled: z.boolean().optional().describe('Enable or disable the skill'),
        env: z.record(z.string()).optional().describe('Environment variables'),
        apiKey: z.string().optional().describe('API key for the skill'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        422: z.object({
          error: z.literal('config_required'),
          message: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { enabled, env, apiKey } = request.body;

    try {
      if (enabled !== undefined) {
        await clawHubService.toggleSkill(agentId, userId, request.params.slug, enabled);
      }
      if (env || apiKey !== undefined) {
        await clawHubService.updateSkillConfig(agentId, userId, request.params.slug, { env, apiKey });
      }
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update skill';
      const code = (error as any)?.code;
      if (code === 'CONFIG_REQUIRED') {
        return reply.code(422).send({ error: 'config_required', message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  // GET /api/skills/rescan/status - Get security re-scan status
  fastify.get('/rescan/status', {
    schema: {
      tags: ['Skills'],
      summary: 'Get rescan status',
      description: 'Get the current status of the background security re-scan process for all installed skills.',
      response: {
        200: z.object({
          running: z.boolean(),
          lastRun: z.string().nullable().optional(),
          results: z.any().optional(),
        }),
      },
    },
  }, async () => {
    return clawHubService.getRescanStatus();
  });

  // POST /api/skills/rescan/run - Manually trigger a security re-scan
  fastify.post('/rescan/run', {
    schema: {
      tags: ['Skills'],
      summary: 'Trigger security rescan',
      description: 'Manually trigger a security re-scan of all installed skills across all agents. Returns the scan results.',
      response: {
        200: z.object({
          success: z.literal(true),
          scanned: z.number().optional(),
          flagged: z.number().optional(),
        }),
      },
    },
  }, async () => {
    const result = await clawHubService.rescanAllInstalledSkills();
    return { success: true, ...result };
  });
}
