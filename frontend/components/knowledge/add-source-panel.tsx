"use client";

import { useState, useRef } from "react";
import { Upload, FileText, Globe } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface AddSourcePanelProps {
  onUploadFiles: (files: FileList) => void;
  onAddText: (name: string, content: string) => void;
  onCrawl: (url: string, maxPages: number, maxDepth: number, schedule: string) => void;
  uploading: boolean;
}

export function AddSourcePanel({ onUploadFiles, onAddText, onCrawl, uploading }: AddSourcePanelProps) {
  const [mode, setMode] = useState<'file' | 'text' | 'crawl' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [textName, setTextName] = useState('');
  const [textContent, setTextContent] = useState('');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [maxPages, setMaxPages] = useState(50);
  const [maxDepth, setMaxDepth] = useState(3);
  const [schedule, setSchedule] = useState('none');

  const reset = () => { setMode(null); setTextName(''); setTextContent(''); setCrawlUrl(''); };

  const buttons = [
    { key: 'file' as const, label: 'Upload File', icon: (
      <Upload className="w-4 h-4" strokeWidth={1.5} />
    )},
    { key: 'text' as const, label: 'Add Text', icon: (
      <FileText className="w-4 h-4" strokeWidth={1.5} />
    )},
    { key: 'crawl' as const, label: 'Crawl Website', icon: (
      <Globe className="w-4 h-4" strokeWidth={1.5} />
    )},
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {buttons.map(b => (
          <button key={b.key} onClick={() => { if (b.key === 'file') { fileRef.current?.click(); } else { setMode(mode === b.key ? null : b.key); } }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${mode === b.key ? 'bg-foreground text-primary-foreground border-foreground' : 'border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground'}`}>
            {b.icon}{b.label}
          </button>
        ))}
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.tsv" className="hidden" onChange={e => { if (e.target.files?.length) { onUploadFiles(e.target.files); e.target.value = ''; } }} />
        {uploading && <span className="text-xs text-muted-foreground animate-pulse">Uploading…</span>}
      </div>

      <AnimatePresence mode="wait">
        {mode === 'text' && (
          <motion.div key="text" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="box p-4 space-y-3">
              <input value={textName} onChange={e => setTextName(e.target.value)} placeholder="Name (e.g. FAQ, Company Info)" className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600" />
              <textarea value={textContent} onChange={e => setTextContent(e.target.value)} placeholder="Paste your text content here…" rows={5} className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm resize-none outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600" />
              <div className="flex items-center gap-2 justify-end">
                <button onClick={reset} className="btn-ghost-sm">Cancel</button>
                <button onClick={() => { if (textName && textContent) { onAddText(textName, textContent); reset(); } }} disabled={!textName || !textContent}
                  className="btn-primary-sm disabled:opacity-40">Add</button>
              </div>
            </div>
          </motion.div>
        )}

        {mode === 'crawl' && (
          <motion.div key="crawl" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="box p-4 space-y-3">
              <input value={crawlUrl} onChange={e => setCrawlUrl(e.target.value)} placeholder="https://example.com" className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600" />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Max Pages</label>
                  <input type="number" value={maxPages} onChange={e => setMaxPages(+e.target.value)} min={1} max={200} className="w-full mt-1 px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Max Depth</label>
                  <input type="number" value={maxDepth} onChange={e => setMaxDepth(+e.target.value)} min={1} max={10} className="w-full mt-1 px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Re-Sync</label>
                  <select value={schedule} onChange={e => setSchedule(e.target.value)} className="w-full mt-1 px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600">
                    <option value="none">None</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={reset} className="btn-ghost-sm">Cancel</button>
                <button onClick={() => { if (crawlUrl) { onCrawl(crawlUrl, maxPages, maxDepth, schedule); reset(); } }} disabled={!crawlUrl}
                  className="btn-primary-sm disabled:opacity-40">Start Crawl</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
