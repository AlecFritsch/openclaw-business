"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { showToast } from "@/components/toast";
import { Navbar } from "@/components/navbar";
import { BuilderChatView } from "@/components/builder/builder-chat-view";
import { ChannelIcon } from "@/components/channel-icon";
import { apiClient } from "@/lib/api-client";
import { PROVIDER_CATALOG, type AIProviderType, type CreateAgentRequest, type CreateMissionRequest } from "@openclaw-business/shared";
import { ProviderIcon } from "@/components/provider-icon";
import { useTranslations } from 'next-intl';
import { Plug, Clock } from 'lucide-react';
import { getMcpIconUrl, getToolIconUrl, extractToolsFromText } from "@/lib/mcp-icon";

function parseInterval(s: string): number {
  const match = s.match(/^(\d+)\s*(m|min|h|hr|s|sec)?$/i);
  if (!match) return 30 * 60 * 1000;
  const val = parseInt(match[1], 10);
  const unit = (match[2] || 'm').toLowerCase();
  if (unit.startsWith('h')) return val * 3600 * 1000;
  if (unit.startsWith('s')) return val * 1000;
  return val * 60 * 1000;
}

/** Convert cron/interval to human-readable text (e.g. "0 8 * * *" → "Täglich um 8:00") */
function formatScheduleDisplay(
  t: (key: string, vars?: Record<string, string | number>) => string,
  schedule?: string,
  every?: string,
  tz?: string
): string {
  const tzSuffix = tz ? ` (${tz})` : '';
  if (every) {
    const m = every.match(/^(\d+)\s*(m|min|h|hr)?$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const u = (m[2] || 'm').toLowerCase();
      if (u.startsWith('h')) return t('scheduleEveryHours', { count: n }) + tzSuffix;
      if (u.startsWith('m')) return t('scheduleEveryMinutes', { count: n }) + tzSuffix;
    }
    return t('scheduleEvery', { interval: every }) + tzSuffix;
  }
  if (schedule) {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length >= 5) {
      const [, hour, , , dow] = parts;
      const h = parseInt(hour, 10);
      if (dow === '*') return t('scheduleDailyAt', { hour: h }) + tzSuffix;
      if (dow === '1-5') return t('scheduleWeekdaysAt', { hour: h }) + tzSuffix;
      if (dow === '5') return t('scheduleFridayAt', { hour: h }) + tzSuffix;
      if (dow === '0') return t('scheduleSundayAt', { hour: h }) + tzSuffix;
    }
  }
  return (schedule || '') + tzSuffix;
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
  toolSteps?: { tool: string; query?: string; category?: string }[];
  config?: AgentConfig; // Store config snapshot per message
}

interface McpConnection {
  mcpUrl: string;
  mcpName: string;
  iconUrl?: string;
}

interface MissionTriggerConfig {
  id: string;
  schedule?: string;
  every?: string;
  tz?: string;
}

interface Mission {
  type?: 'cron' | 'reactive' | 'heartbeat';
  name?: string;
  schedule?: string;
  every?: string;
  trigger?: string;
  instruction: string;
  /** One mission per use case with multiple triggers */
  triggers?: MissionTriggerConfig[];
}

interface AgentConfig {
  name: string;
  description: string;
  useCase: string;
  model: string;
  systemPrompt: string;
  channels: string[];
  skills: string[];
  suggestedTemplate?: string | null;
  suggestMcpConnections?: McpConnection[];
  missions?: Mission[];
}

