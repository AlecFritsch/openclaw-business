// Smithery Connect — MCP connections with OAuth managed by Smithery
// Plan: POST /api/smithery/connect → auth_required + authorizationUrl or connected

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import { config } from '../../config/env.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load curated integrations from local JSON
interface CuratedRegistry {
  servers: Array<{ qualifiedName: string; displayName: string; description: string; mcpUrl: string; iconUrl: string | null; homepage?: string }>;
  skills: Array<{ namespace: string; slug: string; displayName: string; description: string; categories: string[]; homepage: string; gitUrl?: string }>;
}

let curatedRegistry: CuratedRegistry = { servers: [], skills: [] };
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(__dirname, '../../../data/curated-integrations.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  curatedRegistry = { servers: parsed.servers || [], skills: parsed.skills || [] };
  // Filter out template entries
  curatedRegistry.servers = curatedRegistry.servers.filter(s => !s.mcpUrl.includes('example'));
  curatedRegistry.skills = curatedRegistry.skills.filter(s => !s.namespace.includes('example') || !s.slug.includes('example'));
} catch {
  // File missing or invalid — no curated integrations
}

// ── In-memory cache for full server/skill lists (avoid re-fetching Smithery on every search) ──
interface CatalogCache<T> { data: T[]; ts: number; loading?: Promise<T[]> }
const serverCache: CatalogCache<any> = { data: [], ts: 0 };
const skillCache: CatalogCache<any> = { data: [], ts: 0 };
const CACHE_TTL = 5 * 60_000; // 5 min

/** Score-based search: exact name > starts-with name > contains name > contains description */
function searchRank(item: { displayName: string; description: string; qualifiedName?: string }, query: string): number {
  const q = query.toLowerCase();
  const name = item.displayName.toLowerCase();
  const qn = (item.qualifiedName ?? '').toLowerCase();
  if (name === q || qn === q) return 100;                    // exact
  if (name.startsWith(q) || qn.startsWith(q)) return 80;    // starts-with
  // word boundary match (e.g. "sheets" in "Google Sheets")
  if (name.split(/\s+/).some(w => w.startsWith(q))) return 60;
  if (name.includes(q) || qn.includes(q)) return 40;        // contains name
  if (item.description.toLowerCase().includes(q)) return 20; // contains desc
  return 0; // no match
}

