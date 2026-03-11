// ── Knowledge System Types (RAG Engine) ──────────────────────────────────────

export type KnowledgeSourceType = 'file' | 'url' | 'text' | 'crawl';
export type KnowledgeSourceStatus = 'processing' | 'ready' | 'error' | 'cancelled';

export interface KnowledgeSource {
  _id?: import('mongodb').ObjectId;
  organizationId: string;
  /** Null = org-wide, set = agent-specific */
  agentId?: string | null;
  type: KnowledgeSourceType;
  name: string;
  /** Original filename, URL, or title */
  origin: string;
  status: KnowledgeSourceStatus;
  error?: string;
  /** Raw content size in bytes */
  sizeBytes: number;
  /** Number of chunks generated */
  chunkCount: number;
  /** MIME type for file uploads */
  mimeType?: string;
  /** For crawl children: links back to parent crawl source */
  crawlJobId?: string | null;
  /** For crawl parents: live progress */
  crawlProgress?: { discovered: number; completed: number; failed: number };
  /** For crawl parents: config used */
  crawlConfig?: { maxPages: number; maxDepth: number };
  /** Current processing step for status feedback */
  processingStep?: 'parsing' | 'chunking' | 'embedding' | null;
  /** Cron schedule for re-crawl */
  crawlSchedule?: 'daily' | 'weekly' | 'monthly' | null;
  /** Next scheduled crawl time */
  nextCrawlAt?: Date | null;
  /** Last successful crawl time */
  lastCrawledAt?: Date | null;
  /** Number of times this source was used in RAG search */
  hitCount?: number;
  /** Last time this source was used in RAG search */
  lastUsedAt?: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeChunk {
  _id?: import('mongodb').ObjectId;
  organizationId: string;
  sourceId: string;
  agentId?: string | null;
  chunkIndex: number;
  text: string;
  /** Gemini text-embedding-004 vector (768 dims) */
  embedding: number[];
  metadata: {
    sourceName: string;
    sourceType: KnowledgeSourceType;
    startChar: number;
    endChar: number;
  };
  createdAt: Date;
}

export interface KnowledgeSearchResult {
  text: string;
  score: number;
  sourceName: string;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  chunkIndex: number;
}

// ── Knowledge Integrations ───────────────────────────────────────────────────

export type KnowledgeIntegrationType = 'google_drive' | 'notion';

export interface KnowledgeIntegration {
  _id?: import('mongodb').ObjectId;
  organizationId: string;
  agentId?: string | null;
  type: KnowledgeIntegrationType;
  /** Display name (e.g. workspace name, account email) */
  label: string;
  /** Encrypted access token */
  accessToken: string;
  /** Encrypted refresh token (Google only) */
  refreshToken?: string;
  /** Auto-sync schedule */
  syncSchedule?: 'daily' | 'weekly' | 'monthly' | null;
  lastSyncAt?: Date | null;
  nextSyncAt?: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
