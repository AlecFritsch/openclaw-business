"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ── Types ────────────────────────────────────────────────────────

interface SkillRequirements {
  envVars: string[];
  primaryEnv: string | null;
}

interface SkillSecurity {
  verdict: "verified" | "clean" | "suspicious" | "malicious" | "pending" | "unknown";
  isMalwareBlocked: boolean;
  isSuspicious: boolean;
  vtUrl?: string;
}

interface Skill {
  slug: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  category?: string;
  security?: SkillSecurity;
  stats?: { downloads?: number; stars?: number };
  owner?: { handle?: string };
  requirements?: { envVars?: string[] };
}

interface InstalledSkill extends Skill {
  enabled: boolean;
  env: Record<string, string>;
  apiKey?: string;
  installedAt: string;
  securityVerdict?: string;
  permissions?: string[];
}

// ── Config Modal ──────────────────────────────────────────────────

function ConfigModal({
  name,
  mode,
  envVars,
  primaryEnv,
  initialEnv,
  initialApiKey,
  onSave,
  onCancel,
}: {
  name: string;
  mode: "install" | "edit";
  envVars: string[];
  primaryEnv: string | null;
  initialEnv: Record<string, string>;
  initialApiKey: string;
  onSave: (env: Record<string, string>, apiKey: string | undefined) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("agentSkills");
  const [env, setEnv] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of envVars)
      out[k] = (primaryEnv === k ? initialApiKey : initialEnv[k]) ?? "";
    return out;
  });
  const [apiKey, setApiKey] = useState(initialApiKey);

  const handleSubmit = () => {
    const cleaned: Record<string, string> = {};
    for (const k of envVars) {
      const v = (primaryEnv === k ? apiKey : env[k])?.trim();
      if (v) cleaned[k] = v;
    }
    onSave(cleaned, primaryEnv && apiKey.trim() ? apiKey.trim() : undefined);
  };

  const hasValues = envVars.some((k) => env[k]?.trim()) || apiKey.trim();
  const canSubmit = mode === "edit" || hasValues;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="box-modal w-full max-w-md mx-4 p-5">
        <h3 className="text-base font-semibold text-foreground">{t("configRequired")}</h3>
        <p className="text-xs text-muted-foreground mt-1 mb-4">{name}</p>

        <div className="space-y-4 mb-5">
          {envVars.map((key) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">{key}</label>
              <input
                type="password"
                value={env[key] ?? (primaryEnv === key ? apiKey : "")}
                onChange={(e) =>
                  primaryEnv === key
                    ? setApiKey(e.target.value)
                    : setEnv((p) => ({ ...p, [key]: e.target.value }))
                }
                placeholder={key}
                className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-lg outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600"
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 py-2 text-xs font-medium bg-foreground text-primary-foreground rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {mode === "install" ? t("installWithConfig") : t("saveConfig")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Security Dialog ───────────────────────────────────────────────

function SecurityDialog({
  warnings,
  skillName,
  onConfirm,
  onCancel,
}: {
  warnings: string[];
  skillName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("agentSkills");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="box-modal w-full max-w-md mx-4 border-amber-200 dark:border-amber-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">⚠</span>
          <h3 className="text-base font-semibold">{t("securityWarnings")}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t("warningsFound", { name: skillName })}</p>
        <ul className="space-y-2 mb-5">
          {warnings.map((w, i) => (
            <li key={i} className="text-xs text-amber-800 dark:text-amber-200 flex gap-2">
              <span className="shrink-0">•</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted"
          >
            {t("cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            {t("installAnyway")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function AgentSkillsPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations("agentSkills");
  const toast = useTranslations("toasts");
  const [agentId, setAgentId] = useState("");
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [requirementsMap, setRequirementsMap] = useState<Record<string, SkillRequirements>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBrowseLoading, setIsBrowseLoading] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [securityDialog, setSecurityDialog] = useState<{
    slug: string;
    name: string;
    warnings: string[];
    env?: Record<string, string>;
    apiKey?: string;
  } | null>(null);
  const [configDialog, setConfigDialog] = useState<{
    slug: string;
    name: string;
    mode: "install" | "edit";
    envVars: string[];
    primaryEnv: string | null;
    initialEnv: Record<string, string>;
    initialApiKey: string;
  } | null>(null);
  const { getToken } = useAuth();

  const debouncedSearch = useDebounce(searchQuery, 300);
  const browseSeqRef = useRef(0);

  useEffect(() => {
    params.then((p) => setAgentId(p.id));
  }, [params]);

  const loadInstalledData = useCallback(async () => {
    const token = await getToken();
    if (!token || !agentId) return;
    try {
      const [installedData] = await Promise.all([
        apiClient.getInstalledSkills(token, agentId),
      ]);
      setInstalledSkills(installedData.skills);

      // Fetch requirements for each installed skill
      const reqMap: Record<string, SkillRequirements> = {};
      await Promise.all(
        installedData.skills.map(async (s: InstalledSkill) => {
          try {
            const r = await apiClient.getSkillRequirements(token, s.slug);
            reqMap[s.slug] = r;
          } catch {
            reqMap[s.slug] = { envVars: [], primaryEnv: null };
          }
        })
      );
      setRequirementsMap(reqMap);
    } catch (err) {
    }
  }, [agentId, getToken]);

  const loadBrowseData = useCallback(
    async (category: string, search: string) => {
      const seq = ++browseSeqRef.current;
      setIsBrowseLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const data = await apiClient.browseSkills(token, {
          category: category !== "all" ? category : undefined,
          search: search || undefined,
        });
        if (seq !== browseSeqRef.current) return;
        setAvailableSkills(data.skills);
        setCategories(data.categories || []);
      } catch {
        if (seq === browseSeqRef.current) setAvailableSkills([]);
      } finally {
        if (seq === browseSeqRef.current) setIsBrowseLoading(false);
      }
    },
    [getToken]
  );

  useEffect(() => {
    if (!agentId) return;
    setIsLoading(true);
    Promise.all([loadInstalledData(), loadBrowseData(selectedCategory, debouncedSearch)]).finally(() =>
      setIsLoading(false)
    );
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!agentId) return;
    loadBrowseData(selectedCategory, debouncedSearch);
  }, [selectedCategory, debouncedSearch, agentId, loadBrowseData]);

  const handleInstall = useCallback(
    async (slug: string, acknowledgedWarnings = false, env?: Record<string, string>, apiKey?: string) => {
      setInstallingSlug(slug);
      try {
        const token = await getToken();
        if (!token) return;
        await apiClient.installSkill(token, agentId, { slug, acknowledgedWarnings, env, apiKey });
        await apiClient.installGatewaySkill(token, agentId, slug).catch(() => {});
        setSecurityDialog(null);
        await loadInstalledData();
        showToast(toast("skillInstalled"), "success");
      } catch (err: any) {
        if (err?.status === 422 || err?.error === "security_warning") {
          const skill = availableSkills.find((s) => s.slug === slug);
          setSecurityDialog({
            slug,
            name: skill?.name || slug,
            warnings: err.warnings || ["Unknown security warning"],
            env,
            apiKey,
          });
          return;
        }
        if (err?.status === 403) {
          showToast(err?.message || t("blockedStatus"), "error");
          return;
        }
        showToast(err instanceof Error ? err.message : "Failed to install skill", "error");
      } finally {
        setInstallingSlug(null);
      }
    },
    [agentId, availableSkills, getToken, loadInstalledData, toast, t]
  );

  const handleUninstall = async (slug: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.uninstallSkill(token, agentId, slug);
      await loadInstalledData();
      showToast(toast("skillUninstalled"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to uninstall skill", "error");
    }
  };

  const handleConfigSave = useCallback(
    async (slug: string, env: Record<string, string>, apiKey: string | undefined) => {
      try {
        const token = await getToken();
        if (!token) return;
        await apiClient.updateSkillConfig(token, agentId, slug, { env, apiKey: apiKey || undefined });
        await apiClient.updateGatewaySkill(token, agentId, slug, { env, apiKey }).catch(() => {});
        setConfigDialog(null);
        await loadInstalledData();
        showToast(t("configSaved"), "success");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to save configuration", "error");
      }
    },
    [agentId, getToken, loadInstalledData, t]
  );

  const handleToggle = async (slug: string, enabled: boolean) => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.updateSkillConfig(token, agentId, slug, { enabled });
      await apiClient.updateGatewaySkill(token, agentId, slug, { enabled }).catch(() => {});
      setInstalledSkills((prev) =>
        prev.map((s) => (s.slug === slug ? { ...s, enabled } : s))
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update skill", "error");
    }
  };

  const installedSlugs = useMemo(() => new Set(installedSkills.map((s) => s.slug)), [installedSkills]);

  const isConfigured = (skill: InstalledSkill): boolean => {
    const req = requirementsMap[skill.slug];
    if (!req || (req.envVars.length === 0 && !req.primaryEnv)) return true;
    if (req.primaryEnv && skill.apiKey?.trim()) return true;
    return req.envVars.every((k) => {
      if (k === req!.primaryEnv) return !!skill.apiKey?.trim();
      return !!skill.env?.[k]?.trim();
    });
  };

  if (isLoading) {
    return (
      <AppShell embedded>
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded>
      {securityDialog && (
        <SecurityDialog
          warnings={securityDialog.warnings}
          skillName={securityDialog.name}
          onConfirm={() =>
            handleInstall(securityDialog.slug, true, securityDialog.env, securityDialog.apiKey)
          }
          onCancel={() => {
            setSecurityDialog(null);
            setInstallingSlug(null);
          }}
        />
      )}

      {configDialog && (
        <ConfigModal
          name={configDialog.name}
          mode={configDialog.mode}
          envVars={configDialog.envVars}
          primaryEnv={configDialog.primaryEnv}
          initialEnv={configDialog.initialEnv}
          initialApiKey={configDialog.initialApiKey}
          onSave={(env, apiKey) => {
            if (configDialog.mode === "install") {
              setConfigDialog(null);
              handleInstall(configDialog.slug, false, env, apiKey);
            } else {
              handleConfigSave(configDialog.slug, env, apiKey);
            }
          }}
          onCancel={() => setConfigDialog(null)}
        />
      )}

      <div className="w-full min-h-0">
        {/* Hero */}
        <div className="mb-6 sm:mb-8 -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 px-4 sm:px-5 pt-4 sm:pt-5 pb-6 sm:pb-8 bg-gradient-to-b from-gray-100/80 to-transparent dark:from-gray-900/40 dark:to-transparent">
          <h1 className="text-xl font-medium">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{t("description")}</p>
        </div>

        {/* Installed — same grid as marketplace, no horizontal scroll */}
        {installedSkills.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              {t("installedCount", { count: installedSkills.length })}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {installedSkills.map((skill) => {
                const req = requirementsMap[skill.slug];
                const needsConfig = req && (req.envVars.length > 0 || req.primaryEnv) && !isConfigured(skill);
                const canEnable = !needsConfig;

                return (
                  <div
                    key={skill.slug}
                    className={`box flex flex-col p-4 transition-opacity ${
                      !skill.enabled ? "opacity-70" : ""
                    } border-border bg-white dark:bg-background`}
                  >
                    <div className="flex-1 min-h-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-medium text-sm text-foreground truncate">{skill.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">v{skill.version}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-3">{skill.description}</p>
                      {skill.permissions && skill.permissions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {skill.permissions.map((p) => (
                            <span key={p} className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 font-mono">
                              {p.replace('group:', '')}
                            </span>
                          ))}
                        </div>
                      )}
                      {(!skill.permissions || skill.permissions.length === 0) && (
                        <span className="inline-block mt-2 text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
                          unrestricted
                        </span>
                      )}
                      {needsConfig && (
                        <span className="inline-block mt-2 text-xs text-amber-600 dark:text-amber-500">
                          {t("configureFirst")}
                        </span>
                      )}
                    </div>
                    <div className="mt-4 pt-3 border-t border-border/60/80">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const baseVars =
                                req?.envVars ?? (skill as Skill).requirements?.envVars ?? Object.keys(skill.env || {});
                              const envVars =
                                req?.primaryEnv && !baseVars.includes(req.primaryEnv)
                                  ? [req.primaryEnv, ...baseVars]
                                  : baseVars;
                              setConfigDialog({
                                slug: skill.slug,
                                name: skill.name,
                                mode: "edit",
                                envVars: envVars.length > 0 ? envVars : ["API_KEY"],
                                primaryEnv: req?.primaryEnv ?? null,
                                initialEnv: skill.env || {},
                                initialApiKey: skill.apiKey || "",
                              });
                            }}
                            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {t("configure")}
                          </button>
                          <span className="text-gray-200 dark:text-muted-foreground">·</span>
                          <button
                            onClick={() => handleUninstall(skill.slug)}
                            className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                          >
                            {t("remove")}
                          </button>
                        </div>
                        <span title={needsConfig ? t("configureFirst") : undefined}>
                          <Switch
                            size="sm"
                            checked={skill.enabled}
                            onChange={(v) => canEnable && handleToggle(skill.slug, v)}
                            disabled={!canEnable}
                          />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Marketplace */}
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            {t("browseHub")}
          </h2>
          <div className="flex flex-col gap-4 mb-6">
            <div className="relative w-full">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full px-4 py-3 text-sm bg-secondary/50 border border-border rounded-xl outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 placeholder:text-muted-foreground"
              />
              {isBrowseLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap scrollbar-hide overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-2 text-xs font-medium rounded-xl capitalize transition-colors shrink-0 ${
                    selectedCategory === cat
                      ? "bg-foreground text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {availableSkills.map((skill) => {
              const isInstalled = installedSlugs.has(skill.slug);
              const isInstalling = installingSlug === skill.slug;
              const isBlocked = skill.security?.isMalwareBlocked;
              const envVars = skill.requirements?.envVars ?? [];

              return (
                <div
                  key={skill.slug}
                  className={`group relative flex flex-col p-4 rounded-xl border transition-colors ${
                    isBlocked
                      ? "border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/20 opacity-80"
                      : "border-border bg-white dark:bg-background hover:border-border"
                  }`}
                >
                  <div className="flex-1 min-h-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-medium text-sm text-foreground truncate">{skill.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">v{skill.version}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3">{skill.description}</p>
                    {envVars.length > 0 && (
                      <span className="inline-block mt-2 text-xs text-amber-600 dark:text-amber-500">
                        {t("requiresConfig")}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 pt-3 border-t border-border/60/80">
                    {isBlocked ? (
                      <span className="text-xs text-red-500 font-medium">{t("blockedStatus")}</span>
                    ) : isInstalled ? (
                      <span className="text-xs text-emerald-600 dark:text-emerald-500 font-medium">
                        ✓ {t("installed")}
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          setInstallingSlug(skill.slug);
                          const token = await getToken();
                          if (!token) { setInstallingSlug(null); return; }
                          try {
                            const req = await apiClient.getSkillRequirements(token, skill.slug);
                            const needsConfig = req.envVars.length > 0 || req.primaryEnv;
                            if (needsConfig) {
                              // Install first (disabled state), then open config
                              try {
                                await apiClient.installSkill(token, agentId, { slug: skill.slug, acknowledgedWarnings: false });
                                await apiClient.installGatewaySkill(token, agentId, skill.slug).catch(() => {});
                                await loadInstalledData();
                              } catch (installErr: any) {
                                if (installErr?.status === 422 || installErr?.error === 'security_warning') {
                                  const envVarsList = req.primaryEnv
                                    ? [req.primaryEnv, ...req.envVars.filter((e) => e !== req.primaryEnv)]
                                    : req.envVars;
                                  setSecurityDialog({
                                    slug: skill.slug,
                                    name: skill.name,
                                    warnings: installErr.warnings || ['Unknown security warning'],
                                    env: {},
                                    apiKey: undefined,
                                  });
                                  setInstallingSlug(null);
                                  return;
                                }
                              }
                              // Open config dialog after install
                              const envVarsList = req.primaryEnv
                                ? [req.primaryEnv, ...req.envVars.filter((e) => e !== req.primaryEnv)]
                                : req.envVars;
                              setConfigDialog({
                                slug: skill.slug,
                                name: skill.name,
                                mode: 'edit',
                                envVars: envVarsList,
                                primaryEnv: req?.primaryEnv ?? null,
                                initialEnv: {},
                                initialApiKey: '',
                              });
                            } else {
                              handleInstall(skill.slug);
                            }
                          } catch {
                            handleInstall(skill.slug);
                          } finally {
                            setInstallingSlug(null);
                          }
                        }}
                        disabled={isInstalling}
                        className="w-full py-2.5 text-xs font-medium bg-foreground text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-1.5"
                      >
                        {isInstalling ? (
                          <>
                            <div className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                            {t("checking")}
                          </>
                        ) : t("install")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {availableSkills.length === 0 && (
            <div className="box-empty py-16 text-center text-sm text-muted-foreground">
              {searchQuery ? t("noResultsSemantic") : t("noSkillsAvailable")}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
