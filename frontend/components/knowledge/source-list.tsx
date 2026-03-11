"use client";

import { useState } from "react";
import { Loader2, LayoutGrid, Database, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { KnowledgeSource } from "./knowledge-ui";
import { StatusBadge, TypeIcon, CrawlProgress, DeleteBtn, ChunkPreview, formatBytes } from "./knowledge-ui";

// ── Source Row ────────────────────────────────────────────────────────────────

interface SourceRowProps {
  source: KnowledgeSource;
  onDelete: (id: string) => void;
  onLoadChunks: (id: string) => Promise<any[]>;
}

function SourceRow({ source, onDelete, onLoadChunks }: SourceRowProps) {
  const [showChunks, setShowChunks] = useState(false);
  const [chunks, setChunks] = useState<any[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const toggleChunks = async () => {
    if (showChunks) { setShowChunks(false); return; }
    if (chunks.length === 0) {
      setLoadingChunks(true);
      const c = await onLoadChunks(source._id);
      setChunks(c);
      setLoadingChunks(false);
    }
    setShowChunks(true);
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
      className="group rounded-2xl border border-gray-200/80 dark:border-border/60 p-4 hover:border-border hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)] transition-all">
      <div className="flex items-center gap-3">
        <TypeIcon type={source.type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{source.name}</span>
            <StatusBadge status={source.status} step={source.processingStep} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            {source.sizeBytes > 0 && <span>{formatBytes(source.sizeBytes)}</span>}
            {source.chunkCount > 0 && <span>{source.chunkCount} chunks</span>}
            {source.crawlSchedule && <span className="text-cyan-600 dark:text-cyan-400">↻ {source.crawlSchedule}</span>}
            {source.hitCount != null && source.hitCount > 0 && <span className="text-emerald-600 dark:text-emerald-400">{source.hitCount} hits</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {source.status === 'ready' && source.chunkCount > 0 && (
            <button onClick={toggleChunks} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all" title="View chunks">
              {loadingChunks ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
              ) : (
                <LayoutGrid className="w-4 h-4" strokeWidth={1.5} />
              )}
            </button>
          )}
          <DeleteBtn onClick={() => onDelete(source._id)} />
        </div>
      </div>
      {source.type === 'crawl' && <CrawlProgress progress={source.crawlProgress} status={source.status} />}
      <AnimatePresence>{showChunks && <ChunkPreview chunks={chunks} />}</AnimatePresence>
    </motion.div>
  );
}

// ── Source List ───────────────────────────────────────────────────────────────

interface SourceListProps {
  sources: KnowledgeSource[];
  onDelete: (id: string) => void;
  onLoadChunks: (id: string) => Promise<any[]>;
}

export function SourceList({ sources, onDelete, onLoadChunks }: SourceListProps) {
  if (sources.length === 0) {
    return (
      <div className="py-16 text-center rounded-2xl border border-dashed border-border">
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-muted/40 flex items-center justify-center">
          <Database className="w-6 h-6 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-muted-foreground">No knowledge sources yet</p>
        <p className="text-xs text-muted-foreground mt-1">Upload files, add text, or crawl a website to get started</p>
      </div>
    );
  }

  const crawlParents = sources.filter(s => s.type === 'crawl' && !s.crawlJobId);
  const crawlChildren = sources.filter(s => s.crawlJobId);
  const standalone = sources.filter(s => s.type !== 'crawl' && !s.crawlJobId);

  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout">
        {crawlParents.map(parent => {
          const children = crawlChildren.filter(c => c.crawlJobId === parent._id);
          return <CrawlGroup key={parent._id} parent={parent} crawlChildren={children} onDelete={onDelete} onLoadChunks={onLoadChunks} />;
        })}
        {standalone.map(s => <SourceRow key={s._id} source={s} onDelete={onDelete} onLoadChunks={onLoadChunks} />)}
      </AnimatePresence>
    </div>
  );
}

// ── Crawl Group ──────────────────────────────────────────────────────────────

function CrawlGroup({ parent, crawlChildren, onDelete, onLoadChunks }: { parent: KnowledgeSource; crawlChildren: KnowledgeSource[]; onDelete: (id: string) => void; onLoadChunks: (id: string) => Promise<any[]> }) {
  const [expanded, setExpanded] = useState(false);
  const readyCount = crawlChildren.filter(c => c.status === 'ready').length;

  return (
    <motion.div layout className="rounded-2xl border border-gray-200/80 dark:border-border/60 overflow-hidden">
      <div className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <TypeIcon type="crawl" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{parent.name}</span>
            <StatusBadge status={parent.status} step={parent.processingStep} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            <span>{readyCount} / {crawlChildren.length} pages</span>
            {parent.crawlSchedule && <span className="text-cyan-600 dark:text-cyan-400">↻ {parent.crawlSchedule}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <DeleteBtn onClick={() => onDelete(parent._id)} />
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={2} />
        </div>
      </div>
      {parent.status === 'processing' && <div className="px-4 pb-3"><CrawlProgress progress={parent.crawlProgress} status={parent.status} /></div>}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-3 pb-3 space-y-2">
              {crawlChildren.map(c => <SourceRow key={c._id} source={c} onDelete={onDelete} onLoadChunks={onLoadChunks} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