function AgentBuilderContent() {
  const t = useTranslations('builder');
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const useCaseFromOnboarding = searchParams.get("useCase") || "";

  const [step, setStep] = useState<"chat" | "preview" | "deploy">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [typingStatus, setTypingStatus] = useState<string>(t('thinking'));
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(0);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [displayNum, setDisplayNum] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>('google/gemini-3-flash-preview');
  const [previewPage, setPreviewPage] = useState<1 | 2>(1);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Smooth spring-animated counter
  const motionProgress = useMotionValue(0);
  const springProgress = useSpring(motionProgress, { stiffness: 60, damping: 18 });

  useEffect(() => {
    motionProgress.set(deployProgress);
  }, [deployProgress, motionProgress]);

  useEffect(() => {
    const unsubscribe = springProgress.on("change", v => {
      setDisplayNum(Math.round(v));
    });
    return unsubscribe;
  }, [springProgress]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Fetch available models + skills on mount
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const { models } = await apiClient.getAvailableModels(token);
        setAvailableModels(models);
      } catch {
        setAvailableModels([]);
      }
    })();
  }, []);

  const useCaseLabels: Record<string, string> = {
    'customer-support': t('useCaseCustomerSupport'),
    'sales': t('useCaseSales'),
    'internal-tools': t('useCaseInternalTools'),
    'research': t('useCaseResearch'),
  };

  const handleSend = async (text: string) => {
    const content = text.trim();
    if (!content || isTyping) return;

    const userMessage: ChatMessage = { role: "user", content };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsTyping(true);
    
    // Detect mode: if user mentions building/creating/automation, use architect labels
    const isArchitectMode = /\b(bau|erstell|agent|automat|deploy|konfig|build|create|design)\b/i.test(content);
    
    let statusTimers: NodeJS.Timeout[] = [];
    
    if (isArchitectMode) {
      setTypingStatus(t('analyzing'));
      // Progressive status updates for architect mode
      statusTimers = [
        setTimeout(() => setTypingStatus(t('researching')), 2500),
        setTimeout(() => setTypingStatus(t('checkingTemplates')), 5500),
        setTimeout(() => setTypingStatus(t('preparing')), 8000),
      ];
    } else {
      // Chat mode: simple status
      setTypingStatus(t('thinking'));
    }

    abortControllerRef.current = new AbortController();
    try {
      // Force-refresh the token — the AI call can take 10-20s, so a cached token
      // might expire mid-flight and cause a spurious 401 → redirect.
      const token = await getToken({ skipCache: true });
      if (!token) throw new Error("Not authenticated");

      // Send full conversation history to the AI architect
      const result = await apiClient.agentArchitect(token, updatedMessages.map(m => ({
        role: m.role,
        content: m.content,
      })), selectedModel, content, abortControllerRef.current.signal);

      statusTimers.forEach(t => clearTimeout(t));

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.message,
        toolSteps: result.toolSteps,
        config: result.config ? {
          name: result.config.name || "New Agent",
          description: result.config.description || "",
          useCase: result.config.useCase || "general",
          model: result.config.model || availableModels[0] || "",
          systemPrompt: result.config.systemPrompt || "",
          channels: result.config.channels || [],
          skills: result.config.skills || [],
          suggestedTemplate: result.config.suggestedTemplate || null,
          suggestMcpConnections: result.config.suggestMcpConnections || [],
          missions: result.config.missions || [],
        } : undefined,
      };
      setMessages(prev => [...prev, assistantMessage]);

      // If AI extracted a config, update it and auto-open modal on first generation
      if (result.config) {
        const config: AgentConfig = {
          name: result.config.name || "New Agent",
          description: result.config.description || "",
          useCase: result.config.useCase || "general",
          model: result.config.model || availableModels[0] || "",
          systemPrompt: result.config.systemPrompt || "",
          channels: result.config.channels || [],
          skills: result.config.skills || [],
          suggestedTemplate: result.config.suggestedTemplate || null,
          suggestMcpConnections: result.config.suggestMcpConnections || [],
          missions: result.config.missions || [],
        };
        const isFirstConfig = !agentConfig;
        setAgentConfig(config);
        if (config.missions?.length) {
        }
        if (isFirstConfig) {
          setStep("preview");
          setPreviewPage(1);
        }
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return; // User clicked Stop
      const errorMsg = err instanceof Error ? err.message : "Failed to get AI response";
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Sorry, I encountered an error: ${errorMsg}. Please try again.`,
      }]);
    } finally {
      statusTimers.forEach(t => clearTimeout(t));
      setIsTyping(false);
    }
  };

  const handleAbort = () => {
    abortControllerRef.current?.abort();
  };

  const handleDeploy = async () => {
    if (!agentConfig) return;
    setStep("deploy");
    setIsDeploying(true);
    setDeployProgress(0);

    try {
      const token = await getToken();
      if (!token) throw new Error("No auth token");

      // Step 1: Apply Architect config (creates agent + deploys)
      setDeployProgress(10);
      const result = await apiClient.applyArchitectConfig(token, {
        name: agentConfig.name,
        description: agentConfig.description,
        useCase: agentConfig.useCase,
        model: agentConfig.model,
        systemPrompt: agentConfig.systemPrompt,
        skills: agentConfig.skills,
        channels: agentConfig.channels,
        ...(agentConfig.missions?.length ? { missions: agentConfig.missions } : {}),
        ...(agentConfig.suggestMcpConnections?.length ? { suggestMcpConnections: agentConfig.suggestMcpConnections } : {}),
      } as CreateAgentRequest);

      const agentId = String(result.agent._id);
      setDeployProgress(25);

      // Step 2: Poll for real deployment status
      // OpenClaw containers can take up to 2 minutes to become healthy
      const maxPolls = 80; // 80 * 2s = 160s max wait
      let polls = 0;

      const pollStatus = (): Promise<string> => {
        return new Promise((resolve, reject) => {
          const interval = setInterval(async () => {
            polls++;
            try {
              const freshToken = await getToken({ skipCache: true });
              if (!freshToken) { clearInterval(interval); reject(new Error('Auth lost')); return; }
              const { agent } = await apiClient.getAgent(freshToken, agentId);

              // Update progress based on real status
              if (agent.status === 'deploying') {
                // Gradually increase progress while deploying (cap at 90%)
                setDeployProgress(Math.min(25 + Math.floor((polls / maxPolls) * 65), 90));
              } else if (agent.status === 'running') {
                // DB says running — verify gateway is actually healthy before redirecting
                // (recover logic can set running when container starts, before gateway is ready)
                clearInterval(interval);
                pollIntervalRef.current = null;
                setDeployProgress(95);
                let gatewayHealthy = false;
                for (let h = 0; h < 10; h++) {
                  try {
                    const { health } = await apiClient.getGatewayHealth(freshToken, agentId);
                    if (health?.status === 'ok' || health?.status === 'running') {
                      gatewayHealthy = true;
                      break;
                    }
                  } catch {
                    // ignore
                  }
                  await new Promise(r => setTimeout(r, 1500));
                }
                setDeployProgress(100);
                resolve(gatewayHealthy ? 'running' : 'gateway_not_ready');
              } else if (agent.status === 'error') {
                clearInterval(interval);
                pollIntervalRef.current = null;
                reject(new Error(agent.errorMessage || 'Deployment failed'));
              }

              if (polls >= maxPolls) {
                clearInterval(interval);
                pollIntervalRef.current = null;
                resolve('timeout');
              }
            } catch {
              // Network error during poll — keep trying
              if (polls >= maxPolls) {
                clearInterval(interval);
                pollIntervalRef.current = null;
                resolve('timeout');
              }
            }
          }, 2000);
          
          pollIntervalRef.current = interval;
        });
      };

      const finalStatus = await pollStatus();

      if (finalStatus === 'gateway_not_ready') {
        showToast(t('deployGatewayStarting'), 'info');
      }

      if (finalStatus === 'running' || finalStatus === 'gateway_not_ready') {
        setDeployProgress(100);

        // Create missions (one per use case = one mission with triggers)
        const missionsToCreate = agentConfig.missions || [];
        if (missionsToCreate.length > 0) {
          const freshToken = await getToken({ skipCache: true });
          if (freshToken) {
            const missionResults = await Promise.allSettled(missionsToCreate.map((m: Mission) => {
              if (m.triggers && m.triggers.length > 0) {
                return apiClient.createMission(freshToken, agentId, {
                  name: m.name || m.instruction.slice(0, 60),
                  description: m.instruction,
                  prompt: m.instruction,
                  triggers: m.triggers,
                } as unknown as CreateMissionRequest);
              }
              const trigger = m.type === 'cron'
                ? { type: m.schedule ? 'schedule' as const : 'interval' as const, config: m.schedule ? { expr: m.schedule } : { everyMs: parseInterval(m.every || '30m') } }
                : m.type === 'reactive'
                  ? { type: 'channel_message' as const, config: m.trigger ? { channel: m.trigger } : {} }
                  : { type: 'manual' as const, config: {} };
              return apiClient.createMission(freshToken, agentId, {
                name: m.name || m.instruction.slice(0, 60),
                description: m.instruction,
                trigger,
                prompt: m.instruction,
              });
            }));
            const failedCount = missionResults.filter((r): r is PromiseRejectedResult => r.status === "rejected").length;
            if (failedCount > 0) {
              showToast(t("deployMissionsPartial", { count: failedCount }), "info");
            }
          }
        }

        await new Promise(r => setTimeout(r, 1000));
        showToast(finalStatus === 'gateway_not_ready' ? t('deployGatewayStarting') : t('deploySuccess'), finalStatus === 'gateway_not_ready' ? 'info' : 'success');
        window.location.replace(`/agents/${agentId}`);
      } else if (finalStatus === 'timeout') {
        // Stay on deploy page — don't redirect to a broken agent page
        setIsDeploying(false);
        showToast(t('deployTimeout'), "error");
        setStep("chat");
      }
    } catch (error) {
      setIsDeploying(false);
      setDeployProgress(0);
      showToast(error instanceof Error ? error.message : t('deployFailed'), "error");
      setStep("chat");
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background p-1 md:p-2">
      <div className="flex-1 flex flex-col min-h-0 rounded-xl shadow-[0_2px_12px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.25)] border border-gray-200/30 dark:border-border/30 overflow-hidden bg-card">
        <Navbar embedded />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {step === "deploy" ? (
        <motion.div
          key="deploy"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          <div className="flex-1 flex justify-center min-h-0 min-w-0 px-4 sm:px-6 overflow-auto py-8">
            <div className="w-full max-w-[42rem] flex flex-col justify-center">
              {/* Compact header */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-xs text-muted-foreground uppercase tracking-wider mb-2"
              >
                {t('deployingName', { name: agentConfig?.name ?? 'Agent' })}
              </motion.p>
              {/* Percentage + progress */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="flex items-baseline gap-2 mb-6"
              >
                <span className="text-4xl font-mono font-medium tabular-nums text-foreground">{displayNum}</span>
                <span className="text-xl font-mono text-muted-foreground">%</span>
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="h-1 bg-border rounded-full overflow-hidden mb-8"
              >
                <motion.div
                  animate={{ width: `${deployProgress}%` }}
                  transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.8 }}
                  className="h-full bg-foreground rounded-full"
                />
              </motion.div>
              {/* Steps */}
              <div className="space-y-3">
                {[t('configSaved'), t('containerProvisioned'), t('instanceStarting'), t('healthChecks')].map((label, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.4 + i * 0.05 }}
                    className="flex items-center gap-3 text-sm"
                  >
                    <div className="w-4 h-4 flex items-center justify-center shrink-0">
                      <AnimatePresence mode="wait">
                        {deployProgress >= (i + 1) * 25 ? (
                          <motion.span
                            key="check"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            transition={{ type: "spring", stiffness: 400, damping: 18 }}
                            className="text-foreground"
                          >
                            ✓
                          </motion.span>
                        ) : deployProgress >= i * 25 ? (
                          <motion.div
                            key="spinner"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="w-3 h-3 rounded-full border-2 border-foreground/30 border-t-foreground animate-spin"
                          />
                        ) : (
                          <span key="empty" className="text-muted-foreground">○</span>
                        )}
                      </AnimatePresence>
                    </div>
                    <span className={deployProgress >= i * 25 ? "text-foreground" : "text-muted-foreground"}>
                      {label}
                    </span>
                  </motion.div>
                ))}
              </div>
              {displayNum >= 100 && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="mt-6 text-sm text-muted-foreground"
                >
                  {t('deploySuccess')}
                </motion.p>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Main row: Chat + optional Config Panel — centered block */}
        <div className="flex-1 flex justify-center min-h-0 min-w-0 px-4 sm:px-6 overflow-hidden">
          <div className="flex w-full max-w-5xl mx-auto min-h-0 min-w-0">
          {/* Chat Panel — scrolls independently */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <BuilderChatView
              messages={messages}
              setMessages={setMessages}
              isTyping={isTyping}
              typingStatus={typingStatus}
              onSend={handleSend}
              onAbort={handleAbort}
              welcomeTitle={t('welcomeTitle')}
              welcomeSubtitle={useCaseFromOnboarding ? `${t('welcome')}\n\n${t('useCaseContext', { useCase: useCaseLabels[useCaseFromOnboarding] ?? useCaseFromOnboarding })}` : t('welcome')}
              placeholder={t('placeholder')}
              sendLabel={t('send')}
              searchedLabel={(q) => t('searched', { query: q })}
              templatesLabel={(c) => t('templates', { category: c })}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              availableModels={availableModels}
              hasConfig={!!agentConfig}
              onOpenConfig={(config) => {
                if (config) setAgentConfig(config); // Load snapshot
                setPreviewPage(1);
                setStep("preview");
              }}
            />
          </div>

          {/* Config Panel (visible when config exists during chat) - HIDDEN, only modal now */}
          </div>
        </div>

        {/* Deploy Bar - HIDDEN, only modal now */}
      </div>
      )}

        {/* Preview Modal */}
        <AnimatePresence>
          {step === "preview" && agentConfig && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setStep("chat")}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              />
              
              {/* Modal - Appshell Style */}
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
              >
                <div className="w-full max-w-4xl h-[90vh] flex flex-col bg-background rounded-xl shadow-[0_2px_12px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.25)] border border-gray-200/30 dark:border-border/30 overflow-hidden">
                  {/* Header */}
                  <div className="shrink-0 px-6 py-3.5 border-b border-border flex items-center justify-between">
                    <h2 className="text-sm font-medium">{previewPage === 2 ? 'Missions' : t('editConfig')}</h2>
                    <button onClick={() => setStep("chat")} className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="p-4 space-y-2.5 flex-1 flex flex-col min-h-0 overflow-y-auto">
                      {previewPage === 1 ? (<>
                      {/* Step 1: Config + Channels + Integrations */}

                      {/* Agent Name */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('agentName')}</label>
                        <div className="p-2 bg-muted/30 rounded border border-border">
                          <p className="text-xs">{agentConfig.name}</p>
                        </div>
                      </div>

                      {/* Use Case */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('useCase')}</label>
                        <div className="p-2 bg-muted/30 rounded border border-border">
                          <p className="text-xs capitalize">{agentConfig.useCase}</p>
                        </div>
                      </div>

                      {/* Model */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('model')}</label>
                        <div className="p-2 bg-muted/30 rounded border border-border">
                          <div className="text-xs flex items-center gap-1.5">
                            <ProviderIcon provider={agentConfig.model.split("/")[0]} size={12} />
                            <span>{(() => {
                              const pk = agentConfig.model.split("/")[0] as AIProviderType;
                              const cat = PROVIDER_CATALOG[pk];
                              return cat?.models.find(cm => cm.id === agentConfig.model)?.name || agentConfig.model.split("/")[1] || agentConfig.model;
                            })()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('description')}</label>
                        <div className="p-2 bg-muted/30 rounded border border-border">
                          <p className="text-xs">{agentConfig.description || "—"}</p>
                        </div>
                      </div>

                      {/* System Prompt */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('systemPrompt')}</label>
                        <div className="p-2 bg-muted/30 rounded border border-border max-h-40 overflow-y-auto">
                          <p className="text-xs leading-relaxed whitespace-pre-wrap">{agentConfig.systemPrompt}</p>
                        </div>
                      </div>

                      {/* Channels */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('setupChannels')}</label>
                        <div className="p-2 bg-muted/30 rounded border border-border">
                          {agentConfig.channels && agentConfig.channels.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {agentConfig.channels.map((channel, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-background rounded border border-border">
                                  <ChannelIcon channel={channel} size={12} />
                                  <span className="capitalize">{channel}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">{t('webChatOnly')}</p>
                          )}
                        </div>
                      </div>

                      {/* Integrations */}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('setupIntegrations')}</label>
                        <div className="p-2 bg-muted/30 rounded border border-border">
                          {agentConfig.suggestMcpConnections && agentConfig.suggestMcpConnections.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {agentConfig.suggestMcpConnections.map((mcp, i) => {
                                const iconUrl = getMcpIconUrl(mcp);
                                return (
                                  <div key={i} className="flex items-center gap-1.5 text-xs px-2 py-1 bg-background rounded border border-border">
                                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded overflow-hidden bg-muted/30">
                                      {iconUrl ? (
                                        <img src={iconUrl} alt="" className="size-3.5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                      ) : (
                                        <Plug size={14} className="text-muted-foreground" />
                                      )}
                                    </span>
                                    <span>{mcp.mcpName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">{t('noIntegrations')}</p>
                          )}
                        </div>
                      </div>

                      </>) : (<>
                      {/* Step 2: Missions */}
                      <div>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                          {t('missionsPreviewDescription')}
                        </p>
                        <div className="space-y-3">
                          {(agentConfig.missions || []).map((mission, i) => {
                            const hasTriggers = mission.triggers && mission.triggers.length > 0;
                            const toolsFromInstruction = extractToolsFromText(mission.instruction).slice(0, 3);
                            const triggerSections = hasTriggers && mission.triggers
                              ? mission.triggers.map(t => {
                                  const re = new RegExp(`\\[TRIGGER:\\s*${t.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\[TRIGGER:|$)`, 'i');
                                  const m = mission.instruction.match(re);
                                  const block = m ? m[1].trim() : '';
                                  const steps = block.split(/\n/).map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
                                  return { ...t, steps };
                                })
                              : [{
                                  id: 'default',
                                  schedule: mission.schedule,
                                  every: mission.every,
                                  steps: mission.instruction.split(/\n/).map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean),
                                }];
                            return (
                              <div key={i} className="rounded-xl border border-border/80 bg-muted/20">
                                <div className="flex items-center gap-2.5 px-3 py-2.5">
                                  <span className="text-xs font-medium flex-1 min-w-0 truncate">{mission.name || 'Mission'}</span>
                                  <span className="flex items-center gap-1.5 shrink-0">
                                    <Clock size={12} className="text-muted-foreground shrink-0" aria-label="Scheduled" />
                                    {toolsFromInstruction.length > 0 && (
                                      <span className="w-px h-4 bg-border/60 shrink-0 self-center" aria-hidden />
                                    )}
                                    {toolsFromInstruction.map((tool) => {
                                      const iconUrl = getToolIconUrl(tool);
                                      return iconUrl ? (
                                        <span key={tool} className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm overflow-hidden bg-muted/30" title={tool}>
                                          <img src={iconUrl} alt={tool} className="size-3.5 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                        </span>
                                      ) : null;
                                    })}
                                  </span>
                                </div>
                                {triggerSections.map((section) => (
                                  <div key={section.id} className="px-3 pb-2.5 pt-0">
                                    <div className="border-t border-border/50 pt-2 space-y-1.5">
                                      {(section.schedule || section.every) && (
                                        <p className="text-xs text-muted-foreground mb-1">
                                          {formatScheduleDisplay(t, section.schedule, section.every, section.tz)}
                                        </p>
                                      )}
                                      {section.steps.map((step, si) => (
                                        <div key={si} className="flex items-start gap-2">
                                          <span className="text-xs text-muted-foreground font-mono w-3 shrink-0 text-right pt-px">{si + 1}</span>
                                          <span className="text-xs text-foreground/80 leading-snug">{step}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      </>)}
                    </div>
                  </div>

                  {/* Footer */}
                  {(() => {
                    const hasMissions = (agentConfig.missions?.length ?? 0) > 0;
                    return (
                    <div className="shrink-0 px-6 py-3.5 border-t border-border flex items-center gap-2.5">
                      {hasMissions && <span className="text-xs text-muted-foreground">{previewPage}/2</span>}
                      <button onClick={() => previewPage === 1 ? setStep("chat") : setPreviewPage(1)} className="btn-ghost-sm px-4 flex-1">
                        {previewPage === 1 ? t('backToChat') : t('back')}
                      </button>
                      {previewPage === 1 && hasMissions ? (
                        <button onClick={() => setPreviewPage(2)} className="btn-primary-sm px-4 flex-1">{t('next')}</button>
                      ) : (
                        <button onClick={handleDeploy} disabled={!agentConfig.systemPrompt || agentConfig.systemPrompt.trim().length < 30} className="btn-primary-sm px-4 flex-1 disabled:opacity-40 disabled:cursor-not-allowed">{t('deployAgent')}</button>
                      )}
                    </div>
                    );
                  })()}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        </main>
      </div>
    </div>
  );
}

export default function AgentBuilderPage() {
  const t = useTranslations('builder');
  return (
    <Suspense fallback={
      <div className="h-screen flex flex-col bg-background p-1 md:p-2">
        <div className="flex-1 flex flex-col min-h-0 rounded-xl shadow-[0_2px_12px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.25)] border border-gray-200/30 dark:border-border/30 overflow-hidden bg-card">
          <Navbar embedded />
          <div className="flex-1 flex items-center justify-center"><div className="text-sm text-gray-400">{t('loading')}</div></div>
        </div>
      </div>
    }>
      <AgentBuilderContent />
    </Suspense>
  );
}
