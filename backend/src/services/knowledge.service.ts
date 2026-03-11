// Knowledge Service — orchestrates RAG pipeline: parse → chunk → embed → store → search

import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { parseDocument } from './document-parser.service.js';
import { chunkText } from './chunking.service.js';
import { embedTexts, embedText, EMBEDDING_DIMS } from './embedding.service.js';
import type { KnowledgeSource, KnowledgeChunk, KnowledgeSearchResult, KnowledgeSourceType } from '@openclaw-business/shared';
import { crawlWebsite } from './crawler.service.js';

// ── Ingest Pipeline ──────────────────────────────────────────────────────────

/**
 * Ingest a document: parse → chunk → embed → store in MongoDB.
 * Creates a KnowledgeSource record and all associated KnowledgeChunk documents.
 */
export async function ingestDocument(opts: {
  organizationId: string;
  agentId?: string | null;
  createdBy: string;
  type: KnowledgeSourceType;
  name: string;
  origin: string;
  content: Buffer | string;
  mimeType?: string;
}): Promise<KnowledgeSource> {
  const db = getDatabase();
  const sourcesCol = db.collection('knowledge_sources');
  const chunksCol = db.collection<KnowledgeChunk>('knowledge_chunks');

  // Deduplicate: if a source with the same origin already exists for this org, remove old data
  if (opts.origin) {
    const existing = await sourcesCol.findOne({ organizationId: opts.organizationId, origin: opts.origin });
    if (existing) {
      const oldId = existing._id!.toString();
      await chunksCol.deleteMany({ sourceId: oldId });
      await sourcesCol.deleteOne({ _id: existing._id });
    }
  }

  // Create source record in "processing" state
  const source: KnowledgeSource = {
    organizationId: opts.organizationId,
    agentId: opts.agentId ?? null,
    type: opts.type,
    name: opts.name,
    origin: opts.origin,
    status: 'processing',
    sizeBytes: typeof opts.content === 'string' ? Buffer.byteLength(opts.content) : opts.content.length,
    chunkCount: 0,
    mimeType: opts.mimeType,
    createdBy: opts.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const { insertedId } = await sourcesCol.insertOne(source);
  const sourceId = insertedId.toString();

  try {
    // Parse content to text
    await sourcesCol.updateOne({ _id: insertedId }, { $set: { processingStep: 'parsing', updatedAt: new Date() } });
    let text: string;
    if (typeof opts.content === 'string') {
      text = opts.content;
    } else {
      const parsed = await parseDocument(opts.content, opts.name, opts.mimeType);
      text = parsed.content;
    }

    if (!text.trim()) {
      await sourcesCol.updateOne({ _id: insertedId }, { $set: { status: 'ready', chunkCount: 0, processingStep: null, updatedAt: new Date() } });
      return { ...source, _id: insertedId, status: 'ready' };
    }

    // Chunk
    await sourcesCol.updateOne({ _id: insertedId }, { $set: { processingStep: 'chunking', updatedAt: new Date() } });
    const textChunks = chunkText(text, sourceId);

    if (textChunks.length === 0) {
      await sourcesCol.updateOne({ _id: insertedId }, { $set: { status: 'ready', chunkCount: 0, processingStep: null, updatedAt: new Date() } });
      return { ...source, _id: insertedId, status: 'ready' };
    }

    // Embed all chunks
    await sourcesCol.updateOne({ _id: insertedId }, { $set: { processingStep: 'embedding', chunkCount: textChunks.length, updatedAt: new Date() } });
    const vectors = await embedTexts(textChunks.map(c => c.text));

    // Store chunks with embeddings
    const docs: KnowledgeChunk[] = textChunks.map((chunk, i) => ({
      organizationId: opts.organizationId,
      sourceId,
      agentId: opts.agentId ?? null,
      chunkIndex: chunk.metadata.chunkIndex,
      text: chunk.text,
      embedding: vectors[i],
      metadata: {
        sourceName: opts.name,
        sourceType: opts.type,
        startChar: chunk.metadata.startChar,
        endChar: chunk.metadata.endChar,
      },
      createdAt: new Date(),
    }));

    await chunksCol.insertMany(docs);

    // Update source to ready
    await sourcesCol.updateOne({ _id: insertedId }, {
      $set: { status: 'ready', chunkCount: docs.length, processingStep: null, updatedAt: new Date() },
    });

    return { ...source, _id: insertedId, status: 'ready', chunkCount: docs.length };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await sourcesCol.updateOne({ _id: insertedId }, {
      $set: { status: 'error', error: errorMsg, updatedAt: new Date() },
    });
    throw err;
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Semantic search across knowledge chunks using MongoDB Atlas $vectorSearch.
 */
export async function searchKnowledge(opts: {
  organizationId: string;
  query: string;
  sourceIds?: string[];
  sourceTypes?: string[];
  limit?: number;
}): Promise<KnowledgeSearchResult[]> {
  const db = getDatabase();
  const limit = opts.limit ?? 5;

  const queryVector = await embedText(opts.query);

  // Build filter: org-scoped
  const filter: Record<string, unknown> = { organizationId: opts.organizationId };
  if (opts.sourceIds?.length) {
    filter.sourceId = { $in: opts.sourceIds };
  }
  if (opts.sourceTypes?.length) {
    filter['metadata.sourceType'] = { $in: opts.sourceTypes };
  }

  const pipeline = [
    {
      $vectorSearch: {
        index: 'knowledge_vector_index',
        path: 'embedding',
        queryVector,
        numCandidates: limit * 10,
        limit,
        filter,
      },
    },
    {
      $project: {
        text: 1,
        'metadata.sourceName': 1,
        'metadata.sourceType': 1,
        sourceId: 1,
        chunkIndex: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];

  const results = await db.collection('knowledge_chunks').aggregate(pipeline).toArray();

  // Track usage for analytics (fire-and-forget)
  const sourceIds = [...new Set(results.map(r => r.sourceId).filter(Boolean))];
  if (sourceIds.length > 0) {
    db.collection('knowledge_sources').updateMany(
      { organizationId: opts.organizationId, _id: { $in: sourceIds.map(id => new ObjectId(id)) } },
      { $inc: { hitCount: 1 }, $set: { lastUsedAt: new Date() } },
    ).catch(() => {});
  }

  return results.map(r => ({
    text: r.text,
    score: r.score,
    sourceName: r.metadata?.sourceName ?? '',
    sourceType: r.metadata?.sourceType ?? 'text',
    sourceId: r.sourceId,
    chunkIndex: r.chunkIndex ?? 0,
  }));
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listSources(organizationId: string) {
  const db = getDatabase();
  return db.collection('knowledge_sources').find({ organizationId }).sort({ createdAt: -1 }).toArray();
}

export async function getSource(organizationId: string, sourceId: string) {
  const db = getDatabase();
  return db.collection('knowledge_sources').findOne({
    _id: new ObjectId(sourceId),
    organizationId,
  });
}

export async function deleteSource(organizationId: string, sourceId: string) {
  const db = getDatabase();
  // Cascade: if this is a crawl parent, delete all children too
  const childIds = await db.collection('knowledge_sources')
    .find({ organizationId, crawlJobId: sourceId })
    .project({ _id: 1 })
    .toArray();
  if (childIds.length > 0) {
    const ids = childIds.map(c => c._id.toString());
    await db.collection('knowledge_chunks').deleteMany({ organizationId, sourceId: { $in: ids } });
    await db.collection('knowledge_sources').deleteMany({ organizationId, crawlJobId: sourceId });
  }
  // Delete own chunks + source
  await db.collection('knowledge_chunks').deleteMany({ organizationId, sourceId });
  await db.collection('knowledge_sources').deleteOne({ _id: new ObjectId(sourceId), organizationId });
  // Mark cancelled so running crawl stops
  await db.collection('knowledge_sources').updateOne(
    { _id: new ObjectId(sourceId), organizationId },
    { $set: { status: 'cancelled' } },
  );
}

export async function listChunks(organizationId: string, sourceId: string, limit = 50) {
  const db = getDatabase();
  return db.collection('knowledge_chunks')
    .find({ organizationId, sourceId })
    .project({ embedding: 0 })
    .sort({ chunkIndex: 1 })
    .limit(limit)
    .toArray();
}

export async function getKnowledgeStats(organizationId: string) {
  const db = getDatabase();
  const [sourceStats] = await db.collection('knowledge_sources').aggregate([
    { $match: { organizationId } },
    { $group: { _id: null, totalSources: { $sum: 1 }, totalBytes: { $sum: '$sizeBytes' }, totalChunks: { $sum: '$chunkCount' } } },
  ]).toArray();
  return {
    sources: sourceStats?.totalSources ?? 0,
    storageMb: Math.round((sourceStats?.totalBytes ?? 0) / (1024 * 1024) * 100) / 100,
    chunks: sourceStats?.totalChunks ?? 0,
  };
}

export async function getKnowledgeUsageStats(organizationId: string) {
  const db = getDatabase();
  const filter: Record<string, unknown> = { organizationId, type: { $ne: 'crawl' } };
  return db.collection('knowledge_sources')
    .find(filter)
    .project({ name: 1, type: 1, hitCount: 1, lastUsedAt: 1, chunkCount: 1, sizeBytes: 1 })
    .sort({ hitCount: -1, createdAt: -1 })
    .toArray();
}

// ── Crawl Job ────────────────────────────────────────────────────────────────

/**
 * Start an async website crawl job. Returns the parent source immediately.
 * Crawled pages are ingested as child sources in the background.
 */
export async function startCrawlJob(opts: {
  organizationId: string;
  agentId?: string | null;
  createdBy: string;
  url: string;
  maxPages?: number;
  maxDepth?: number;
  schedule?: 'daily' | 'weekly' | 'monthly' | null;
}): Promise<KnowledgeSource> {
  const db = getDatabase();
  const sourcesCol = db.collection('knowledge_sources');
  const maxPages = opts.maxPages ?? 50;
  const maxDepth = opts.maxDepth ?? 3;

  let domain: string;
  try { domain = new URL(opts.url).hostname; } catch { throw new Error('Invalid URL'); }

  const parent: KnowledgeSource = {
    organizationId: opts.organizationId,
    agentId: opts.agentId ?? null,
    type: 'crawl',
    name: domain,
    origin: opts.url,
    status: 'processing',
    sizeBytes: 0,
    chunkCount: 0,
    crawlProgress: { discovered: 0, completed: 0, failed: 0 },
    crawlConfig: { maxPages, maxDepth },
    crawlSchedule: opts.schedule ?? null,
    nextCrawlAt: opts.schedule ? getNextCrawlDate(opts.schedule) : null,
    createdBy: opts.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const { insertedId } = await sourcesCol.insertOne(parent);
  const parentId = insertedId.toString();

  // Fire-and-forget async crawl
  (async () => {
    try {
      const results = await crawlWebsite({
        url: opts.url,
        maxPages,
        maxDepth,
        onProgress: async (progress) => {
          await sourcesCol.updateOne({ _id: insertedId }, {
            $set: { crawlProgress: progress, updatedAt: new Date() },
          }).catch(() => {});
        },
        shouldCancel: () => {
          // Check synchronously — we'll do a DB check periodically in the crawl loop
          return false;
        },
      });

      // Check if cancelled
      const current = await sourcesCol.findOne({ _id: insertedId });
      if (!current || current.status === 'cancelled') return;

      // Ingest each crawled page
      let completed = 0;
      let failed = 0;
      let totalBytes = 0;
      let totalChunks = 0;

      for (const page of results) {
        try {
          const child = await ingestDocument({
            organizationId: opts.organizationId,
            agentId: opts.agentId,
            createdBy: opts.createdBy,
            type: 'url',
            name: new URL(page.url).pathname || '/',
            origin: page.url,
            content: page.content,
          });
          // Tag as child of this crawl
          await sourcesCol.updateOne(
            { _id: child._id },
            { $set: { crawlJobId: parentId } },
          );
          totalBytes += child.sizeBytes;
          totalChunks += child.chunkCount;
          completed++;
        } catch {
          failed++;
        }

        await sourcesCol.updateOne({ _id: insertedId }, {
          $set: {
            crawlProgress: { discovered: results.length, completed, failed },
            sizeBytes: totalBytes,
            chunkCount: totalChunks,
            updatedAt: new Date(),
          },
        }).catch(() => {});
      }

      await sourcesCol.updateOne({ _id: insertedId }, {
        $set: {
          status: results.length === 0 ? 'error' : 'ready',
          error: results.length === 0 ? 'No pages found to crawl' : undefined,
          crawlProgress: { discovered: results.length, completed, failed },
          sizeBytes: totalBytes,
          chunkCount: totalChunks,
          lastCrawledAt: results.length > 0 ? new Date() : undefined,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sourcesCol.updateOne({ _id: insertedId }, {
        $set: { status: 'error', error: msg, updatedAt: new Date() },
      }).catch(() => {});
    }
  })();

  return { ...parent, _id: insertedId };
}

// ── Schedule Helpers ─────────────────────────────────────────────────────────

export function getNextCrawlDate(schedule: 'daily' | 'weekly' | 'monthly'): Date {
  const now = new Date();
  switch (schedule) {
    case 'daily': return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case 'weekly': return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'monthly': return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }
}

export async function updateCrawlSchedule(organizationId: string, sourceId: string, schedule: 'daily' | 'weekly' | 'monthly' | null) {
  const db = getDatabase();
  await db.collection('knowledge_sources').updateOne(
    { _id: new ObjectId(sourceId), organizationId, type: 'crawl' },
    { $set: {
      crawlSchedule: schedule,
      nextCrawlAt: schedule ? getNextCrawlDate(schedule) : null,
      updatedAt: new Date(),
    }},
  );
}
