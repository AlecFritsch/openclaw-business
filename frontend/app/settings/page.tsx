"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useSearchParams, useRouter } from "next/navigation";
import { useNextStep } from 'nextstepjs';
import { useTranslations } from 'next-intl';
import { showToast } from "@/components/toast";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";
import { PROVIDER_CATALOG, type AIProviderType } from "@openclaw-business/shared";
import { ProviderIcon } from "@/components/provider-icon";
import dynamic from "next/dynamic";

const AuditTrail = dynamic(
  () => import("@/components/audit-trail").then((m) => ({ default: m.AuditTrail })),
  { ssr: false, loading: () => <div className="py-8 flex justify-center"><div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" /></div> }
);
import { Eye, EyeOff, Box, RotateCcw } from "lucide-react";


export default function SettingsPage() {
  return (
    <Suspense fallback={<AppShell embedded><div className="flex items-center justify-center py-20"><div className="w-5 h-5 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" /></div></AppShell>}>
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsPageContent() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const toast = useTranslations('toasts');
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const isOnboarding = searchParams.get("onboarding") === "1";
  const [activeTab, setActiveTab] = useState<"providers" | "general" | "api" | "audit">(
    (tabParam === "providers" || tabParam === "general" || tabParam === "api" || tabParam === "audit")
      ? tabParam
      : "general"
  );
  const [showNewKey, setShowNewKey] = useState(false);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [keyName, setKeyName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const router = useRouter();
  const { startNextStep } = useNextStep();

  // Provider modal state
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState<AIProviderType | null>(null);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Tool API keys state (org-level, for agent web_search etc.)
  const [braveApiKey, setBraveApiKey] = useState("");
  const [hasBraveApiKey, setHasBraveApiKey] = useState(false);
  const [showBraveKey, setShowBraveKey] = useState(false);
  const [isSavingToolKeys, setIsSavingToolKeys] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const [userData, keysData, providersData, orgData] = await Promise.all([
        apiClient.getCurrentUser(token),
        apiClient.getApiKeys(token),
        apiClient.getProviders(token).catch(() => ({ providers: [] })),
        apiClient.getOrganization(token).catch(() => ({ organization: null })),
      ]);

      const u = userData.user as any;
      setUser(u);
      setEmail(u?.email || '');
      const org = orgData?.organization as any;
      setCompanyName(org?.name || u?.companyName || '');
      setApiKeys(keysData.apiKeys);
      setProviders(providersData.providers || []);

      // Tool API keys status (encrypted on backend, we only get boolean flags)
      if (org?.toolApiKeys) {
        setHasBraveApiKey(!!org.toolApiKeys.hasBraveApiKey);
      }
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddProvider = async () => {
    if (!selectedProviderType || !providerApiKey) return;

    setIsValidating(true);
    try {
      const token = await getToken();
      if (!token) return;

      if (editingProviderId) {
        await apiClient.updateProvider(token, editingProviderId, {
          apiKey: providerApiKey,
          baseUrl: providerBaseUrl || undefined,
        });
        showToast(toast('providerUpdated'), 'success');
      } else {
        const result = await apiClient.createProvider(token, {
          provider: selectedProviderType,
          apiKey: providerApiKey,
          baseUrl: providerBaseUrl || undefined,
        });
        if (result.validation?.valid) {
          showToast(`${result.label} connected — ${result.availableModels?.length || 0} models available`, 'success');
        } else {
          showToast(`${result.label} added but key validation failed: ${result.validation?.error || 'unknown error'}`, 'error');
        }
      }

      setShowProviderModal(false);
      setSelectedProviderType(null);
      setProviderApiKey("");
      setProviderBaseUrl("");
      setEditingProviderId(null);
      setShowApiKey(false);
      loadData();
    } catch (error: any) {
      const msg = error?.message || 'Failed to save provider';
      showToast(msg, 'error');
    } finally {
      setIsValidating(false);
    }
  };

  const handleDeleteProvider = async (id: string, label: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      await apiClient.deleteProvider(token, id);
      showToast(`${label} removed`, 'success');
      loadData();
    } catch {
      showToast(toast('providerRemoveFailed'), 'error');
    }
  };

  const handleCreateKey = async () => {
    if (!keyName) return;
    
    try {
      const token = await getToken();
      if (!token) return;

      const result = await apiClient.createApiKey(token, keyName);
      showToast(`API key created: ${result.apiKey.key}`, "success");
      setShowNewKey(false);
      setKeyName("");
      loadData();
    } catch (error) {
      showToast(toast('apiKeyCreateFailed'), "error");
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      await apiClient.deleteApiKey(token, keyId);
      showToast(toast('apiKeyRevoked'), "success");
      loadData();
    } catch (error) {
      showToast(toast('apiKeyRevokeFailed'), "error");
    }
  };

  return (
    <AppShell embedded>
        {/* Breadcrumb */}
        {!isOnboarding && (
          <div className="mb-8">
            <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {tc('backToHome')}
            </Link>
          </div>
        )}

        {/* Page Header */}
        <div className="mb-12">
          <h1 className="text-2xl font-medium mb-2">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 sm:gap-6 border-b border-border mb-8 sm:mb-12 overflow-x-auto scrollbar-hide">
          {[
            { id: "general", label: t('tabs.general'), soon: false },
            { id: "providers", label: t('tabs.providers'), soon: false },
            { id: "audit", label: t('tabs.audit'), soon: false },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.soon && setActiveTab(tab.id as any)}
              disabled={!!tab.soon}
              className={`pb-3 text-sm transition-colors relative flex items-center gap-2 whitespace-nowrap ${
                tab.soon
                  ? "text-gray-300 dark:text-muted-foreground cursor-not-allowed"
                  : activeTab === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-gray-600 dark:hover:text-muted-foreground"
              }`}
            >
              {tab.label}
              {tab.soon && (
                <span className="text-xs uppercase tracking-wider px-1.5 py-0.5 bg-muted text-muted-foreground rounded">
                  {tc('soon')}
                </span>
              )}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground"
                />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {activeTab === "providers" && (
            <div className="space-y-8">
              {/* BYOK Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Your Own Providers</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Optional — connect your own AI provider keys for full cost control.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowProviderModal(true);
                    setEditingProviderId(null);
                    setSelectedProviderType(null);
                    setProviderApiKey("");
                    setProviderBaseUrl("");
                  }}
                  className="btn-primary-sm px-4"
                >
                  {t('providers.addProvider')}
                </button>
              </div>

              {/* Connected Providers */}
              {providers.length > 0 && (
                <div className="space-y-3">
                  {providers.map((p: any) => {
                    const catalog = PROVIDER_CATALOG[p.provider as AIProviderType];
                    return (
                      <div key={p._id} className="card">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 border border-border rounded-lg flex items-center justify-center bg-muted">
                              <ProviderIcon provider={p.provider} size={28} />
                            </div>
                            <div>
                              <div className="font-medium text-sm">{p.label || catalog?.label || p.provider}</div>
                              <div className="flex items-center gap-3 mt-1">
                                <span className={`w-2 h-2 rounded-full ${
                                  p.status === 'active' ? 'bg-green-500' : p.status === 'invalid' ? 'bg-red-500' : 'bg-gray-400 dark:bg-muted'
                                }`} />
                                <span className="text-xs text-muted-foreground">
                                  {p.status === 'active' ? tc('connected') : p.status === 'invalid' ? t('providers.invalidKey') : t('providers.unchecked')}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  ····{p.apiKeyLastFour}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {p.availableModels?.length || 0} {t('providers.models')}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setShowProviderModal(true);
                                setSelectedProviderType(p.provider);
                                setEditingProviderId(p._id);
                                setProviderApiKey("");
                                setProviderBaseUrl("");
                              }}
                              className="btn-ghost-sm"
                            >
                              {t('providers.updateKey')}
                            </button>
                            <button
                              onClick={() => handleDeleteProvider(p._id, p.label || p.provider)}
                              className="btn-ghost-sm text-red-600 hover:text-red-700"
                            >
                              {tc('remove')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Available Providers — grouped by category */}
              {([
                { label: t('providers.premium'), keys: ['anthropic', 'openai', 'google', 'xai'] as AIProviderType[] },
                { label: t('providers.fastInference'), keys: ['groq', 'mistral'] as AIProviderType[] },
                { label: t('providers.flexible'), keys: ['openrouter', 'custom'] as AIProviderType[] },
              ]).map(group => (
                <div key={group.label}>
                  <h4 className="section-header mb-4">
                    {group.label}
                  </h4>
                  <div className="grid gap-3 md:grid-cols-2 mb-6">
                    {group.keys.filter(k => k in PROVIDER_CATALOG).map(key => {
                      const info = PROVIDER_CATALOG[key];
                      const isConnected = providers.some((p: any) => p.provider === key);
                      return (
                        <div
                          key={key}
                          className={`card cursor-pointer transition-colors ${
                            isConnected
                              ? 'opacity-50'
                              : 'hover:border-foreground/30'
                          }`}
                          onClick={() => {
                            if (isConnected) return;
                            setShowProviderModal(true);
                            setEditingProviderId(null);
                            setSelectedProviderType(key);
                            setProviderApiKey("");
                            setProviderBaseUrl("");
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 border border-border rounded-lg flex items-center justify-center bg-muted shrink-0">
                              <ProviderIcon provider={key} size={24} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium flex items-center gap-2">
                                {info.label}
                                {isConnected && (
                                  <span className="text-xs text-green-600 dark:text-green-400 font-normal">{tc('connected')}</span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {info.description}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Provider Modal */}
              {showProviderModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-card border border-border w-full max-w-md p-6 space-y-6"
                  >
                    <div>
                      <h3 className="text-lg font-medium">
                        {editingProviderId ? tc('update') : 'Add'}{' '}
                        {selectedProviderType
                          ? PROVIDER_CATALOG[selectedProviderType]?.label || selectedProviderType
                          : t('providers.title')}
                      </h3>
                      {selectedProviderType && PROVIDER_CATALOG[selectedProviderType] && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {PROVIDER_CATALOG[selectedProviderType].authHint}
                        </p>
                      )}
                    </div>

                    {!selectedProviderType && !editingProviderId && (
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">{t('providers.selectProvider')}</label>
                        <div className="grid gap-2">
                          {(Object.entries(PROVIDER_CATALOG) as [AIProviderType, typeof PROVIDER_CATALOG[AIProviderType]][]).map(
                            ([key, info]) => {
                              const isConnected = providers.some((p: any) => p.provider === key);
                              return (
                                <button
                                  key={key}
                                  onClick={() => setSelectedProviderType(key)}
                                  disabled={isConnected}
                                  className={`text-left p-3 border transition-colors ${
                                    isConnected
                                      ? 'border-border opacity-40 cursor-not-allowed'
                                      : 'border-border hover:border-foreground'
                                  }`}
                                >
                                  <div className="text-sm font-medium">{info.label}</div>
                                  <div className="text-xs text-gray-500">{info.description}</div>
                                </button>
                              );
                            }
                          )}
                        </div>
                      </div>
                    )}

                    {selectedProviderType && (
                      <>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">{t('providers.apiKey')}</label>
                            <div className="relative">
                              <input
                                type={showApiKey ? 'text' : 'password'}
                                placeholder={editingProviderId ? t('providers.enterNewKey') : t('providers.apiKeyPlaceholder')}
                                value={providerApiKey}
                                onChange={(e) => setProviderApiKey(e.target.value)}
                                className="input font-mono text-sm pr-10"
                                autoFocus
                                autoComplete="new-password"
                                data-1p-ignore
                                data-lpignore="true"
                              />
                              <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-foreground transition-colors"
                                tabIndex={-1}
                              >
                                {showApiKey ? (
                                  <EyeOff size={16} strokeWidth={2} />
                                ) : (
                                  <Eye size={16} strokeWidth={2} />
                                )}
                              </button>
                            </div>
                          </div>

                          {(selectedProviderType === 'custom' || selectedProviderType === 'openrouter') && (
                            <div className="space-y-2">
                              <label className="text-xs text-muted-foreground">{t('providers.baseUrl')}</label>
                              <input
                                type="url"
                                placeholder="https://api.example.com/v1"
                                value={providerBaseUrl}
                                onChange={(e) => setProviderBaseUrl(e.target.value)}
                                className="input text-sm"
                              />
                            </div>
                          )}

                          {selectedProviderType && PROVIDER_CATALOG[selectedProviderType]?.models.length > 0 && (
                            <div>
                              <label className="text-xs text-muted-foreground mb-2 block">
                                {t('providers.availableModels')}
                              </label>
                              <div className="space-y-1">
                                {PROVIDER_CATALOG[selectedProviderType].models.map((m) => (
                                  <div key={m.id} className="flex items-center justify-between text-xs py-1.5 px-2 border border-border/60">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{m.name}</span>
                                      <span className={`px-1.5 py-0.5 text-xs uppercase tracking-wider ${
                                        m.tier === 'fast'
                                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                          : m.tier === 'balanced'
                                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                          : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                                      }`}>
                                        {m.tier}
                                      </span>
                                      {m.reasoning && (
                                        <span className="px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                                          THINKING
                                        </span>
                                      )}
                                    </div>
                                    {m.cost && (
                                      <span className="text-gray-400">
                                        ${m.cost.input}/{m.cost.output} per 1M
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleAddProvider}
                            disabled={!providerApiKey || isValidating}
                            className="btn-primary-sm px-4 disabled:opacity-50 flex items-center gap-2"
                          >
                            {isValidating ? (
                              <>
                                <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                                {t('providers.validating')}
                              </>
                            ) : editingProviderId ? (
                              t('providers.updateProvider')
                            ) : (
                              t('providers.connectProvider')
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setShowProviderModal(false);
                              setSelectedProviderType(null);
                              setProviderApiKey("");
                              setProviderBaseUrl("");
                              setEditingProviderId(null);
                              setShowApiKey(false);
                            }}
                            className="btn-ghost-sm px-4"
                          >
                            {tc('cancel')}
                          </button>
                        </div>
                      </>
                    )}
                  </motion.div>
                </div>
              )}

              {/* Tool API Keys (merged from Tools tab) */}
              <div className="mt-12 pt-8 border-t border-border">
                <div>
                  <h3 className="text-sm font-medium">{t('toolKeys.title')}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('toolKeys.description')}
                  </p>
                </div>

                <div className="card space-y-6 mt-6">
                  {/* Brave Search API */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-medium flex items-center gap-2">
                          <Box className="w-4 h-4" />
                          {t('toolKeys.braveSearch')}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('toolKeys.braveRequired')}
                        </p>
                      </div>
                      {hasBraveApiKey && !braveApiKey && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                          {tc('configured')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showBraveKey ? "text" : "password"}
                          placeholder={hasBraveApiKey ? "••••••••••••••••" : "BSA-xxxxxxxxxxxxxxxx"}
                          value={braveApiKey}
                          onChange={(e) => setBraveApiKey(e.target.value)}
                          autoComplete="new-password"
                          data-1p-ignore
                          data-lpignore="true"
                          className="input pr-10 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBraveKey(!showBraveKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-foreground p-1"
                        >
                          {showBraveKey ? (
                            <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                          ) : (
                            <Eye className="w-4 h-4" strokeWidth={1.5} />
                          )}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('toolKeys.braveHint')}
                    </p>
                  </div>

                  {/* Save Button */}
                  <div className="flex justify-end pt-2 border-t border-border/60/50">
                    <button
                      onClick={async () => {
                        if (!braveApiKey.trim()) return;
                        setIsSavingToolKeys(true);
                        try {
                          const token = await getToken();
                          if (!token) return;
                          await apiClient.updateOrganization(token, {
                            toolApiKeys: {
                              braveApiKey: braveApiKey.trim(),
                            },
                          });
                          setHasBraveApiKey(true);
                          setBraveApiKey("");
                          showToast(toast('toolApiKeySaved'), "success");
                        } catch (error) {
                          showToast(toast('toolApiKeySaveFailed'), "error");
                        } finally {
                          setIsSavingToolKeys(false);
                        }
                      }}
                      disabled={!braveApiKey.trim() || isSavingToolKeys}
                      className="btn-primary-sm px-4 disabled:opacity-40"
                    >
                      {isSavingToolKeys ? tc('saving') : t('toolKeys.saveKeys')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "general" && (
            <div className="space-y-8">
              <div className="card space-y-6">
                <div>
                  <h3 className="section-header mb-1">
                    {t('general.accountInfo')}
                  </h3>
                  <p className="text-xs text-muted-foreground">{t('general.accountInfoDesc')}</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('general.emailLabel')}</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('general.companyName')}</label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="input"
                    />
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setIsSaving(true);
                    try {
                      const token = await getToken();
                      if (!token) return;
                      await apiClient.updateUser(token, { email, companyName } as any);
                      showToast(toast('accountUpdated'), 'success');
                    } catch {
                      showToast(toast('accountUpdateFailed'), 'error');
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  disabled={isSaving}
                  className="btn-primary-sm px-4 disabled:opacity-50"
                >
                  {isSaving ? tc('saving') : tc('saveChanges')}
                </button>
              </div>

              <div className="card space-y-6">
                <div>
                  <h3 className="section-header mb-1">
                    {t('general.preferences')}
                  </h3>
                  <p className="text-xs text-muted-foreground">{t('general.preferencesDesc')}</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Onboarding Tour</p>
                    <p className="text-xs text-muted-foreground">Produkt-Tour nochmal starten</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (clerkUser) {
                        await clerkUser.update({ unsafeMetadata: { ...clerkUser.unsafeMetadata, tourDone: false } });
                      }
                      router.push('/dashboard');
                      setTimeout(() => startNextStep('onboarding'), 1000);
                    }}
                    className="btn text-xs gap-1.5"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Tour starten
                  </button>
                </div>
              </div>

              {/* Agency Mode — disabled for now, can be re-enabled later */}
            </div>
          )}

          {activeTab === "audit" && (
            <AuditTrail />
          )}

          {activeTab === "api" && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">{t('apiKeys.title')}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('apiKeys.description')}
                  </p>
                </div>
                <button
                  onClick={() => setShowNewKey(true)}
                  className="btn-primary-sm px-4"
                >
                  {t('apiKeys.createNew')}
                </button>
              </div>

              {showNewKey && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="card space-y-4"
                >
                  <h4 className="section-header">
                    {t('apiKeys.newApiKey')}
                  </h4>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('apiKeys.keyName')}</label>
                    <input
                      type="text"
                      placeholder={t('apiKeys.keyNamePlaceholder')}
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateKey}
                      className="btn-primary-sm px-4"
                    >
                      {tc('create')}
                    </button>
                    <button
                      onClick={() => setShowNewKey(false)}
                      className="btn-ghost-sm px-4"
                    >
                      {tc('cancel')}
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="space-y-3">
                {isLoading ? (
                  <div className="text-center py-8 text-gray-400">{tc('loading')}</div>
                ) : apiKeys.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">{t('apiKeys.noKeys')}</div>
                ) : (
                  apiKeys.map((key) => (
                    <div key={key.id} className="card">
                      <div className="flex items-center justify-between">
                        <div className="space-y-2">
                          <div className="font-medium text-sm">{key.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{key.key}</div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{t('apiKeys.createdLabel')} {new Date(key.createdAt).toLocaleDateString()}</span>
                            {key.lastUsed && (
                              <>
                                <span>·</span>
                                <span>{t('apiKeys.lastUsed')} {new Date(key.lastUsed).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button 
                          onClick={() => handleDeleteKey(key.id)}
                          className="btn-ghost-sm px-4 text-red-600 hover:text-red-700"
                        >
                          {t('apiKeys.revoke')}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </motion.div>
    </AppShell>
  );
}
