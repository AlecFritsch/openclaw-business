"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { FileText, Calendar, Search, ArrowLeft, X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { useTranslations } from "next-intl";

interface MemoryFile {
  filename: string;
  content: string;
  size: number;
}

interface SearchResult {
  text?: string;
  snippet?: string;
  file?: string;
  path?: string;
  score?: number;
}

interface MemoryTabProps {
  agentId: string;
  memoryFiles: string[];
  onFilesChange: (files: string[]) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Icons ──────────────────────────────────────────────────────────

function DocIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return <FileText className={className} strokeWidth={1.5} />;
}

function CalendarIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return <Calendar className={className} strokeWidth={1.5} />;
}

function SearchIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return <Search className={className} strokeWidth={1.5} />;
}

export function MemoryTab({ agentId, memoryFiles, onFilesChange }: MemoryTabProps) {
  const t = useTranslations("workspace.memoryTab");
  const toast = useTranslations("toasts");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<MemoryFile | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [view, setView] = useState<"files" | "search">("files");
  const { getToken } = useAuth();
  const confirm = useConfirm();

  const stableFiles = memoryFiles.filter((f) => !f.match(/\d{4}-\d{2}-\d{2}/));
  const dateFiles = memoryFiles
    .map((f) => {
      const match = f.match(/(\d{4}-\d{2}-\d{2})/);
      return match ? { date: match[1], path: f } : null;
    })
    .filter(Boolean) as { date: string; path: string }[];
  const sortedDateFiles = dateFiles.sort((a, b) => b.date.localeCompare(a.date));

  const loadFileContent = async (path: string) => {
    setIsLoadingFile(true);
    setSelectedFile(path);
    setEditMode(false);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.readMemoryFile(token, agentId, path);
      setFileContent(data.file);
      setEditedContent(data.file.content);
    } catch {
      showToast(toast("memoryFileLoadFailed"), "error");
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.writeMemoryFile(token, agentId, selectedFile, editedContent);
      showToast(toast("memoryFileSaved"), "success");
      setFileContent((prev) =>
        prev ? { ...prev, content: editedContent, size: editedContent.length } : null
      );
      setEditMode(false);
    } catch {
      showToast(toast("memoryFileSaveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (path: string) => {
    if (!await confirm({ description: `Delete ${path}?`, confirmLabel: 'Delete', variant: 'destructive' })) return;
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.deleteMemoryFile(token, agentId, path);
      showToast(toast("memoryFileDeleted"), "success");
      onFilesChange(memoryFiles.filter((f) => f !== path));
      if (selectedFile === path) {
        setSelectedFile(null);
        setFileContent(null);
      }
    } catch {
      showToast(toast("memoryFileDeleteFailed"), "error");
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setView("search");
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.searchMemory(token, agentId, searchQuery);
      setSearchResults(data.results || []);
    } catch {
      showToast(toast("searchFailed"), "error");
    } finally {
      setIsSearching(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // FILE VIEWER / EDITOR
  // ═══════════════════════════════════════════════════════════════

  if (selectedFile) {
    const isDateFile = !!selectedFile.match(/\d{4}-\d{2}-\d{2}/);

    return (
      <div className="flex flex-col h-full">
        {/* File header */}
        <div className="px-3 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => { setSelectedFile(null); setFileContent(null); setEditMode(false); }}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={2} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {isDateFile
                    ? <CalendarIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                    : <DocIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                  }
                  <span className="text-xs font-mono font-medium truncate">{selectedFile}</span>
                </div>
                {fileContent && !editMode && (
                  <span className="text-xs text-muted-foreground ml-4.5">
                    {formatBytes(fileContent.size)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 mt-2 ml-6">
            {editMode ? (
              <>
                <button
                  onClick={() => { setEditMode(false); setEditedContent(fileContent?.content || ""); }}
                  className="text-xs text-gray-500 hover:text-foreground px-2.5 py-1 border border-border hover:border-foreground/30 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs px-2.5 py-1 bg-foreground text-primary-foreground disabled:opacity-50 rounded-lg transition-opacity"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditMode(true)}
                  className="text-xs px-2.5 py-1 border border-border hover:border-foreground rounded-lg transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(selectedFile)}
                  className="text-xs text-red-500 px-2.5 py-1 border border-red-200 dark:border-red-900 hover:border-red-500 rounded-lg transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoadingFile ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-xs text-muted-foreground">{t("loading")}</div>
          </div>
        ) : editMode ? (
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="flex-1 w-full p-3 bg-card text-xs font-mono leading-relaxed resize-none focus:outline-none border-none"
            spellCheck={false}
            autoFocus
          />
        ) : (
          <div className="flex-1 overflow-auto p-3">
            <pre className="whitespace-pre-wrap text-xs font-mono leading-relaxed text-gray-700 dark:text-muted-foreground">
              {fileContent?.content || t("emptyFile")}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // FILE LIST
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={t("searchPlaceholder")}
              className="input text-xs w-full pl-7"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="text-xs px-2.5 py-[7px] bg-foreground text-primary-foreground disabled:opacity-30 rounded-lg transition-opacity shrink-0"
          >
            {isSearching ? "..." : t("go")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Search results ── */}
        {view === "search" && searchResults.length > 0 ? (
          <div className="p-2">
            {/* Results header */}
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {t("results", { count: searchResults.length })}
              </span>
              <button
                onClick={() => { setView("files"); setSearchResults([]); setSearchQuery(""); }}
                className="text-xs text-gray-500 hover:text-foreground transition-colors"
              >
                {t("backToFiles")}
              </button>
            </div>

            <div className="space-y-1">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const path = r.file || r.path;
                    if (path) loadFileContent(path);
                  }}
                  className="w-full text-left p-2.5 border border-border hover:border-foreground rounded-lg transition-colors group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <DocIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-mono text-muted-foreground truncate">
                        {r.file || r.path}
                      </span>
                    </div>
                    {r.score !== undefined && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">
                        {(r.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 pl-[18px]">
                    {r.text || r.snippet || ""}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : view === "search" && !isSearching && searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <SearchIcon className="w-5 h-5 text-gray-300 dark:text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">No results found</p>
            <button
              onClick={() => { setView("files"); setSearchQuery(""); }}
              className="text-xs text-gray-500 hover:text-foreground mt-2 transition-colors"
            >
              {t("backToFiles")}
            </button>
          </div>
        ) : (
          /* ── File list ── */
          <div className="p-2 space-y-3">
            {/* Core / Stable files */}
            {stableFiles.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-1.5 mb-1">
                  {t("stableFiles")}
                </h4>
                <div className="space-y-px">
                  {stableFiles.map((f) => (
                    <button
                      key={f}
                      onClick={() => loadFileContent(f)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg hover:bg-gray-50 dark:hover:bg-background transition-colors group"
                    >
                      <DocIcon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-gray-600 dark:group-hover:text-gray-400 shrink-0 transition-colors" />
                      <span className="text-xs font-mono truncate">{f}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Daily log files */}
            {sortedDateFiles.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-1.5 mb-1">
                  {t("dailyLogs", { count: sortedDateFiles.length })}
                </h4>
                <div className="space-y-px">
                  {sortedDateFiles.slice(0, 30).map((item) => (
                    <div
                      key={item.path}
                      className="flex items-center rounded-lg hover:bg-gray-50 dark:hover:bg-background transition-colors group"
                    >
                      <button
                        onClick={() => loadFileContent(item.path)}
                        className="flex-1 flex items-center gap-2 px-2.5 py-2 text-left min-w-0"
                      >
                        <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-gray-600 dark:group-hover:text-gray-400 shrink-0 transition-colors" />
                        <span className="text-xs font-mono truncate">{item.date}</span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {formatDateLabel(item.date)}
                        </span>
                      </button>
                      <button
                        onClick={() => handleDelete(item.path)}
                        className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Delete"
                      >
                        <X className="w-3 h-3" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {memoryFiles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <DocIcon className="w-6 h-6 text-gray-300 dark:text-muted-foreground mb-3" />
                <p className="text-xs text-muted-foreground text-center">{t("noMemory")}</p>
                <p className="text-xs text-gray-300 dark:text-muted-foreground mt-1 text-center">
                  Your agent will create memory files as it learns
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