export async function smitheryRoutes(fastify: FastifyInstance) {
  // Rate limit mutations (POST/PUT/PATCH/DELETE): 60/min
  fastify.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method !== 'GET' && !routeOptions.config?.rateLimit) {
      routeOptions.config = { ...routeOptions.config, rateLimit: { max: 60, timeWindow: '1 minute' } };
    }
  });
  const db = getDatabase();

  // POST /api/smithery/connect - Create or resume MCP connection
  fastify.post('/connect', {
    schema: {
      tags: ['Smithery'],
      summary: 'Connect MCP via Smithery',
      description: 'Creates or resumes an MCP connection. Returns auth_required + authorizationUrl when OAuth is needed, or connected when ready.',
      body: z.object({
        mcpUrl: z.string().url(),
        mcpName: z.string().optional(),
        agentId: z.string().optional(),
        connectionId: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      response: {
        200: z.object({
          status: z.enum(['connected', 'auth_required']),
          connectionId: z.string(),
          authorizationUrl: z.string().optional(),
        }),
        400: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
    preHandler: requirePermission('integrations.manage'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    const { mcpUrl, mcpName, agentId, connectionId: existingConnectionId, headers } = request.body as {
      mcpUrl: string;
      mcpName?: string;
      agentId?: string;
      connectionId?: string;
      headers?: Record<string, string>;
    };

    if (!config.smitheryApiKey) {
      return reply.code(500).send({ error: 'Smithery not configured (SMITHERY_API_KEY)' });
    }

    const namespace = organizationId ? `havoc-${organizationId}` : `havoc-user-${userId}`;
    const connectionId = existingConnectionId || `havoc-${crypto.randomBytes(8).toString('hex')}`;

    try {
      const Smithery = (await import('@smithery/api')).default;
      const smithery = new Smithery({ apiKey: config.smitheryApiKey });

      // Ensure namespace exists (idempotent)
      await smithery.namespaces.set(namespace).catch(() => {});

      const conn = await smithery.connections.set(connectionId, {
        namespace,
        mcpUrl,
        name: mcpName || new URL(mcpUrl).hostname,
        ...(headers && Object.keys(headers).length > 0 && { headers }),
        metadata: {
          organizationId: organizationId || undefined,
          userId,
          agentId: agentId || undefined,
        },
      });

      const status = conn.status?.state ?? 'connected';
      const authRequired = status === 'auth_required';
      const authorizationUrl = conn.status && 'authorizationUrl' in conn.status ? conn.status.authorizationUrl : undefined;

      await db.collection('smithery_connections').updateOne(
        { connectionId },
        {
          $set: {
            connectionId,
            namespace,
            mcpUrl,
            mcpName: mcpName || null,
            organizationId: organizationId || null,
            userId,
            agentId: agentId || null,
            status: authRequired ? 'auth_required' : 'connected',
            authorizationUrl: authorizationUrl || null,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      if (authRequired && authorizationUrl) {
        return {
          status: 'auth_required' as const,
          connectionId,
          authorizationUrl,
        };
      }

      return {
        status: 'connected' as const,
        connectionId,
      };
    } catch (err: any) {
      if (err?.name === 'SmitheryAuthorizationError' || err?.authorizationUrl) {
        await db.collection('smithery_connections').updateOne(
          { connectionId },
          {
            $set: {
              connectionId,
              namespace,
              mcpUrl,
              organizationId: organizationId || null,
              userId,
              agentId: agentId || null,
              status: 'auth_required',
              authorizationUrl: err.authorizationUrl,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
        return {
          status: 'auth_required' as const,
          connectionId,
          authorizationUrl: err.authorizationUrl,
        };
      }
      // 409: mcpUrl mismatch — cannot change URL on existing connection (Smithery API)
      const statusCode = err?.status ?? err?.statusCode ?? err?.response?.status;
      if (statusCode === 409) {
        return reply.code(409).send({
          error: 'Connection already exists with a different URL. Disconnect first, then connect again.',
        });
      }
      fastify.log.error({ err }, 'Smithery connect failed');
      return reply.code(500).send({ error: err?.message || 'Smithery connection failed' });
    }
  });

  // GET /api/smithery/servers - Search verified MCP servers (Smithery registry)
  fastify.get<{ Querystring: { q?: string; pageSize?: string } }>('/servers', {
    schema: {
      tags: ['Smithery'],
      summary: 'Search MCP servers',
      description: 'List verified+deployed MCP servers from Smithery plus curated additions. Cached for 5 min. Search is ranked locally: exact > starts-with > contains name > contains description.',
      querystring: z.object({
        q: z.string().optional(),
        pageSize: z.string().optional(),
      }),
      response: {
        200: z.object({
          servers: z.array(z.object({
            qualifiedName: z.string(),
            displayName: z.string(),
            description: z.string(),
            iconUrl: z.string().nullable(),
            mcpUrl: z.string(),
            homepage: z.string(),
          })),
          pagination: z.object({
            currentPage: z.number(),
            pageSize: z.number(),
            totalPages: z.number(),
            totalCount: z.number(),
          }),
        }),
        500: z.object({ error: z.string() }),
      },
    },
    preHandler: requirePermission('integrations.manage'),
  }, async (request, reply) => {
    if (!config.smitheryApiKey) {
      return reply.code(500).send({ error: 'Smithery not configured (SMITHERY_API_KEY)' });
    }

    const { q, pageSize = '48' } = request.query;
    const size = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 48));

    try {
      const mapServer = (s: any) => {
        const ns = s.namespace ?? '';
        const slug = s.slug || s.qualifiedName?.split('/').pop() || s.qualifiedName || '';
        // URL format: slug.run.tools for single-name, slug--namespace.run.tools for namespaced
        const mcpUrl = s.deploymentUrl ?? (slug && ns && ns !== slug
          ? `https://${slug}--${ns}.run.tools`
          : slug ? `https://${slug}.run.tools` : '');
        if (!mcpUrl) return null;
        const qn = s.qualifiedName ?? '';
        const rawIcon = s.iconUrl && typeof s.iconUrl === 'string' && s.iconUrl.startsWith('https://') ? s.iconUrl : null;
        return {
          qualifiedName: qn,
          displayName: s.displayName ?? s.qualifiedName ?? 'Unknown',
          description: s.description ?? '',
          iconUrl: rawIcon,
          mcpUrl,
          homepage: s.homepage ?? `https://smithery.ai/servers/${qn}`,
        };
      };

      // Fetch full catalog once, cache for 5 min
      const fetchAllServers = async (): Promise<any[]> => {
        const Smithery = (await import('@smithery/api')).default;
        const smithery = new Smithery({ apiKey: config.smitheryApiKey });
        const baseParams = { pageSize: 100, isDeployed: true, verified: true } as any;
        const first = await smithery.servers.list({ ...baseParams, page: 1 } as any) as unknown as { servers?: any[]; pagination?: any };
        const totalPages = Math.min(3, first?.pagination?.totalPages ?? 1);
        const all: any[] = (first?.servers ?? []).map(mapServer).filter(Boolean);
        if (totalPages > 1) {
          const rest = await Promise.all(
            Array.from({ length: totalPages - 1 }, (_, i) =>
              smithery.servers.list({ ...baseParams, page: i + 2 } as any)
            )
          );
          for (const p of rest) {
            for (const s of (p as any)?.servers ?? []) {
              const mapped = mapServer(s);
              if (mapped) all.push(mapped);
            }
          }
        }
        // Merge curated
        const existingUrls = new Set(all.map((s: any) => s.mcpUrl));
        for (const c of curatedRegistry.servers) {
          if (!existingUrls.has(c.mcpUrl)) all.push({ ...c, iconUrl: c.iconUrl || null });
        }
        return all;
      };

      // Use cache or fetch (coalesce concurrent requests)
      let allServers: any[];
      if (serverCache.data.length && Date.now() - serverCache.ts < CACHE_TTL) {
        allServers = serverCache.data;
      } else if (serverCache.loading) {
        allServers = await serverCache.loading;
      } else {
        serverCache.loading = fetchAllServers().then(data => {
          serverCache.data = data;
          serverCache.ts = Date.now();
          serverCache.loading = undefined;
          return data;
        }).catch(err => {
          serverCache.loading = undefined;
          throw err;
        });
        allServers = await serverCache.loading!;
      }

      // Filter + rank locally
      const query = q?.trim() || '';
      let results: any[];
      if (query.length >= 2) {
        results = allServers
          .map(s => ({ ...s, _score: searchRank(s, query) }))
          .filter(s => s._score > 0)
          .sort((a, b) => b._score - a._score)
          .map(({ _score, ...s }) => s);
      } else {
        results = allServers;
      }

      const page = results.slice(0, size);
      return {
        servers: page,
        pagination: {
          currentPage: 1,
          pageSize: page.length,
          totalPages: 1,
          totalCount: results.length,
        },
      };
    } catch (err: any) {
      fastify.log.error({ err }, 'Smithery servers list failed');
      return reply.code(500).send({ error: err?.message || 'Failed to list servers' });
    }
  });

  // GET /api/smithery/servers/:qualifiedName - Get server details including configSchema
  fastify.get<{ Params: { qualifiedName: string } }>('/servers/:qualifiedName', {
    schema: {
      tags: ['Smithery'],
      summary: 'Get MCP server details',
      description: 'Returns server metadata and configSchema for dynamic credential forms.',
      params: z.object({ qualifiedName: z.string().min(1) }),
      response: {
        200: z.object({
          qualifiedName: z.string(),
          displayName: z.string(),
          description: z.string(),
          iconUrl: z.string().nullable(),
          mcpUrl: z.string(),
          homepage: z.string(),
          configSchema: z.record(z.unknown()).nullable().optional(),
        }),
        404: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
    preHandler: requirePermission('integrations.manage'),
  }, async (request, reply) => {
    if (!config.smitheryApiKey) {
      return reply.code(500).send({ error: 'Smithery not configured (SMITHERY_API_KEY)' });
    }
    const { qualifiedName } = request.params;
    const encoded = encodeURIComponent(qualifiedName);
    try {
      const res = await fetch(`https://api.smithery.ai/servers/${encoded}`, {
        headers: { Authorization: `Bearer ${config.smitheryApiKey}` },
      });
      if (!res.ok) {
        if (res.status === 404) return reply.code(404).send({ error: 'Server not found' });
        const err = await res.text();
        fastify.log.warn({ qualifiedName, status: res.status }, 'Smithery server get failed');
        return reply.code(res.status >= 500 ? 500 : 400).send({ error: err || 'Failed to fetch server' });
      }
      const data = (await res.json()) as Record<string, unknown>;
      const connections = (data.connections as any[]) ?? [];
      // Prefer HTTP connection (deployed remote server) over stdio
      const httpConn = connections.find((c) => c.type === 'http') ?? null;
      const firstConn = connections[0] ?? null;
      const activeConn = httpConn ?? firstConn;
      // mcpUrl: HTTP connection's deploymentUrl → top-level deploymentUrl → slug fallback
      const slug = (data.slug as string) ?? qualifiedName.split('/').pop() ?? qualifiedName;
      const mcpUrl =
        (httpConn?.deploymentUrl as string | undefined) ??
        (data.deploymentUrl as string | undefined) ??
        (slug ? `https://${slug}.run.tools` : '');
      const rawIcon = typeof data.iconUrl === 'string' && data.iconUrl.startsWith('https://') ? data.iconUrl : null;
      const iconUrl = rawIcon || `/api/smithery/servers/icon?qualifiedName=${encoded}`;
      // configSchema: prefer HTTP connection (has x-from annotations), fallback to any connection or top-level
      const configSchema = (httpConn?.configSchema ?? activeConn?.configSchema ?? (data.configSchema as Record<string, unknown>)) || null;
      return {
        qualifiedName: (data.qualifiedName as string) ?? qualifiedName,
        displayName: (data.displayName as string) ?? qualifiedName,
        description: (data.description as string) ?? '',
        iconUrl,
        mcpUrl,
        homepage: (data.homepage as string) ?? `https://smithery.ai/servers/${qualifiedName}`,
        configSchema,
      };
    } catch (err: any) {
      fastify.log.error({ err, qualifiedName }, 'Smithery server get failed');
      return reply.code(500).send({ error: err?.message || 'Failed to fetch server' });
    }
  });

  // GET /api/smithery/connections - List connections from Smithery (fallback: our DB)
  fastify.get('/connections', {
    schema: {
      tags: ['Smithery'],
      summary: 'List MCP connections',
      response: {
        200: z.object({
          connections: z.array(z.object({
            connectionId: z.string(),
            mcpUrl: z.string(),
            mcpName: z.string().nullable(),
            status: z.enum(['connected', 'auth_required', 'error', 'unknown']),
            authorizationUrl: z.string().nullable().optional(),
            errorMessage: z.string().nullable().optional(),
          })),
        }),
      },
    },
    preHandler: requirePermission('integrations.manage'),
  }, async (request) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    const namespace = organizationId ? `havoc-${organizationId}` : `havoc-user-${userId}`;

    const VALID_STATUS = ['connected', 'auth_required', 'error', 'unknown'] as const;
    const mapConn = (c: any) => {
      const raw = c.status?.state ?? c.status ?? 'unknown';
      const status = VALID_STATUS.includes(raw as any) ? raw : 'unknown';
      const errorMessage = status === 'error' && c.status?.message ? String(c.status.message) : null;
      const authorizationUrl =
        status === 'auth_required'
          ? (c.status?.authorizationUrl ?? c.authorizationUrl ?? null)
          : null;
      return {
        connectionId: c.connectionId,
        mcpUrl: c.mcpUrl,
        mcpName: c.name ?? c.mcpName ?? null,
        status,
        ...(authorizationUrl && { authorizationUrl }),
        ...(errorMessage && { errorMessage }),
      };
    };

    if (config.smitheryApiKey) {
      try {
        const Smithery = (await import('@smithery/api')).default;
        const smithery = new Smithery({ apiKey: config.smitheryApiKey });
        const list = await smithery.connections.list(namespace, { limit: 50 });
        const connections = (list?.connections ?? []) as any[];

        // Sync to our DB so internal-mcp-proxy has them
        for (const c of connections) {
          const st = c.status?.state ?? c.status ?? 'unknown';
          await db.collection('smithery_connections').updateOne(
            { connectionId: c.connectionId },
            {
              $set: {
                connectionId: c.connectionId,
                namespace,
                mcpUrl: c.mcpUrl,
                mcpName: c.name ?? null,
                organizationId: organizationId ?? null,
                userId,
                status: st,
                authorizationUrl: st === 'auth_required' ? (c.status?.authorizationUrl ?? null) : null,
                errorMessage: st === 'error' && c.status?.message ? String(c.status.message) : null,
                updatedAt: new Date(),
              },
            },
            { upsert: true }
          );
        }

        return { connections: connections.map(mapConn) };
      } catch (err) {
        fastify.log.warn({ err, namespace }, 'Smithery list failed, falling back to DB');
      }
    }

    const filter: any = organizationId ? { organizationId } : { userId };
    const dbConns = await db.collection('smithery_connections')
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    return {
      connections: dbConns.map((c: any) => mapConn({
        connectionId: c.connectionId,
        mcpUrl: c.mcpUrl,
        name: c.mcpName,
        authorizationUrl: c.authorizationUrl ?? null,
        status: c.status === 'error' && c.errorMessage
          ? { state: 'error', message: c.errorMessage }
          : c.status,
      })),
    };
  });

  // DELETE /api/smithery/connections/:connectionId - Remove MCP connection
  fastify.delete<{ Params: { connectionId: string } }>('/connections/:connectionId', {
    schema: {
      tags: ['Smithery'],
      summary: 'Disconnect MCP',
      description: 'Removes the MCP connection from the organization. Agent loses access to this integration.',
    },
    preHandler: requirePermission('integrations.manage'),
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    const userId = request.userId;
    const { connectionId } = request.params;

    const filter: any = { connectionId };
    if (organizationId) filter.organizationId = organizationId;
    else filter.userId = userId;

    const conn = await db.collection('smithery_connections').findOne(filter);
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });

    const namespace = conn.namespace as string;
    if (config.smitheryApiKey && namespace) {
      try {
        const Smithery = (await import('@smithery/api')).default;
        const smithery = new Smithery({ apiKey: config.smitheryApiKey });
        await smithery.connections.delete(connectionId, { namespace });
      } catch (err) {
        fastify.log.warn({ err, connectionId, namespace }, 'Smithery delete failed (may already be gone)');
      }
    }

    await db.collection('smithery_connections').deleteOne(filter);
    return { ok: true };
  });

  // GET /api/smithery/skills - List verified skills (cached + ranked)
  fastify.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>('/skills', {
    schema: {
      tags: ['Smithery'],
      summary: 'List verified skills',
      querystring: z.object({
        q: z.string().optional(),
        page: z.string().optional(),
        pageSize: z.string().optional(),
      }),
      response: {
        200: z.object({
          skills: z.array(z.object({
            slug: z.string(),
            namespace: z.string(),
            displayName: z.string(),
            description: z.string(),
            categories: z.array(z.string()),
            qualityScore: z.number(),
            homepage: z.string(),
            gitUrl: z.string().optional(),
            iconUrl: z.string().nullable().optional(),
          })),
          pagination: z.object({
            currentPage: z.number(),
            pageSize: z.number(),
            totalPages: z.number(),
            totalCount: z.number(),
          }),
        }),
        500: z.object({ error: z.string() }),
      },
    },
    preHandler: requirePermission('integrations.manage'),
  }, async (request, reply) => {
    if (!config.smitheryApiKey) {
      return reply.code(500).send({ error: 'Smithery not configured (SMITHERY_API_KEY)' });
    }
    const { q, page = '1', pageSize = '100' } = request.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 100));

    try {
      const fetchAllSkills = async (): Promise<any[]> => {
        const Smithery = (await import('@smithery/api')).default;
        const smithery = new Smithery({ apiKey: config.smitheryApiKey });
        const result = await smithery.skills.list({ verified: true, pageSize: 100, page: 1 } as any) as unknown as { skills?: any[]; pagination?: any };
        const skills = (result?.skills ?? []).map((s: any) => {
          const gitOrg = s.gitUrl?.match(/github\.com\/([^/]+)/)?.[1];
          const iconUrl = gitOrg ? `https://github.com/${gitOrg}.png?size=64` : (s.namespace ? `https://github.com/${s.namespace}.png?size=64` : null);
          return {
            slug: s.slug ?? '',
            namespace: s.namespace ?? '',
            displayName: s.displayName ?? s.slug ?? '',
            description: s.description ?? '',
            categories: s.categories ?? [],
            qualityScore: s.qualityScore ?? 0,
            homepage: `https://smithery.ai/skills/${s.namespace}/${s.slug}`,
            gitUrl: s.gitUrl ?? undefined,
            iconUrl,
          };
        });
        // Merge curated
        const existingSlugs = new Set(skills.map((s: any) => `${s.namespace}/${s.slug}`));
        for (const c of curatedRegistry.skills) {
          if (!existingSlugs.has(`${c.namespace}/${c.slug}`)) {
            const gitOrg = c.gitUrl?.match(/github\.com\/([^/]+)/)?.[1];
            skills.push({ ...c, qualityScore: 0, gitUrl: c.gitUrl ?? undefined, iconUrl: gitOrg ? `https://github.com/${gitOrg}.png?size=64` : null });
          }
        }
        return skills;
      };

      let allSkills: any[];
      if (skillCache.data.length && Date.now() - skillCache.ts < CACHE_TTL) {
        allSkills = skillCache.data;
      } else if (skillCache.loading) {
        allSkills = await skillCache.loading;
      } else {
        skillCache.loading = fetchAllSkills().then(data => {
          skillCache.data = data;
          skillCache.ts = Date.now();
          skillCache.loading = undefined;
          return data;
        }).catch(err => {
          skillCache.loading = undefined;
          throw err;
        });
        allSkills = await skillCache.loading!;
      }

      const query = q?.trim() || '';
      let results: any[];
      if (query.length >= 2) {
        results = allSkills
          .map(s => ({ ...s, _score: searchRank({ displayName: s.displayName, description: s.description, qualifiedName: `${s.namespace}/${s.slug}` }, query) }))
          .filter(s => s._score > 0)
          .sort((a, b) => b._score - a._score)
          .map(({ _score, ...s }) => s);
      } else {
        results = allSkills;
      }

      const totalCount = results.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / size));
      const currentPage = Math.min(pageNum, totalPages);
      const start = (currentPage - 1) * size;
      const pageItems = results.slice(start, start + size);
      return {
        skills: pageItems,
        pagination: { currentPage, pageSize: pageItems.length, totalPages, totalCount },
      };
    } catch (err: any) {
      fastify.log.error({ err }, 'Smithery skills list failed');
      return reply.code(500).send({ error: err?.message || 'Failed to list skills' });
    }
  });
}
