"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { SearchResult } from "./knowledge-ui";

// ── Search Panel ─────────────────────────────────────────────────────────────

interface SearchPanelProps {
  onSearch: (query: string) => Promise<SearchResult[]>;
}

export function SearchPanel({ onSearch }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    const r = await onSearch(query);
    setResults(r);
    setSearching(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={2} />
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="Search knowledge base…"
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 placeholder:text-muted-foreground" />
        </div>
        <button onClick={handleSearch} disabled={!query.trim() || searching}
          className="px-5 py-3 rounded-xl text-xs font-medium bg-foreground text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {searched && !searching && results.length === 0 && (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="box-empty py-16 text-center">
            <p className="text-sm text-muted-foreground">No results found</p>
          </motion.div>
        )}
        {results.length > 0 && (
          <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {results.map((r, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="box p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium">{r.sourceName}</span>
                  <span className="text-xs text-muted-foreground font-mono">{(r.score * 100).toFixed(0)}% match</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{r.text}</p>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Analytics Panel ──────────────────────────────────────────────────────────

interface AnalyticsPanelProps {
  stats: { totalSources: number; totalChunks: number; totalHits: number; topSources: { name: string; hitCount: number; type: string }[] } | null;
  loading: boolean;
}

export function AnalyticsPanel({ stats, loading }: AnalyticsPanelProps) {
  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">Loading analytics…</div>;
  if (!stats) return (
    <div className="box-empty py-16 text-center">
      <p className="text-sm text-muted-foreground">No analytics data</p>
    </div>
  );

  const maxHits = Math.max(...(stats.topSources.map(s => s.hitCount) || [1]), 1);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Sources', value: stats.totalSources },
          { label: 'Chunks', value: stats.totalChunks },
          { label: 'Total Hits', value: stats.totalHits },
        ].map(c => (
          <div key={c.label} className="p-4 rounded-2xl border border-gray-200/80 dark:border-border/60 text-center">
            <div className="text-lg font-semibold">{c.value.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Top sources bar chart */}
      {stats.topSources.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Most Used Sources</h4>
          <div className="space-y-2">
            {stats.topSources.map((s, i) => (
              <motion.div key={s.name} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center gap-3">
                <span className="text-xs truncate w-32 shrink-0 text-right">{s.name}</span>
                <div className="flex-1 h-5 rounded-lg bg-muted/40 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${(s.hitCount / maxHits) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.08 }}
                    className="h-full rounded-lg bg-emerald-500/70" />
                </div>
                <span className="text-xs text-muted-foreground font-mono w-8 text-right">{s.hitCount}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {stats.topSources.length === 0 && (
        <div className="box-empty py-8 text-center">
          <p className="text-sm text-muted-foreground">No usage data yet — search results will track hits automatically</p>
        </div>
      )}
    </div>
  );
}
