import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ingestDocument, searchKnowledge, listSources, deleteSource, listChunks, getKnowledgeStats, startCrawlJob, getKnowledgeUsageStats, updateCrawlSchedule } from '../../services/knowledge.service.js';
import { parseDocument, isSupportedFormat } from '../../services/document-parser.service.js';
import { serializeDoc } from '../../utils/sanitize.js';

export async function knowledgeRoutes(fastify: FastifyInstance) {

  // POST /api/knowledge/sources — upload file, crawl URL, or add text
  fastify.post<{ Body: { type: 'text' | 'url'; name?: string; content?: string; url?: string; agentId?: string } }>('/sources', async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const contentType = request.headers['content-type'] || '';

    // Multipart file upload
    if (contentType.includes('multipart')) {
      const data = await request.file();
      if (!data) return reply.badRequest('No file uploaded');

      if (!isSupportedFormat(data.filename)) {
        return reply.badRequest('Unsupported file format');
      }

      const buffer = await data.toBuffer();
      const agentId = (data.fields as any)?.agentId?.value || null;

      const source = await ingestDocument({
        organizationId,
        agentId,
        createdBy: userId,
        type: 'file',
        name: data.filename,
        origin: data.filename,
        content: buffer,
        mimeType: data.mimetype,
      });

      return reply.status(201).send({ source: serializeDoc(source) });
    }

    // JSON body: text or URL
    const body = request.body;
    if (!body?.type) return reply.badRequest('type is required (text, url)');

    if (body.type === 'url') {
      if (!body.url) return reply.badRequest('url is required');

      // Fetch URL content
      let content: string;
      try {
        const res = await fetch(body.url, {
          headers: { 'User-Agent': 'Havoc Knowledge Bot/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        content = await res.text();
        content = content
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      } catch (err) {
        return reply.badRequest(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
      }

      const source = await ingestDocument({
        organizationId,
        agentId: body.agentId ?? null,
        createdBy: userId,
        type: 'url',
        name: body.name || new URL(body.url).hostname,
        origin: body.url,
        content,
      });

      return reply.status(201).send({ source: serializeDoc(source) });
    }

    if (body.type === 'text') {
      if (!body.content) return reply.badRequest('content is required');

      const source = await ingestDocument({
        organizationId,
        agentId: body.agentId ?? null,
        createdBy: userId,
        type: 'text',
        name: body.name || 'Manual text',
        origin: 'manual',
        content: body.content,
      });

      return reply.status(201).send({ source: serializeDoc(source) });
    }

    return reply.badRequest('Invalid type');
  });

  // GET /api/knowledge/sources
  fastify.get('/sources', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const sources = await listSources(organizationId);
    return { sources: sources.map(serializeDoc) };
  });

  // DELETE /api/knowledge/sources/:id
  fastify.delete<{ Params: { id: string } }>('/sources/:id', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    await deleteSource(organizationId, request.params.id);
    return { ok: true };
  });

  // POST /api/knowledge/search
  fastify.post<{ Body: { query: string; sourceTypes?: string[]; sourceIds?: string[]; limit?: number } }>('/search', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const { query, sourceTypes, sourceIds, limit } = request.body;
    if (!query) return reply.badRequest('query is required');

    const results = await searchKnowledge({ organizationId, query, sourceTypes, sourceIds, limit });
    return { results };
  });

  // GET /api/knowledge/sources/:id/chunks
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/sources/:id/chunks', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const chunks = await listChunks(organizationId, request.params.id, parseInt(request.query.limit || '50'));
    return { chunks: chunks.map(serializeDoc) };
  });

  // GET /api/knowledge/stats
  fastify.get('/stats', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    return await getKnowledgeStats(organizationId);
  });

  // POST /api/knowledge/crawl — start a multi-page website crawl
  fastify.post<{ Body: { url: string; agentId?: string; maxPages?: number; maxDepth?: number; schedule?: 'daily' | 'weekly' | 'monthly' } }>('/crawl', async (request, reply) => {
    const organizationId = request.organizationId;
    const userId = request.userId;
    if (!organizationId) return reply.badRequest('Organization required');

    const { url, agentId, maxPages, maxDepth, schedule } = request.body;
    if (!url) return reply.badRequest('url is required');

    try { new URL(url); } catch { return reply.badRequest('Invalid URL format'); }

    const source = await startCrawlJob({
      organizationId,
      agentId: agentId ?? null,
      createdBy: userId,
      url,
      maxPages: Math.min(maxPages ?? 50, 50),
      maxDepth: Math.min(maxDepth ?? 3, 5),
      schedule: schedule ?? null,
    });

    return reply.status(201).send({ source: serializeDoc(source) });
  });

  // PATCH /api/knowledge/sources/:id/schedule — update crawl schedule
  fastify.patch<{ Params: { id: string }; Body: { schedule: 'daily' | 'weekly' | 'monthly' | null } }>('/sources/:id/schedule', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    await updateCrawlSchedule(organizationId, request.params.id, request.body.schedule);
    return { ok: true };
  });

  // GET /api/knowledge/analytics — usage stats
  fastify.get('/analytics', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const stats = await getKnowledgeUsageStats(organizationId);
    return { stats: stats.map(serializeDoc) };
  });
}
