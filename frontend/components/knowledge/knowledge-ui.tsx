"use client";

import { Globe, Link2, FileText, File, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeSource {
  _id: string;
  name: string;
  type: 'file' | 'url' | 'text' | 'crawl';
  status: 'processing' | 'ready' | 'error' | 'cancelled';
  error?: string;
  sizeBytes: number;
  chunkCount: number;
  createdAt: string;
  crawlJobId?: string | null;
  crawlProgress?: { discovered: number; completed: number; failed: number };
  crawlConfig?: { maxPages: number; maxDepth: number };
  origin?: string;
  processingStep?: 'parsing' | 'chunking' | 'embedding' | null;
  crawlSchedule?: 'daily' | 'weekly' | 'monthly' | null;
  nextCrawlAt?: string | null;
  lastCrawledAt?: string | null;
  hitCount?: number;
  lastUsedAt?: string | null;
}

export interface SearchResult {
  text: string;
  score: number;
  sourceName: string;
  sourceType: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Badges & Icons ───────────────────────────────────────────────────────────

export function StatusBadge({ status, step }: { status: string; step?: string | null }) {
  const configs: Record<string, { bg: string; dot: string; label: string; pulse?: boolean }> = {
    ready: { bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-800/40', dot: 'bg-emerald-500', label: 'Ready' },
    processing: { bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/40', dot: 'bg-amber-500', label: step === 'parsing' ? 'Parsing…' : step === 'chunking' ? 'Chunking…' : step === 'embedding' ? 'Embedding…' : 'Processing…', pulse: true },
    error: { bg: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200/60 dark:border-red-800/40', dot: 'bg-red-500', label: 'Error' },
  };
  const c = configs[status] ?? configs.error;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium border ${c.bg}`}>
      <span className={`w-1 h-1 rounded-full ${c.dot} ${c.pulse ? 'animate-pulse' : ''}`} />{c.label}
    </span>
  );
}

const iconClass = "w-3.5 h-3.5";
const iconWrap = (color: string) => `w-10 h-10 rounded-xl ${color} flex items-center justify-center shrink-0`;

export function TypeIcon({ type }: { type: string }) {
  if (type === 'crawl') return (
    <div className={iconWrap('bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200/60 dark:border-cyan-800/40')}>
      <Globe className={`${iconClass} text-cyan-600 dark:text-cyan-400`} strokeWidth={2} />
    </div>
  );
  if (type === 'url') return (
    <div className={iconWrap('bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40')}>
      <Link2 className={`${iconClass} text-blue-600 dark:text-blue-400`} strokeWidth={2} />
    </div>
  );
  if (type === 'text') return (
    <div className={iconWrap('bg-purple-50 dark:bg-purple-950/40 border border-purple-200/60 dark:border-purple-800/40')}>
      <FileText className={`${iconClass} text-purple-600 dark:text-purple-400`} strokeWidth={2} />
    </div>
  );
  return (
    <div className={iconWrap('bg-gray-50/50 dark:bg-card/30 border border-gray-200/80 dark:border-border/60')}>
      <File className={`${iconClass} text-gray-500 dark:text-gray-400`} strokeWidth={2} />
    </div>
  );
}

// ── Crawl Progress ───────────────────────────────────────────────────────────

export function CrawlProgress({ progress, status }: { progress?: KnowledgeSource['crawlProgress']; status: string }) {
  if (!progress || status !== 'processing') return null;
  const total = Math.max(progress.discovered, 1);
  const done = progress.completed + progress.failed;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="mt-3 space-y-1">
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <motion.div className="h-full rounded-full bg-cyan-500" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 50, damping: 15 }} />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{done} / {progress.discovered} pages</span>
        {progress.failed > 0 && <span className="text-red-500">{progress.failed} failed</span>}
      </div>
    </div>
  );
}

// ── Delete Button ────────────────────────────────────────────────────────────

export function DeleteBtn({ onClick, title = 'Delete' }: { onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-all" title={title}>
      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
    </button>
  );
}

// ── Section Divider ──────────────────────────────────────────────────────────

export function SectionLabel({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h4>
      <div className="flex-1 h-px bg-border/40" />
      {children}
    </div>
  );
}

// ── Chunk Preview ────────────────────────────────────────────────────────────

export function ChunkPreview({ chunks }: { chunks: any[] }) {
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
      <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{chunks.length} Chunks</div>
        {chunks.map((chunk: any, i: number) => (
          <div key={chunk._id || i} className="px-3 py-2 rounded-xl bg-muted/30 border border-border/30">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-muted-foreground">#{chunk.chunkIndex}</span>
              <span className="text-xs text-muted-foreground">{chunk.text?.length || 0} chars</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{chunk.text}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
