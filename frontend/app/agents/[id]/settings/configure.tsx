"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { PROVIDER_CATALOG, type AIProviderType } from "@openclaw-business/shared";
import { ProviderIcon } from "@/components/provider-icon";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";

export function AgentConfigurationContent({ agentId }: { agentId: string }) {
  const [config, setConfig] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Show/hide advanced sections
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Collapsible section state — default: only core sections open
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    model: false,
    streaming: true,
    session: true,
    sandbox: true,
    heartbeat: true,
    tools: true,
    hooks: true,
    memory: true,
    voicecall: true,
    tts: true,
    browser: true,
    api: true,
    logging: true,
  });
  const toggleSection = (key: string) => setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  // Gateway config state (live from running container)
  const [gatewayConfig, setGatewayConfig] = useState<any>(null);
  const [configHash, setConfigHash] = useState<string>("");
  const [useGatewayConfig, setUseGatewayConfig] = useState(false);
  const [gatewayModels, setGatewayModels] = useState<any>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const { getToken } = useAuth();
  const t = useTranslations('agentConfig');
  const tc = useTranslations('common');

  useEffect(() => {
    if (!agentId) return;
    const fetchData = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        // Try to load live config from gateway first, fall back to DB
        const [dbConfigData, gwConfigData, gwModelsData, orgModelsData] = await Promise.all([
          apiClient.getAgentConfiguration(token, agentId),
          apiClient.getGatewayConfig(token, agentId).catch(() => null),
          apiClient.getGatewayModels(token, agentId).catch(() => null),
          apiClient.getAvailableModels(token).catch(() => ({ models: [], providers: [] })),
        ]);

        if (gwModelsData?.models) {
          setGatewayModels(gwModelsData.models);
        }

        setAvailableModels(orgModelsData?.models || []);

        if (gwConfigData?.config) {
          // Use live gateway config
          setGatewayConfig(gwConfigData.config);
          setConfigHash(gwConfigData.hash || "");
          setUseGatewayConfig(true);

          // Map gateway config to our UI format
          const gwCfg = gwConfigData.config;
          setConfig({
            model: gwCfg?.agents?.defaults?.model?.primary || dbConfigData.configuration?.model || "",
            temperature: gwCfg?.agents?.defaults?.models?.[gwCfg?.agents?.defaults?.model?.primary]?.params?.temperature ?? dbConfigData.configuration?.temperature ?? 0.7,
            maxTokens: gwCfg?.agents?.defaults?.models?.[gwCfg?.agents?.defaults?.model?.primary]?.params?.maxTokens ?? dbConfigData.configuration?.maxTokens ?? 4096,
            toolProfile: gwCfg?.tools?.profile || dbConfigData.configuration?.toolProfile || "messaging",
            skills: gwCfg?.skills?.entries ? Object.keys(gwCfg.skills.entries).filter((k: string) => gwCfg.skills.entries[k]?.enabled !== false) : (dbConfigData.configuration?.skills || []),
            sessionScope: gwCfg?.session?.scope || dbConfigData.configuration?.sessionScope || "per-sender",
            sessionResetMode: gwCfg?.session?.reset?.mode || dbConfigData.configuration?.sessionResetMode || "daily",
          });
        } else {
          // Fall back to DB config
          setConfig(dbConfigData.configuration || {});
        }
      } catch (err) {
        setConfig({});
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [agentId, getToken]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const token = await getToken();
      if (!token) return;

      // Always save to DB
      await apiClient.updateAgentConfiguration(token, agentId, config);

      // Also patch the live gateway config if connected
      if (useGatewayConfig && configHash) {
        try {
          const patchPayload: any = {};

          // Map UI fields to OpenClaw config structure
          if (config.model) {
            patchPayload.agents = { defaults: { model: { primary: config.model } } };
          }
          if (config.toolProfile) {
            patchPayload.tools = { profile: config.toolProfile };
          }
          if (config.sessionScope || config.sessionResetMode) {
            patchPayload.session = {};
            if (config.sessionScope) patchPayload.session.scope = config.sessionScope;
            if (config.sessionResetMode) patchPayload.session.reset = { mode: config.sessionResetMode };
          }

          await apiClient.patchGatewayConfig(token, agentId, {
            raw: JSON.stringify(patchPayload),
            baseHash: configHash,
          });
        } catch (gwErr) {
        }
      }

      showToast(t('configSaved'), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('failedSave'), "error");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-12">{t('loading')}</div>;
  }

  return (
    <>
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-medium">{t('title')}</h1>
            {useGatewayConfig && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs border border-green-300 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {t('liveGateway')}
              </span>
            )}
          </div>
        </div>

        {/* Section quick-nav */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {[
            { key: "brain", href: "#cfg-brain" },
            { key: "heartbeat", href: "#cfg-heartbeat" },
            { key: "memory", href: "#cfg-memory" },
            ...(showAdvanced ? [
              { key: "response", href: "#cfg-response" },
              { key: "reasoning", href: "#cfg-reasoning" },
              { key: "sessions", href: "#cfg-session" },
              { key: "sandbox", href: "#cfg-sandbox" },
              { key: "tools", href: "#cfg-tools" },
              { key: "hooks", href: "#cfg-hooks" },
              { key: "api", href: "#cfg-api" },
              { key: "voice", href: "#cfg-voice" },
              { key: "tts", href: "#cfg-tts" },
              { key: "browser", href: "#cfg-browser" },
            ] : []),
          ].map(s => (
            <a key={s.href} href={s.href} className="px-2 py-0.5 text-xs border border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-gray-400 dark:hover:border-gray-500 transition-colors">
              {t(`quickNav.${s.key}`)}
            </a>
          ))}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-2 py-0.5 text-xs border rounded-lg transition-colors ${
              showAdvanced
                ? 'border-black dark:border-foreground text-foreground font-medium'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {showAdvanced ? '− Advanced' : '+ Advanced'}
          </button>
        </div>

        <div className="space-y-5">
          {/* AI Brain */}
          <div id="cfg-brain" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('aiBrain')}</h3>
              <p className="text-xs text-muted-foreground">{t('aiBrainDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('aiModel')}</label>
                {availableModels.length > 0 ? (
                  <Combobox
                    value={config?.model || ""}
                    onChange={(v) => setConfig((prev: any) => ({ ...prev, model: v }))}
                    placeholder={t('aiModel')}
                    searchPlaceholder="Search models..."
                    options={availableModels.map(m => {
                      const providerKey = m.split("/")[0] as AIProviderType;
                      const catalog = PROVIDER_CATALOG[providerKey];
                      const modelInfo = catalog?.models.find(cm => cm.id === m);
                      return {
                        value: m,
                        label: modelInfo?.name || m.split("/")[1] || m,
                        description: catalog?.label,
                        group: catalog?.label || providerKey,
                        icon: <ProviderIcon provider={providerKey} size={16} />,
                      };
                    })}
                  />
                ) : (
                  <p className="text-xs text-gray-400 mt-1">
                    {t('noProviders')} <a href="/settings" className="underline hover:text-foreground">{t('addProvider')}</a> {t('first')}.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('creativity')}</label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={config?.temperature ?? 0.7}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    className="input"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('responseLength')}</label>
                  <input
                    type="number"
                    min="100"
                    max="200000"
                    step="100"
                    value={config?.maxTokens ?? 4096}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                    className="input"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Actions (Channels → Channels page, Skills → Skills page) */}
          <div className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('actions')}</h3>
              <p className="text-xs text-muted-foreground">{t('actionsDesc')}</p>
            </div>

            {/* Tool Profile */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('actionSet')}</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: "messaging", label: "Messaging", desc: "Chat, sessions, and web search" },
                  { value: "coding", label: "Technical", desc: "Files, code execution, and sessions" },
                  { value: "full", label: "Everything", desc: "All skills enabled" },
                  { value: "minimal", label: "Basic", desc: "Conversation only" },
                ].map((profile) => (
                  <button
                    key={profile.value}
                    onClick={() => setConfig((prev: any) => ({ ...prev, toolProfile: profile.value }))}
                    className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                      (config?.toolProfile || "messaging") === profile.value
                        ? "bg-foreground text-primary-foreground border-black dark:border-foreground"
                        : "border-border hover:border-gray-400"
                    }`}
                    title={profile.desc}
                  >
                    {profile.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Conversation Memory */}
          <div className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('memorySection')}</h3>
              <p className="text-xs text-muted-foreground">{t('memoryDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('memoryScope')}</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "per-sender", label: "Per Sender" },
                    { value: "per-channel", label: "Per Channel" },
                    { value: "global", label: "Global" },
                  ].map((scope) => (
                    <button
                      key={scope.value}
                      onClick={() => setConfig((prev: any) => ({ ...prev, sessionScope: scope.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                        (config?.sessionScope || "per-sender") === scope.value
                          ? "bg-foreground text-primary-foreground border-black dark:border-foreground"
                          : "border-border hover:border-gray-400"
                      }`}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('memoryReset')}</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "daily", label: "Daily (4 AM)" },
                    { value: "idle", label: "After Idle (2h)" },
                    { value: "manual", label: "Manual Only" },
                  ].map((reset) => (
                    <button
                      key={reset.value}
                      onClick={() => setConfig((prev: any) => ({ ...prev, sessionResetMode: reset.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                        (config?.sessionResetMode || "daily") === reset.value
                          ? "bg-foreground text-primary-foreground border-black dark:border-foreground"
                          : "border-border hover:border-gray-400"
                      }`}
                    >
                      {reset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Advanced Sections ── */}
          {!showAdvanced && (
            <button
              onClick={() => setShowAdvanced(true)}
              className="w-full py-4 border-2 border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
            >
              Show 16 more advanced settings...
            </button>
          )}

          {showAdvanced && (
            <>
          {/* Streaming & Response */}
          <div id="cfg-response" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('responseSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('responseDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('blockStreaming')}</label>
                <div className="flex gap-2">
                  {[{ value: "off", label: t('off') }, { value: "on", label: t('on') }].map((opt) => (
                    <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, blockStreaming: opt.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.blockStreaming || "off") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                    >{opt.label}</button>
                  ))}
                </div>
                <p className="text-xs text-gray-400">{t('blockStreamingHelp')}</p>
              </div>
              {config?.blockStreaming === "on" && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('blockBreak')}</label>
                    <div className="flex gap-2">
                      {[{ value: "text_end", label: t('textEnd') }, { value: "message_end", label: t('messageEnd') }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, blockStreamingBreak: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.blockStreamingBreak || "text_end") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('chunkMinChars')}</label>
                      <input type="number" placeholder="Auto" value={config?.blockStreamingChunkMin || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, blockStreamingChunkMin: parseInt(e.target.value) || 0 }))} className="input text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('chunkMaxChars')}</label>
                      <input type="number" placeholder="Auto" value={config?.blockStreamingChunkMax || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, blockStreamingChunkMax: parseInt(e.target.value) || 0 }))} className="input text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('coalesceIdle')}</label>
                      <input type="number" placeholder="Auto" value={config?.blockStreamingCoalesceIdleMs || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, blockStreamingCoalesceIdleMs: parseInt(e.target.value) || 0 }))} className="input text-xs" />
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('humanDelay')}</label>
                <div className="flex gap-2">
                  {[{ value: "off", label: t('off') }, { value: "natural", label: t('natural') }, { value: "custom", label: t('custom') }].map((opt) => (
                    <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, humanDelay: opt.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.humanDelay || "off") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                    >{opt.label}</button>
                  ))}
                </div>
                <p className="text-xs text-gray-400">{t('humanDelayHelp')}</p>
              </div>
              {config?.humanDelay === "custom" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('minDelay')}</label>
                    <input type="number" min="0" max="10000" step="100" value={config?.humanDelayMin ?? 800}
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, humanDelayMin: parseInt(e.target.value) }))} className="input" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('maxDelay')}</label>
                    <input type="number" min="0" max="10000" step="100" value={config?.humanDelayMax ?? 2500}
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, humanDelayMax: parseInt(e.target.value) }))} className="input" />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('draftStreaming')}</label>
                <div className="flex gap-2">
                  {[{ value: "off", label: t('off') }, { value: "partial", label: t('partial') }, { value: "block", label: t('block') }].map((opt) => (
                    <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, telegramStreamMode: opt.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.telegramStreamMode || "partial") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Thinking / Reasoning */}
          <div id="cfg-reasoning" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('reasoningSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('reasoningDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('thinkingLevel')}</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "off", label: t('off') },
                    { value: "minimal", label: t('minimal') },
                    { value: "low", label: t('low') },
                    { value: "medium", label: t('medium') },
                    { value: "high", label: t('high') },
                    { value: "xhigh", label: t('ultra') },
                  ].map((opt) => (
                    <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, thinkingLevel: opt.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.thinkingLevel || "low") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                    >{opt.label}</button>
                  ))}
                </div>
                <p className="text-xs text-gray-400">{t('thinkingLevelHelp')}</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('reasoningVisibility')}</label>
                <div className="flex gap-2">
                  {[{ value: "off", label: t('hidden') }, { value: "on", label: t('show') }, { value: "stream", label: t('stream') }].map((opt) => (
                    <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, reasoningVisibility: opt.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.reasoningVisibility || "off") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Heartbeat */}
          <div id="cfg-heartbeat" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('heartbeatSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('heartbeatDesc')}</p>
            </div>
            <div className="space-y-4">
              <Switch checked={config?.heartbeatEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, heartbeatEnabled: v }))} label={config?.heartbeatEnabled ? t('enabled') : t('disabled')} />
              {config?.heartbeatEnabled && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('interval')}</label>
                    <div className="flex gap-2 flex-wrap">
                      {[{ value: "15m", label: "15 min" }, { value: "30m", label: "30 min" }, { value: "1h", label: "1 hour" }, { value: "2h", label: "2 hours" }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, heartbeatInterval: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.heartbeatInterval || "30m") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('targetChannel')}</label>
                    <div className="flex gap-2 flex-wrap">
                      {[{ value: "last", label: "Last Active" }, { value: "whatsapp", label: "WhatsApp" }, { value: "telegram", label: "Telegram" }, { value: "discord", label: "Discord" }, { value: "none", label: "None" }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, heartbeatTarget: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.heartbeatTarget || "last") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('heartbeatModel')}</label>
                    <input value={config?.heartbeatModel || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, heartbeatModel: e.target.value }))}
                      className="input text-sm font-mono" placeholder="openai/gpt-5-mini" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('heartbeatPrompt')}</label>
                    <textarea value={config?.heartbeatPrompt || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, heartbeatPrompt: e.target.value }))}
                      className="input min-h-[80px] font-mono text-xs" placeholder={t('heartbeatPromptPlaceholder')} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('sendTo')}</label>
                      <input value={config?.heartbeatTo || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, heartbeatTo: e.target.value }))}
                        className="input text-xs font-mono" placeholder="e.g. tg:123456" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('accountIdLabel')}</label>
                      <input value={config?.heartbeatAccountId || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, heartbeatAccountId: e.target.value }))}
                        className="input text-xs font-mono" placeholder="e.g. personal" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('activeHoursStart')}</label>
                      <input type="time" value={config?.heartbeatActiveHoursStart || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, heartbeatActiveHoursStart: e.target.value }))} className="input text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('activeHoursEnd')}</label>
                      <input type="time" value={config?.heartbeatActiveHoursEnd || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, heartbeatActiveHoursEnd: e.target.value }))} className="input text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('timezone')}</label>
                      <input value={config?.heartbeatActiveHoursTimezone || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, heartbeatActiveHoursTimezone: e.target.value }))}
                        className="input text-xs font-mono" placeholder="Europe/Berlin" />
                    </div>
                  </div>
                  <Switch size="sm" checked={config?.heartbeatIncludeReasoning ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, heartbeatIncludeReasoning: v }))} label={t('includeReasoning')} />
                </>
              )}
            </div>
          </div>

          {/* Session Advanced */}
          <div id="cfg-session" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('sessionControl')}</h3>
              <p className="text-xs text-muted-foreground">{t('sessionControlDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('dmScope')}</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "main", label: "Shared", desc: "All DMs share one session" },
                    { value: "per-peer", label: "Per Sender", desc: "One session per sender" },
                    { value: "per-channel-peer", label: "Per Channel+Sender", desc: "Isolated per channel and sender" },
                    { value: "per-account-channel-peer", label: "Per Account+Channel+Sender", desc: "Full isolation per account, channel, and sender" },
                  ].map((opt) => (
                    <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, sessionDmScope: opt.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.sessionDmScope || "per-channel-peer") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                      title={opt.desc}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('maxConcurrent')}</label>
                  <input type="number" min="1" max="20" value={config?.maxConcurrent ?? 3}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, maxConcurrent: parseInt(e.target.value) }))} className="input w-full" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('resetAtHour')}</label>
                  <input type="number" min="0" max="23" value={config?.sessionAtHour ?? 4}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, sessionAtHour: parseInt(e.target.value) }))} className="input w-full" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('idleTimeout')}</label>
                  <input type="number" min="0" value={config?.sessionIdleMinutes ?? 120}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, sessionIdleMinutes: parseInt(e.target.value) }))} className="input w-full" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('sessionMainKey')}</label>
                <input value={config?.sessionMainKey || 'main'}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, sessionMainKey: e.target.value }))}
                  className="input text-sm font-mono w-48" placeholder="main" />
                <p className="text-xs text-gray-400">{t('sessionMainKeyHelp')}</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('fallbackModels')}</label>
                <input value={(config?.fallbackModels || []).join(", ")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, fallbackModels: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) }))}
                  className="input text-sm font-mono" placeholder="openai/gpt-5.2, google/gemini-3-pro-preview" />
                <p className="text-xs text-gray-400">{t('fallbackModelsHelp')}</p>
              </div>
            </div>
          </div>

          {/* Sandbox / Security */}
          <div id="cfg-sandbox" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('sandboxSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('sandboxDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('sandboxMode')}</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "off", label: "Off", desc: "Tools run on host" },
                    { value: "non-main", label: "Non-Main Only", desc: "Groups/channels sandboxed, DMs on host" },
                    { value: "all", label: "All Sessions", desc: "Everything sandboxed" },
                  ].map((opt) => (
                    <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, sandboxMode: opt.value }))}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.sandboxMode || "off") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                      title={opt.desc}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              {config?.sandboxMode && config.sandboxMode !== "off" && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('scope')}</label>
                    <div className="flex gap-2">
                      {[{ value: "session", label: "Per Session" }, { value: "agent", label: "Per Agent" }, { value: "shared", label: "Shared" }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, sandboxScope: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.sandboxScope || "session") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('workspaceAccess')}</label>
                    <div className="flex gap-2">
                      {[{ value: "none", label: "None" }, { value: "ro", label: "Read Only" }, { value: "rw", label: "Read/Write" }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, sandboxWorkspaceAccess: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.sandboxWorkspaceAccess || "none") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('network')}</label>
                    <div className="flex gap-2">
                      {[{ value: "none", label: "None (isolated)" }, { value: "bridge", label: "Bridge (internet)" }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, sandboxNetwork: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.sandboxNetwork || "none") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <Switch size="sm" checked={config?.sandboxBrowser ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, sandboxBrowser: v }))} label={t('sandboxBrowser')} />
                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground">{t('dockerAdvanced')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-gray-400">{t('customDockerImage')}</label>
                        <input value={config?.sandboxDockerImage || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, sandboxDockerImage: e.target.value }))} className="input text-xs font-mono" placeholder="default" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-400">{t('memoryLimit')}</label>
                        <input value={config?.sandboxMemory || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, sandboxMemory: e.target.value }))} className="input text-xs font-mono" placeholder="e.g. 1g, 512m" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-400">{t('cpuLimit')}</label>
                        <input type="number" step="0.5" min="0" value={config?.sandboxCpus || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, sandboxCpus: parseFloat(e.target.value) || 0 }))} className="input text-xs" placeholder="0 = unlimited" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-400">{t('pidLimit')}</label>
                        <input type="number" min="0" value={config?.sandboxPidsLimit || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, sandboxPidsLimit: parseInt(e.target.value) || 0 }))} className="input text-xs" placeholder="0 = unlimited" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">{t('setupCommand')}</label>
                      <textarea value={config?.sandboxSetupCommand || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, sandboxSetupCommand: e.target.value }))} className="input text-xs font-mono min-h-[60px]" placeholder="apt-get update && apt-get install -y python3" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-gray-400">{t('pruneIdle')}</label>
                        <input type="number" min="0" value={config?.sandboxPruneIdleHours || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, sandboxPruneIdleHours: parseInt(e.target.value) || 0 }))} className="input text-xs" placeholder="0 = never" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-400">{t('maxAge')}</label>
                        <input type="number" min="0" value={config?.sandboxMaxAgeDays || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, sandboxMaxAgeDays: parseInt(e.target.value) || 0 }))} className="input text-xs" placeholder="0 = no limit" />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Voice Calls */}
          <div id="cfg-voice" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('voiceCalls')}</h3>
              <p className="text-xs text-muted-foreground">{t('voiceCallsDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch checked={config?.voiceCallEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, voiceCallEnabled: v }))} label={config?.voiceCallEnabled ? t('enabled') : t('disabled')} />
              </div>
              {config?.voiceCallEnabled && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('provider')}</label>
                    <div className="flex gap-2">
                      {[{ value: "twilio", label: "Twilio" }, { value: "telnyx", label: "Telnyx" }, { value: "plivo", label: "Plivo" }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, voiceCallProvider: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.voiceCallProvider || "twilio") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  {config?.voiceCallProvider === "twilio" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">{t('accountSid')}</label>
                        <input type="password" value={config?.voiceCallTwilioSid || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, voiceCallTwilioSid: e.target.value }))}
                          className="input font-mono text-xs" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">{t('authToken')}</label>
                        <input type="password" value={config?.voiceCallTwilioToken || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, voiceCallTwilioToken: e.target.value }))}
                          className="input font-mono text-xs" placeholder="Auth token..." />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('fromNumber')}</label>
                    <input value={config?.voiceCallFrom || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, voiceCallFrom: e.target.value }))}
                      className="input text-sm" placeholder="+1555..." />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('inboundPolicy')}</label>
                    <div className="flex gap-2">
                      {[{ value: "notify", label: t('notifyOnly') }, { value: "conversation", label: t('fullConversation') }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, voiceCallInboundPolicy: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.voiceCallInboundPolicy || "notify") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('ttsProvider')}</label>
                    <div className="flex gap-2">
                      {[{ value: "openai", label: "OpenAI" }, { value: "elevenlabs", label: "ElevenLabs" }].map((opt) => (
                        <button key={opt.value} onClick={() => setConfig((prev: any) => ({ ...prev, voiceCallTtsProvider: opt.value }))}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.voiceCallTtsProvider || "openai") === opt.value ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Webhooks / Hooks */}
          <div id="cfg-hooks" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('webhooksHooks')}</h3>
              <p className="text-xs text-muted-foreground">{t('webhooksHooksDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch checked={config?.hooksEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, hooksEnabled: v }))} label={config?.hooksEnabled ? t('enabled') : t('disabled')} />
              </div>
              {config?.hooksEnabled && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('webhookToken')}</label>
                    <input type="password" value={config?.hooksToken || ""} onChange={(e) => setConfig((prev: any) => ({ ...prev, hooksToken: e.target.value }))}
                      className="input font-mono text-xs" placeholder="Shared secret for webhook auth..." />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('presets')}</label>
                    <div className="flex gap-2 flex-wrap">
                      {["session-memory", "gmail"].map((preset) => {
                        const active = (config?.hooksPresets || []).includes(preset);
                        return (
                          <button key={preset}
                            onClick={() => setConfig((prev: any) => ({
                              ...prev,
                              hooksPresets: active
                                ? (prev?.hooksPresets || []).filter((p: string) => p !== preset)
                                : [...(prev?.hooksPresets || []), preset],
                            }))}
                            className={`px-3 py-2 text-xs rounded-lg border transition-colors ${active ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                          >{preset}</button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-400">{t('presetsHelp')}</p>
                  </div>
                  <div className="box-inset">
                    <p className="text-xs text-muted-foreground font-mono">
                      POST {"{gateway}"}/hooks/wake — Wake agent<br/>
                      POST {"{gateway}"}/hooks/agent — Send message to agent<br/>
                      POST {"{gateway}"}/hooks/{"{name}"} — Custom webhook mapping
                    </p>
                  </div>
                  {/* Webhook Mappings CRUD */}
                  <div className="space-y-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">{t('webhookMappings')}</label>
                      <button onClick={() => setConfig((prev: any) => ({
                        ...prev,
                        hooksMappings: [...(prev?.hooksMappings || []), { name: '', matchPath: '', action: 'agent', deliver: false, channel: '', to: '', messageTemplate: '', sessionKey: '' }],
                      }))} className="text-xs text-gray-500 hover:text-foreground transition-colors">{t('addMapping')}</button>
                    </div>
                    {(config?.hooksMappings || []).map((mapping: any, idx: number) => (
                      <div key={idx} className="box p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Mapping {idx + 1}</span>
                          <button onClick={() => setConfig((prev: any) => ({
                            ...prev,
                            hooksMappings: (prev?.hooksMappings || []).filter((_: any, i: number) => i !== idx),
                          }))} className="text-xs text-red-500 hover:text-red-700">{tc('remove')}</button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <label className="text-xs text-gray-400">{t('pathMatch')}</label>
                            <input value={mapping.matchPath || ''} onChange={(e) => { const m = [...(config?.hooksMappings || [])]; m[idx] = { ...m[idx], matchPath: e.target.value }; setConfig((prev: any) => ({ ...prev, hooksMappings: m })); }} className="input text-xs font-mono" placeholder="gmail" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-gray-400">{t('action')}</label>
                            <select value={mapping.action || 'agent'} onChange={(e) => { const m = [...(config?.hooksMappings || [])]; m[idx] = { ...m[idx], action: e.target.value }; setConfig((prev: any) => ({ ...prev, hooksMappings: m })); }} className="input text-xs">
                              <option value="agent">Agent (send message)</option>
                              <option value="wake">Wake (start session)</option>
                              <option value="relay">Relay (forward payload)</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-gray-400">{t('sessionKey')}</label>
                            <input value={mapping.sessionKey || ''} onChange={(e) => { const m = [...(config?.hooksMappings || [])]; m[idx] = { ...m[idx], sessionKey: e.target.value }; setConfig((prev: any) => ({ ...prev, hooksMappings: m })); }} className="input text-xs font-mono" placeholder="hook:{{uuid}}" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-400">{t('messageTemplate')}</label>
                          <input value={mapping.messageTemplate || ''} onChange={(e) => { const m = [...(config?.hooksMappings || [])]; m[idx] = { ...m[idx], messageTemplate: e.target.value }; setConfig((prev: any) => ({ ...prev, hooksMappings: m })); }} className="input text-xs font-mono" placeholder="New email from {{from}}: {{subject}}" />
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch size="sm" checked={mapping.deliver ?? false} onChange={(v) => { const m = [...(config?.hooksMappings || [])]; m[idx] = { ...m[idx], deliver: v }; setConfig((prev: any) => ({ ...prev, hooksMappings: m })); }} label={t('deliverToChannel')} />
                          {mapping.deliver && (
                            <>
                              <input value={mapping.channel || ''} onChange={(e) => { const m = [...(config?.hooksMappings || [])]; m[idx] = { ...m[idx], channel: e.target.value }; setConfig((prev: any) => ({ ...prev, hooksMappings: m })); }} className="input text-xs w-24" placeholder="telegram" />
                              <input value={mapping.to || ''} onChange={(e) => { const m = [...(config?.hooksMappings || [])]; m[idx] = { ...m[idx], to: e.target.value }; setConfig((prev: any) => ({ ...prev, hooksMappings: m })); }} className="input text-xs w-32" placeholder="tg:123456" />
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Gmail Integration */}
                  {(config?.hooksPresets || []).includes('gmail') && (
                    <div className="space-y-3 pt-3 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground">{t('gmailIntegration')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-gray-400">{t('gmailAccount')}</label>
                          <input type="email" value={config?.gmailAccount || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, gmailAccount: e.target.value }))} className="input text-xs" placeholder="agent@gmail.com" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-400">{t('maxBodyBytes')}</label>
                          <input type="number" value={config?.gmailMaxBytes || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, gmailMaxBytes: parseInt(e.target.value) || 0 }))} className="input text-xs" placeholder="0 = unlimited" />
                        </div>
                      </div>
                      <Switch size="sm" checked={config?.gmailIncludeBody ?? true} onChange={(v) => setConfig((prev: any) => ({ ...prev, gmailIncludeBody: v }))} label={t('includeEmailBody')} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* OpenAI API Access */}
          <div id="cfg-api" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('apiAccess')}</h3>
              <p className="text-xs text-muted-foreground">{t('apiAccessDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch checked={config?.apiEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, apiEnabled: v }))} label={config?.apiEnabled ? t('enabled') : t('disabled')} />
              </div>
              {config?.apiEnabled && (
                <>
                  <div className="box-inset">
                    <p className="text-xs text-muted-foreground font-mono mb-2">
                      POST {"{gateway}"}:18789/v1/chat/completions
                    </p>
                    <p className="text-xs text-gray-400">
                      {t('apiHelp')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <Switch checked={config?.responsesApiEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, responsesApiEnabled: v }))} label={`${t('responsesApi')} ${config?.responsesApiEnabled ? `(${t('enabled').toLowerCase()})` : `(${t('disabled').toLowerCase()})`}`} />
                  </div>
                  {config?.responsesApiEnabled && (
                    <div className="p-3 bg-secondary border border-border rounded-lg mt-2">
                      <p className="text-xs text-muted-foreground font-mono">
                        POST {"{gateway}"}:18789/v1/responses
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Lobster Workflows */}
          <div className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('lobsterWorkflows')}</h3>
              <p className="text-xs text-muted-foreground">{t('lobsterWorkflowsDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch checked={config?.lobsterEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, lobsterEnabled: v }))} label={config?.lobsterEnabled ? t('enabled') : t('disabled')} />
              </div>
              {config?.lobsterEnabled && (
                <div className="box-inset">
                  <p className="text-xs text-gray-400">
                    Create and manage flows in the Workspace sidebar under <span className="font-mono">Flows</span>. Lobster supports YAML workflow definitions with step sequencing, approval gates, and conditional execution.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Granular Tool Control */}
          <div id="cfg-tools" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('toolAccessControl')}</h3>
              <p className="text-xs text-muted-foreground">{t('toolAccessControlDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('allowedToolGroups')}</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { group: "group:runtime", label: "Runtime (exec, bash)" },
                    { group: "group:fs", label: "Files (read, write, edit)" },
                    { group: "group:sessions", label: "Sessions" },
                    { group: "group:memory", label: "Memory" },
                    { group: "group:web", label: "Web (search, fetch)" },
                    { group: "group:ui", label: "UI (browser, canvas)" },
                    { group: "group:automation", label: "Automation (cron)" },
                    { group: "group:messaging", label: "Messaging" },
                  ].map(({ group, label }) => {
                    const allowed = (config?.toolAllow || []).includes(group);
                    return (
                      <button key={group}
                        onClick={() => {
                          setConfig((prev: any) => {
                            const current = prev?.toolAllow || [];
                            return {
                              ...prev,
                              toolAllow: allowed ? current.filter((g: string) => g !== group) : [...current, group],
                            };
                          });
                        }}
                        className={`px-3 py-2 text-xs rounded-lg border transition-colors text-left ${allowed ? "bg-foreground text-primary-foreground border-black dark:border-foreground" : "border-border hover:border-gray-400"}`}
                      >{label}</button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400">{t('toolGroupHelp')}</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('deniedTools')}</label>
                <input value={(config?.toolDeny || []).join(", ")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, toolDeny: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) }))}
                  className="input text-sm font-mono" placeholder="exec, bash, process" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('alsoAllow')}</label>
                <input value={(config?.toolAlsoAllow || []).join(", ")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, toolAlsoAllow: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) }))}
                  className="input text-sm font-mono" placeholder="web_search, browser" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('maxMediaUpload')}</label>
                <input type="number" min="0" value={config?.toolMediaMaxSize || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, toolMediaMaxSize: parseInt(e.target.value) || 0 }))} className="input w-32 text-sm" placeholder="Auto" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">{t('subAgentAllow')}</label>
                  <input value={(config?.toolSubagentAllow || []).join(", ")}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, toolSubagentAllow: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) }))}
                    className="input text-xs font-mono" placeholder="web_search, memory_search" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">{t('subAgentDeny')}</label>
                  <input value={(config?.toolSubagentDeny || []).join(", ")}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, toolSubagentDeny: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) }))}
                    className="input text-xs font-mono" placeholder="exec, bash, cron" />
                </div>
              </div>
            </div>
          </div>

          {/* Memory Advanced */}
          <div id="cfg-memory" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('memoryAdvanced')}</h3>
              <p className="text-xs text-muted-foreground">{t('memoryAdvancedDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('extraSearchPaths')}</label>
                <input value={(config?.memorySearchExtraPaths || []).join(', ')}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, memorySearchExtraPaths: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) }))}
                  className="input text-xs font-mono" placeholder="/extra/memory/dir, /shared/notes" />
                <p className="text-xs text-gray-400">{t('extraSearchPathsHelp')}</p>
              </div>
              <Switch size="sm" checked={config?.memorySearchBatchEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, memorySearchBatchEnabled: v }))} label={t('batchEmbedding')} />
            </div>
          </div>

          {/* Logging */}
          <div className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('loggingSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('loggingDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {(['silent', 'error', 'warn', 'info', 'debug'] as const).map(level => (
                  <button key={level} onClick={() => setConfig((prev: any) => ({ ...prev, loggingLevel: level }))}
                    className={`px-3 py-2 text-xs rounded-lg border transition-colors ${(config?.loggingLevel || 'info') === level ? 'bg-foreground text-primary-foreground border-black dark:border-foreground' : 'border-border hover:border-gray-400'}`}
                  >{level}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Browser */}
          <div id="cfg-browser" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('browserSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('browserDesc')}</p>
            </div>
            <div className="space-y-4">
              <Switch checked={config?.browserEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, browserEnabled: v }))} label={config?.browserEnabled ? t('browserToolEnabled') : t('browserToolDisabled')} />
              {config?.browserEnabled && (
                <>
                  <Switch size="sm" checked={config?.browserProfilesEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, browserProfilesEnabled: v }))} label={t('browserProfiles')} />
                  {config?.browserProfilesEnabled && (
                    <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-3">
                      <p className="text-xs text-green-300">Persistent sessions enabled — your agent will stay logged into websites between tasks. Add login credentials via the agent&apos;s workspace AGENTS.md to automate authenticated workflows.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* TTS */}
          <div id="cfg-tts" className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('ttsSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('ttsDesc')}</p>
            </div>
            <div className="space-y-4">
              <Switch checked={config?.ttsEnabled ?? false} onChange={(v) => setConfig((prev: any) => ({ ...prev, ttsEnabled: v }))} label={config?.ttsEnabled ? t('ttsEnabled') : t('ttsDisabled')} />
              {config?.ttsEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">{t('ttsProvider')}</label>
                    <select value={config?.ttsProvider || 'openai'} onChange={(e) => setConfig((prev: any) => ({ ...prev, ttsProvider: e.target.value }))} className="input text-xs">
                      <option value="openai">OpenAI</option>
                      <option value="elevenlabs">ElevenLabs</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">{t('voice')}</label>
                    <input value={config?.ttsVoice || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, ttsVoice: e.target.value }))}
                      className="input text-xs" placeholder="alloy, echo, shimmer..." />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Image Model */}
          <div className="card space-y-6">
            <div>
              <h3 className="section-header mb-1">{t('imageGen')}</h3>
              <p className="text-xs text-muted-foreground">{t('imageGenDesc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('imageModel')}</label>
                <input value={config?.imageModel || ''} onChange={(e) => setConfig((prev: any) => ({ ...prev, imageModel: e.target.value }))}
                  className="input text-sm font-mono" placeholder="openai/dall-e-3" />
                <p className="text-xs text-gray-400">{t('imageModelHelp')}</p>
              </div>
            </div>
          </div>

          </>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary-sm px-4 disabled:opacity-50"
            >
              {isSaving ? tc('saving') : t('saveConfig')}
            </button>
            <button
              onClick={async () => {
                const token = await getToken();
                if (!token) return;
                const data = await apiClient.getAgentConfiguration(token, agentId);
                setConfig(data.configuration || {});
                showToast(t('configReset'), "info");
              }}
              className="btn-ghost-sm px-4"
            >
              {t('resetBtn')}
            </button>
          </div>
        </div>
    </>
  );
}
