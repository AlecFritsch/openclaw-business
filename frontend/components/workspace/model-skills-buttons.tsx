"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import { ProviderIcon } from "@/components/provider-icon";
import { PROVIDER_CATALOG, type AIProviderType } from "@openclaw-business/shared";
import { Zap, ChevronDown, Check, BookOpen } from "lucide-react";
import { useWorkspaceChat } from "@/lib/workspace-chat-context";

// ── Model Picker ─────────────────────────────────────────────────

export function ModelPickerButton() {
  const { agentId, activeModel, setActiveModel } = useWorkspaceChat();
  const { getToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  // Allow slash commands to open the picker via custom event
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-model-picker", handler);
    return () => window.removeEventListener("open-model-picker", handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !agentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const [gwConfig, orgModels] = await Promise.all([
          apiClient.getGatewayConfig(token, agentId).catch(() => null),
          apiClient.getAvailableModels(token).catch(() => ({ models: [], providers: [] })),
        ]);
        if (cancelled) return;
        let active = "";
        if (gwConfig?.config) {
          const cfg = gwConfig.config;
          active = cfg?.agents?.defaults?.model?.primary || cfg?.agents?.defaults?.model || "";
          if (typeof active === "object") active = (active as any).primary || "";
          if (active) setActiveModel(active);
        }
        const resolveModelName = (id: string): string => {
          const pk = id.split("/")[0] as AIProviderType;
          const catalog = PROVIDER_CATALOG[pk];
          return catalog?.models.find((cm) => cm.id === id)?.name || id.split("/").slice(1).join("/") || id;
        };
        const modelList = ((orgModels as any).models || []).map((m: string) => ({
          id: m, name: resolveModelName(m), provider: m.split("/")[0],
        }));
        if (active && !modelList.some((m: { id: string }) => m.id === active)) {
          modelList.unshift({ id: active, name: resolveModelName(active), provider: active.split("/")[0] });
        }
        setModels(modelList);
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, agentId, getToken, setActiveModel]);

  const handleSelect = async (modelId: string) => {
    if (!agentId) return;
    const prev = activeModel || "";
    setActiveModel(modelId);
    setIsOpen(false);
    try {
      const token = await getToken();
      if (!token) return;
      const gwData = await apiClient.getGatewayConfig(token, agentId);
      if (!gwData?.config) return;
      const config = JSON.parse(JSON.stringify(gwData.config));
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      if (typeof config.agents.defaults.model === "string") {
        config.agents.defaults.model = { primary: modelId };
      } else {
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        config.agents.defaults.model.primary = modelId;
      }
      await apiClient.patchGatewayConfig(token, agentId, { raw: JSON.stringify(config, null, 2), baseHash: gwData.hash });
    } catch {
      setActiveModel(prev);
    }
  };

  if (!agentId) return null;

  const displayName = activeModel
    ? (() => {
        const pk = activeModel.split("/")[0] as AIProviderType;
        return PROVIDER_CATALOG[pk]?.models.find((m) => m.id === activeModel)?.name || activeModel.split("/").pop();
      })()
    : "Model";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium transition-all ${
          isOpen
            ? "bg-foreground/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
        }`}
      >
        {activeModel ? (
          <ProviderIcon provider={activeModel.split("/")[0]} size={13} />
        ) : (
          <div className="w-3.5 h-3.5 rounded-full border-[1.5px] border-current opacity-50" />
        )}
        <span className="max-w-[90px] truncate">{displayName}</span>
        <ChevronDown className={`w-2.5 h-2.5 opacity-40 transition-transform ${isOpen ? "rotate-180" : ""}`} strokeWidth={3} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-60 bg-popover border border-border/60 rounded-xl shadow-xl z-50 overflow-hidden backdrop-blur-sm">
          <div className="px-3 py-2 border-b border-border/40">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">Model</span>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-6 flex justify-center">
                <div className="w-4 h-4 border-[1.5px] border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              </div>
            ) : (
              models.map((m) => {
                const isActive = m.id === activeModel;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-foreground/[0.06]"
                        : "hover:bg-foreground/[0.04]"
                    }`}
                  >
                    <ProviderIcon provider={m.provider} size={14} />
                    <span className={`text-sm truncate ${isActive ? "font-medium text-foreground" : "text-foreground/80"}`}>
                      {m.name}
                    </span>
                    {isActive && (
                      <Check className="w-3.5 h-3.5 ml-auto text-foreground/50 shrink-0" strokeWidth={2.5} />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Skills ────────────────────────────────────────────────────────

export function SkillsButton() {
  const { agentId } = useWorkspaceChat();
  const { getToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [skills, setSkills] = useState<{ slug: string; name: string; enabled: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !agentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const data = await apiClient.getGatewaySkills(token, agentId);
        if (!cancelled) setSkills((data.skills || []).map((s: any) => ({ slug: s.slug || s.id, name: s.name || s.slug || s.id, enabled: s.enabled !== false })));
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, agentId, getToken]);

  const handleToggle = async (slug: string, enabled: boolean) => {
    if (!agentId) return;
    setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled } : s)));
    try {
      const token = await getToken();
      if (token) await apiClient.updateGatewaySkill(token, agentId, slug, { enabled });
    } catch {
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled: !enabled } : s)));
    }
  };

  if (!agentId) return null;

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium transition-all ${
          isOpen
            ? "bg-foreground/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
        }`}
      >
        <Zap className="w-3 h-3" />
        <span>Skills</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-popover border border-border/60 rounded-xl shadow-xl z-50 overflow-hidden backdrop-blur-sm">
          <div className="px-3 py-2 border-b border-border/40 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">Skills</span>
            <span className="text-xs text-muted-foreground/50 tabular-nums">{enabledCount}/{skills.length}</span>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-6 flex justify-center">
                <div className="w-4 h-4 border-[1.5px] border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              </div>
            ) : (
              skills.map((skill) => (
                <button
                  key={skill.slug}
                  onClick={() => handleToggle(skill.slug, !skill.enabled)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-foreground/[0.04] transition-colors"
                >
                  <div className={`w-4 h-4 rounded-md border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${
                    skill.enabled
                      ? "bg-foreground border-foreground"
                      : "border-foreground/20"
                  }`}>
                    {skill.enabled && (
                      <Check className="w-2.5 h-2.5 text-background" strokeWidth={3} />
                    )}
                  </div>
                  <span className="text-sm text-foreground/80">{skill.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Knowledge Picker ─────────────────────────────────────────────

interface KnowledgeIntegration {
  _id: string;
  type: "google_drive" | "notion";
  label?: string;
  status?: string;
}

const BookIcon = () => (
  <BookOpen className="w-3.5 h-3.5" strokeWidth={1.8} />
);

const DriveIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M8.25 2.75L1.5 14.5l3.375 5.75h6.75L4.875 8.5 8.25 2.75z" fill="#4285F4"/>
    <path d="M15.75 2.75H8.25l6.75 11.75h7.5L15.75 2.75z" fill="#FBBC04"/>
    <path d="M22.5 14.5H15l-3.375 5.75h7.5L22.5 14.5z" fill="#34A853"/>
  </svg>
);

const NotionIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="opacity-80">
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.29 2.14c-.42-.326-.98-.7-2.055-.607L3.01 2.7c-.466.046-.56.28-.374.466l1.823 1.042zm.793 3.358v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.633c0-.606-.233-.933-.746-.886l-15.177.886c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.886l-.7.14v10.264c-.607.327-1.167.514-1.634.514-.746 0-.933-.234-1.493-.933l-4.572-7.186v6.953l1.447.327s0 .84-1.167.84l-3.218.187c-.093-.187 0-.653.327-.747l.84-.233V9.854L7.822 9.76c-.093-.42.14-1.026.793-1.073l3.451-.233 4.759 7.278v-6.44l-1.214-.14c-.093-.514.28-.886.747-.933l3.231-.187z"/>
  </svg>
);

export function KnowledgeButton() {
  const { agentId, enabledSources, toggleSource } = useWorkspaceChat();
  const { getToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [sourceCount, setSourceCount] = useState(0);
  const [integrations, setIntegrations] = useState<KnowledgeIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !agentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const [srcRes, intRes] = await Promise.all([
          fetch(`/api/knowledge/stats?agentId=${agentId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({ totalSources: 0 })),
          apiClient.getKnowledgeIntegrations(token).catch(() => ({ integrations: [] })),
        ]);
        if (cancelled) return;
        setSourceCount(srcRes.totalSources || 0);
        setIntegrations(intRes.integrations || []);
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, agentId, getToken]);

  const connectGoogle = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const { url } = await apiClient.getGoogleAuthUrl(token);
      window.open(url, "_blank", "width=600,height=700");
    } catch {}
  };

  const connectNotion = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const { url } = await apiClient.getNotionAuthUrl(token);
      window.open(url, "_blank", "width=600,height=700");
    } catch {}
  };

  if (!agentId) return null;

  const googleInt = integrations.find(i => i.type === "google_drive");
  const notionInt = integrations.find(i => i.type === "notion");
  const activeCount = [
    enabledSources.has("platform") && sourceCount > 0,
    enabledSources.has("google_drive") && googleInt,
    enabledSources.has("notion") && notionInt,
  ].filter(Boolean).length;

  const Checkbox = ({ checked }: { checked: boolean }) => (
    <div className={`w-4 h-4 rounded-md border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${
      checked ? "bg-foreground border-foreground" : "border-foreground/20"
    }`}>
      {checked && (
        <Check className="w-2.5 h-2.5 text-background" strokeWidth={3} />
      )}
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium transition-all ${
          isOpen
            ? "bg-foreground/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
        }`}
      >
        <BookIcon />
        <span>Knowledge</span>
        {activeCount > 0 && (
          <span className="text-xs bg-foreground/10 px-1.5 py-0.5 rounded-full tabular-nums leading-none">{activeCount}</span>
        )}
        <ChevronDown className={`w-2.5 h-2.5 opacity-40 transition-transform ${isOpen ? "rotate-180" : ""}`} strokeWidth={3} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-popover border border-border/60 rounded-xl shadow-xl z-50 overflow-hidden backdrop-blur-sm">
          <div className="px-3 py-2 border-b border-border/40">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">Knowledge</span>
          </div>
          <div className="py-1">
            {loading ? (
              <div className="px-3 py-6 flex justify-center">
                <div className="w-4 h-4 border-[1.5px] border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Platform Knowledge */}
                <button
                  onClick={() => toggleSource("platform")}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-foreground/[0.04] transition-colors"
                >
                  <Checkbox checked={enabledSources.has("platform")} />
                  <BookIcon />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground/80">Platform Knowledge</div>
                    <div className="text-xs text-muted-foreground/60">{sourceCount} {sourceCount === 1 ? "source" : "sources"}</div>
                  </div>
                </button>

                <div className="mx-3 my-1 border-t border-border/30" />

                {/* Google Drive */}
                <button
                  onClick={() => googleInt ? toggleSource("google_drive") : connectGoogle()}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-foreground/[0.04] transition-colors"
                >
                  <Checkbox checked={!!googleInt && enabledSources.has("google_drive")} />
                  <DriveIcon />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground/80">Google Drive</div>
                    <div className="text-xs text-muted-foreground/60">{googleInt ? (googleInt.label || "Connected") : "Connect"}</div>
                  </div>
                </button>

                {/* Notion */}
                <button
                  onClick={() => notionInt ? toggleSource("notion") : connectNotion()}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-foreground/[0.04] transition-colors"
                >
                  <Checkbox checked={!!notionInt && enabledSources.has("notion")} />
                  <NotionIcon />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground/80">Notion</div>
                    <div className="text-xs text-muted-foreground/60">{notionInt ? (notionInt.label || "Connected") : "Connect"}</div>
                  </div>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
