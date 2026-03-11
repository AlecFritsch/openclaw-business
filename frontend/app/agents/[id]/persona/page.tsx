"use client";

import { AppShell } from "@/components/app-shell";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { motion, AnimatePresence } from "motion/react";

interface PersonaFile {
  filename: string;
  content: string;
  size: number;
}

interface VersionItem {
  version: number;
  userId: string;
  createdAt: string;
  contentLength: number;
  action: 'edit' | 'restore' | 'generate';
}

const FILE_KEYS: Record<string, string> = {
  'AGENTS.md': 'files.agentsMd',
  'SOUL.md': 'files.soulMd',
  'IDENTITY.md': 'files.identityMd',
  'USER.md': 'files.userMd',
  'TOOLS.md': 'files.toolsMd',
  'HEARTBEAT.md': 'files.heartbeatMd',
  'MEMORY.md': 'files.memoryMd',
};

export default function AgentPersonaPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations('agentPersona');
  const [agentId, setAgentId] = useState<string>('');
  const [files, setFiles] = useState<PersonaFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFile, setActiveFile] = useState<string>('AGENTS.md');
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState<Record<string, boolean>>({});
  const { getToken } = useAuth();
  const confirm = useConfirm();
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<{ version: number; content: string } | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  useEffect(() => {
    params.then(p => setAgentId(p.id));
  }, [params]);

  const loadFiles = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const data = await apiClient.getPersonaFiles(token, agentId);
      setFiles(data.files);

      const initial: Record<string, string> = {};
      for (const file of data.files) {
        initial[file.filename] = file.content;
      }
      setEditedContent(initial);
      setHasChanges({});
    } catch (error) {
      showToast(t('failedLoad'), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, getToken, t]);

  useEffect(() => {
    if (!agentId) return;
    void loadFiles();
  }, [agentId, loadFiles]);

  const handleContentChange = useCallback((filename: string, content: string) => {
    setEditedContent(prev => ({ ...prev, [filename]: content }));
    const original = files.find(f => f.filename === filename);
    setHasChanges(prev => ({
      ...prev,
      [filename]: content !== (original?.content || ''),
    }));
  }, [files]);

  const handleSave = async (filename: string) => {
    setSaving(prev => ({ ...prev, [filename]: true }));
    try {
      const token = await getToken();
      if (!token) return;

      await apiClient.writeWorkspaceFile(token, agentId, filename, editedContent[filename] || '');
      showToast(t('savedFile', { filename }), 'success');
      setHasChanges(prev => ({ ...prev, [filename]: false }));

      setFiles(prev => prev.map(f =>
        f.filename === filename
          ? { ...f, content: editedContent[filename] || '', size: (editedContent[filename] || '').length }
          : f
      ));
    } catch {
      showToast(t('saveFailedFile', { filename }), 'error');
    } finally {
      setSaving(prev => ({ ...prev, [filename]: false }));
    }
  };

  const handleSaveAll = async () => {
    const changedFiles = Object.entries(hasChanges).filter(([_, changed]) => changed);
    if (changedFiles.length === 0) {
      showToast(t('noChanges'), 'info');
      return;
    }

    for (const [filename] of changedFiles) {
      await handleSave(filename);
    }
  };

  // Version History Functions
  const loadVersions = useCallback(async (filename: string) => {
    setVersionsLoading(true);
    setVersions([]);
    setSelectedVersion(null);
    try {
      const token = await getToken();
      if (!token) return;

      const data = await apiClient.getFileVersions(token, agentId, filename);
      setVersions(data.versions || []);
    } catch {
    } finally {
      setVersionsLoading(false);
    }
  }, [agentId, getToken]);

  const loadVersionContent = useCallback(async (filename: string, version: number) => {
    try {
      const token = await getToken();
      if (!token) return;

      const data = await apiClient.getFileVersion(token, agentId, filename, version);
      setSelectedVersion({ version, content: data.version.content });
    } catch {
    }
  }, [agentId, getToken]);

  const handleRestore = async (version: number) => {
    if (!await confirm({ description: t('restoreConfirm'), confirmLabel: t('restore') || 'Restore' })) return;

    setRestoringVersion(version);
    try {
      const token = await getToken();
      if (!token) return;

      await apiClient.restoreFileVersion(token, agentId, activeFile, version);
      showToast(t('restored'), 'success');

      // Reload the file content
      const fileData = await apiClient.getWorkspaceFile(token, agentId, activeFile);
      const newContent = fileData.file.content || (fileData.file as any).content || '';
      setEditedContent(prev => ({ ...prev, [activeFile]: newContent }));
      setFiles(prev => prev.map(f =>
        f.filename === activeFile ? { ...f, content: newContent, size: newContent.length } : f
      ));
      setHasChanges(prev => ({ ...prev, [activeFile]: false }));
      setSelectedVersion(null);

      // Reload versions
      void loadVersions(activeFile);
    } catch {
      showToast(t('restoreFailed'), 'error');
    } finally {
      setRestoringVersion(null);
    }
  };

  const toggleHistory = () => {
    if (!showHistory) {
      void loadVersions(activeFile);
    }
    setShowHistory(!showHistory);
    setSelectedVersion(null);
  };

  // Reload versions when active file changes while history is open
  useEffect(() => {
    if (showHistory && agentId) {
      void loadVersions(activeFile);
    }
  }, [showHistory, agentId, activeFile, loadVersions]);

  const activeFileData = files.find(f => f.filename === activeFile);
  const activeDescKey = FILE_KEYS[activeFile];
  const activeDescription = activeDescKey ? t(activeDescKey) : undefined;
  const totalChanges = Object.values(hasChanges).filter(Boolean).length;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('justNow');
    if (diffMins < 60) return t('minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('daysAgo', { count: diffDays });
    return d.toLocaleDateString();
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'edit': return t('editAction');
      case 'restore': return t('restoreAction');
      case 'generate': return t('generateAction');
      default: return action;
    }
  };

  return (
    <AppShell embedded>
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-medium">{t('title')}</h1>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs border border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950">
                {t('workspaceFiles')}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {t('description')}
            </p>
          </div>
          {totalChanges > 0 && (
            <button onClick={handleSaveAll} className="btn-primary-sm px-4">
              {t('saveAll', { count: totalChanges })}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-24 text-gray-400">{t('loading')}</div>
      ) : (
        <div className="flex gap-6 min-h-[600px]">
          {/* File Sidebar */}
          <div className="w-56 flex-shrink-0 space-y-1">
            {files.map((file) => {
              const descKey = FILE_KEYS[file.filename];
              const isActive = activeFile === file.filename;
              const changed = hasChanges[file.filename];

              return (
                <button
                  key={file.filename}
                  onClick={() => setActiveFile(file.filename)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all border ${
                    isActive
                      ? 'border-gray-300 dark:border-border bg-muted'
                      : 'border-transparent hover:border-gray-200 dark:hover:border-gray-800 hover:bg-gray-50 dark:hover:bg-background'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-mono ${isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {file.filename}
                    </span>
                    {changed && (
                      <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                    )}
                  </div>
                  {descKey && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                      {t(descKey).substring(0, 50)}...
                    </p>
                  )}
                  {file.size > 0 && (
                    <span className="text-xs text-muted-foreground mt-0.5 block">
                      {file.size > 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col rounded-xl border border-border overflow-hidden">
            {/* File Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium">{activeFile}</span>
                  {hasChanges[activeFile] && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">{t('modified')}</span>
                  )}
                </div>
                {activeDescription && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activeDescription}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleHistory}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-all border ${
                    showHistory
                      ? 'border-black dark:border-foreground text-foreground'
                      : 'border-border text-gray-500 hover:text-foreground hover:border-foreground/30'
                  }`}
                >
                  {t('history')}
                </button>
                <button
                  onClick={() => {
                    const original = files.find(f => f.filename === activeFile);
                    if (original) {
                      handleContentChange(activeFile, original.content);
                    }
                  }}
                  className="btn-ghost-sm"
                  disabled={!hasChanges[activeFile]}
                >
                  {t('reset')}
                </button>
                <button
                  onClick={() => handleSave(activeFile)}
                  className="btn-secondary"
                  disabled={!hasChanges[activeFile] || saving[activeFile]}
                >
                  {saving[activeFile] ? t('saving') : t('save')}
                </button>
              </div>
            </div>

            <div className="flex-1 flex">
              {/* Textarea Editor */}
              <textarea
                value={selectedVersion ? selectedVersion.content : (editedContent[activeFile] || '')}
                onChange={(e) => {
                  if (!selectedVersion) {
                    handleContentChange(activeFile, e.target.value);
                  }
                }}
                readOnly={!!selectedVersion}
                className={`flex-1 w-full p-4 text-sm font-mono leading-relaxed resize-none focus:outline-none placeholder:text-muted-foreground ${
                  selectedVersion
                    ? 'bg-amber-50/50 dark:bg-amber-950/10 text-gray-500'
                    : 'bg-card'
                }`}
                placeholder={t('writePlaceholder', { filename: activeFile })}
                spellCheck={false}
              />

              {/* Version History Panel */}
              <AnimatePresence>
                {showHistory && (
                  <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 280, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                    className="border-l border-border bg-muted overflow-hidden flex flex-col"
                  >
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                      <span className="text-xs font-medium">{t('versionHistory')}</span>
                      <button
                        onClick={() => { setShowHistory(false); setSelectedVersion(null); }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        {t('closeHistory')}
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                      {versionsLoading ? (
                        <div className="p-4 text-center text-xs text-gray-400">{t('loading')}</div>
                      ) : versions.length === 0 ? (
                        <div className="p-4 text-xs text-gray-400 leading-relaxed">
                          {t('noVersions')}
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200 dark:divide-gray-800">
                          {/* Current version indicator */}
                          {selectedVersion && (
                            <button
                              onClick={() => setSelectedVersion(null)}
                              className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                            >
                              <span className="text-foreground font-medium">{t('currentVersion')}</span>
                              <span className="text-gray-400 ml-2">{t('clickToReturn')}</span>
                            </button>
                          )}
                          {versions.map((v) => {
                            const isSelected = selectedVersion?.version === v.version;
                            return (
                              <div
                                key={v.version}
                                className={`px-3 py-2.5 transition-colors ${
                                  isSelected ? 'bg-muted' : 'hover:bg-gray-100/50 dark:hover:bg-gray-900/50'
                                }`}
                              >
                                <button
                                  onClick={() => loadVersionContent(activeFile, v.version)}
                                  className="w-full text-left"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-mono font-medium text-foreground">
                                      {t('version', { number: v.version })}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                      {formatDate(v.createdAt)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-xs px-1 py-0.5 ${
                                      v.action === 'restore'
                                        ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30'
                                        : v.action === 'generate'
                                          ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30'
                                          : 'text-gray-500 bg-muted'
                                    }`}>
                                      {getActionLabel(v.action)}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                      {t('chars', { count: v.contentLength })}
                                    </span>
                                  </div>
                                </button>
                                {isSelected && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    className="mt-2 overflow-hidden"
                                  >
                                    <button
                                      onClick={() => handleRestore(v.version)}
                                      disabled={restoringVersion === v.version}
                                      className="w-full text-xs px-2 py-1.5 border border-gray-300 dark:border-border hover:border-foreground transition-colors disabled:opacity-50"
                                    >
                                      {restoringVersion === v.version ? t('working') : t('restore')}
                                    </button>
                                  </motion.div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted text-xs text-muted-foreground">
              <span>
                {selectedVersion ? (
                  <>{t('viewingVersion', { version: selectedVersion.version, chars: selectedVersion.content.length })}</>
                ) : (
                  <>
                    {t('charsCount', { count: (editedContent[activeFile] || '').length })}
                    {' | '}
                    {t('linesCount', { count: (editedContent[activeFile] || '').split('\n').length })}
                  </>
                )}
              </span>
              <span>{t('markdownLabel')}</span>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
