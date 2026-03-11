"use client";

import { AppShell } from "@/components/app-shell";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import { Menu, BookOpen, Send } from "lucide-react";

interface Message { role: 'user' | 'assistant'; content: string; sources?: { name: string; score: number }[]; }
interface Model { id: string; name: string; }
interface Conversation { _id: string; lastMessage: string; model: string; updatedAt: string; messageCount: number; }
interface KnowledgeSource { _id: string; name: string; type: 'file' | 'url' | 'text' | 'crawl'; origin: string; status: string; chunkCount: number; }

const SOURCE_ICONS: Record<string, string> = { file: '📄', url: '🌐', text: '📝', crawl: '🕷️', notion: '📓', google_drive: '📁' };

/** Slash commands for Havoc Chat */
const SLASH_COMMANDS: { cmd: string; desc: string; action: string }[] = [
  { cmd: '/clear', desc: 'Clear current chat', action: 'clear' },
  { cmd: '/new', desc: 'Start new conversation', action: 'new' },
  { cmd: '/model', desc: 'Switch AI model', action: 'model' },
  { cmd: '/knowledge', desc: 'Toggle knowledge picker', action: 'knowledge' },
  { cmd: '/sources', desc: 'Clear selected sources', action: 'clear_sources' },
  { cmd: '/export', desc: 'Export conversation', action: 'export' },
];

function groupSources(sources: KnowledgeSource[]) {
  const groups: Record<string, KnowledgeSource[]> = {};
  for (const s of sources) {
    // Detect Notion/GDrive from origin pattern, otherwise use type
    let group = s.type.toUpperCase();
    if (s.origin?.includes('notion.so') || s.name?.toLowerCase().includes('notion')) group = 'NOTION';
    else if (s.origin?.includes('drive.google') || s.origin?.includes('docs.google')) group = 'GOOGLE DRIVE';
    else if (s.type === 'crawl' || s.type === 'url') group = 'WEBSITES';
    else if (s.type === 'file') group = 'FILES';
    else group = 'TEXT';
    (groups[group] ??= []).push(s);
  }
  return groups;
}

function getIcon(source: KnowledgeSource) {
  if (source.origin?.includes('notion.so')) return SOURCE_ICONS.notion;
  if (source.origin?.includes('drive.google')) return SOURCE_ICONS.google_drive;
  return SOURCE_ICONS[source.type] || '📄';
}

export default function ChatPage() {
  const { getToken } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  // Knowledge source picker state
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Slash command state
  const [slashFilter, setSlashFilter] = useState('');
  const [slashSelected, setSlashSelected] = useState(0);
  const slashOpen = slashFilter !== '';
  const slashFiltered = useMemo(() =>
    SLASH_COMMANDS.filter(c => c.cmd.slice(1).toLowerCase().startsWith(slashFilter.toLowerCase().replace(/^\//, ''))),
    [slashFilter]
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { loadModels(); loadConversations(); loadSources(); }, []);

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    if (pickerOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const loadModels = async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/chat/models', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setModels(data.models || []);
      if (data.models?.length) setSelectedModel(data.models[0].id);
    } catch {}
  };

  const loadConversations = async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/chat/conversations', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {}
  };

  const loadSources = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getKnowledgeSources(token);
      setSources((data.sources || []).filter((s: KnowledgeSource) => s.status === 'ready'));
    } catch {}
  };

  const loadConversation = async (id: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/chat/conversations/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setMessages((data.messages || []).map((m: any) => ({ role: m.role, content: m.content })));
      setConvId(id);
    } catch {}
  };

  const newChat = () => { setMessages([]); setConvId(null); };

  const toggleSource = (id: string) => {
    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const removeSource = (id: string) => {
    setSelectedSourceIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  // Slash command detection on input change
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    // Detect slash at start of input
    if (value.startsWith('/')) {
      setSlashFilter(value.split(' ')[0]);
      setSlashSelected(0);
    } else {
      setSlashFilter('');
    }
  }, []);

  const executeSlashCommand = useCallback((action: string) => {
    setInput('');
    setSlashFilter('');
    switch (action) {
      case 'clear': setMessages([]); break;
      case 'new': setMessages([]); setConvId(null); break;
      case 'model': /* focus model selector */ break;
      case 'knowledge': setPickerOpen(p => !p); break;
      case 'clear_sources': setSelectedSourceIds(new Set()); break;
      case 'export': {
        const text = messages.map(m => `${m.role === 'user' ? 'You' : 'Assistant'}: ${m.content}`).join('\n\n');
        navigator.clipboard.writeText(text).catch(() => {});
        break;
      }
    }
  }, [messages]);

  const handleSlashSelect = useCallback((cmd: typeof SLASH_COMMANDS[0]) => {
    executeSlashCommand(cmd.action);
    inputRef.current?.focus();
  }, [executeSlashCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (slashOpen && slashFiltered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelected(i => Math.min(i + 1, slashFiltered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelected(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const selected = slashFiltered[Math.min(slashSelected, slashFiltered.length - 1)];
        if (selected) handleSlashSelect(selected);
        return;
      }
      if (e.key === 'Escape') { setSlashFilter(''); setInput(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [slashOpen, slashFiltered, slashSelected, handleSlashSelect]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput('');
    setSending(true);
    try {
      const token = await getToken();
      const sourceIds = selectedSourceIds.size > 0 ? [...selectedSourceIds] : undefined;
      const res = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMsgs, model: selectedModel, sourceIds, conversationId: convId }),
      });
      const data = await res.json();
      if (data.message) setMessages([...newMsgs, { ...data.message, sources: data.sources }]);
      if (data.conversationId) setConvId(data.conversationId);
      loadConversations();
    } catch {} finally { setSending(false); }
  };

  const selectedSources = sources.filter(s => selectedSourceIds.has(s._id));
  const filteredSources = sources.filter(s => !sourceSearch || s.name.toLowerCase().includes(sourceSearch.toLowerCase()));
  const grouped = groupSources(filteredSources);

  return (
    <AppShell noPadding>
      <div className="flex h-[calc(100vh-48px)]">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-56 border-r border-border/60 flex flex-col shrink-0 bg-card">
            <div className="p-3 border-b border-border/40">
              <button onClick={newChat} className="w-full btn-primary-sm">New Chat</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.map(c => (
                <button key={c._id} onClick={() => loadConversation(c._id)}
                  className={`w-full px-3 py-2.5 text-left border-b border-border/20 hover:bg-muted/40 transition-colors ${convId === c._id ? 'bg-muted/60' : ''}`}>
                  <p className="text-xs truncate">{c.lastMessage?.slice(0, 50) || 'New conversation'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.messageCount} msgs · {c.model?.split('/')[1] || ''}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 shrink-0">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1 rounded hover:bg-muted/60 text-muted-foreground">
              <Menu className="w-4 h-4" strokeWidth={2} />
            </button>
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
              className="px-2.5 py-1 rounded-md border border-border/60 bg-background text-xs">
              {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-lg font-medium text-muted-foreground/60">Havoc Chat</p>
                  <p className="text-xs text-muted-foreground/40 mt-1">Ask anything. Knowledge-powered.</p>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] rounded-2xl text-sm ${
                  m.role === 'user'
                    ? 'bg-foreground text-background rounded-br-md px-3.5 py-2.5'
                    : 'bg-muted/50 border border-border/40 rounded-bl-md px-3.5 py-2.5'
                }`}>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/30 flex flex-wrap gap-1.5">
                      {m.sources.map((s, j) => (
                        <span key={j} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-background/60 border border-border/40 text-muted-foreground">
                          📄 {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted/50 border border-border/40 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.1s]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0.2s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input area with source chips + picker */}
          <div className="px-4 py-3 border-t border-border/40 shrink-0">
            <div className="max-w-3xl mx-auto">
              {/* Selected source chips */}
              {selectedSources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedSources.map(s => (
                    <span key={s._id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 border border-border/40 text-xs text-muted-foreground">
                      <span>{getIcon(s)}</span>
                      <span className="truncate max-w-[160px]">{s.name}</span>
                      <button onClick={() => removeSource(s._id)} className="ml-0.5 hover:text-foreground transition-colors">×</button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-end">
                {/* Knowledge picker button */}
                <div className="relative" ref={pickerRef}>
                  <button onClick={() => setPickerOpen(!pickerOpen)}
                    className={`p-2 rounded-xl border transition-colors ${selectedSourceIds.size > 0 ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-border/60 text-muted-foreground hover:bg-muted/40'}`}
                    title="Select knowledge sources">
                    <BookOpen className="w-4 h-4" strokeWidth={2} />
                    {selectedSourceIds.size > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center font-medium">{selectedSourceIds.size}</span>
                    )}
                  </button>

                  {/* Picker popover */}
                  {pickerOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-72 max-h-80 rounded-xl border border-border/60 bg-card shadow-lg overflow-hidden z-50">
                      {/* Search */}
                      <div className="p-2 border-b border-border/40">
                        <input value={sourceSearch} onChange={e => setSourceSearch(e.target.value)}
                          placeholder="Search sources..." autoFocus
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border/40 bg-background text-xs focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                      </div>

                      {/* Source list grouped */}
                      <div className="overflow-y-auto max-h-60 p-1.5">
                        {sources.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">No knowledge sources yet</p>
                        ) : Object.entries(grouped).map(([group, items]) => (
                          <div key={group} className="mb-1.5">
                            <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 py-1">{group}</p>
                            {items.map(s => (
                              <button key={s._id} onClick={() => toggleSource(s._id)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${selectedSourceIds.has(s._id) ? 'bg-emerald-500/10' : 'hover:bg-muted/40'}`}>
                                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-xs shrink-0 ${selectedSourceIds.has(s._id) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border/60'}`}>
                                  {selectedSourceIds.has(s._id) && '✓'}
                                </span>
                                <span className="text-sm">{getIcon(s)}</span>
                                <span className="text-xs truncate flex-1">{s.name}</span>
                                <span className="text-xs text-muted-foreground/50 shrink-0">{s.chunkCount}ch</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>

                      {/* Footer */}
                      {selectedSourceIds.size > 0 && (
                        <div className="border-t border-border/40 px-3 py-2 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{selectedSourceIds.size} selected</span>
                          <button onClick={() => setSelectedSourceIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear all</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Input with slash command popup */}
                <div className="flex-1 relative">
                  {slashOpen && slashFiltered.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 py-1.5 bg-card border border-border/60 rounded-lg shadow-lg overflow-hidden z-50 max-h-48 overflow-y-auto">
                      <div className="px-2 py-1 text-xs text-muted-foreground border-b border-border/40">Commands</div>
                      {slashFiltered.map((c, i) => (
                        <button key={c.cmd} type="button" onClick={() => handleSlashSelect(c)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                            i === slashSelected ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-muted-foreground'
                          }`}>
                          <span className="font-mono text-muted-foreground">{c.cmd}</span>
                          <span className="text-muted-foreground truncate">{c.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea ref={inputRef} value={input} onChange={e => handleInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={selectedSourceIds.size > 0 ? `Ask about ${selectedSourceIds.size} source${selectedSourceIds.size > 1 ? 's' : ''}...` : 'Type / for commands...'} rows={1} disabled={sending}
                    className="w-full px-3.5 py-2 rounded-xl border border-border/60 bg-background text-sm resize-none focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                </div>
                <button onClick={send} disabled={!input.trim() || sending || slashOpen}
                  className="px-4 py-2 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-40 transition-opacity">
                  <Send className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
