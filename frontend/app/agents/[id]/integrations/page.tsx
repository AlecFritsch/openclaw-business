"use client";

import { AppShell, PageHeader } from "@/components/app-shell";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { parseSmitheryConfigSchema } from "@openclaw-business/shared";
import type { SmitheryConnection, SmitheryServer, SmitheryConfigField } from "@openclaw-business/shared";


const STATUS_LABEL_KEY: Record<string, string> = {
  connected: "statusConnected",
  auth_required: "statusAuthRequired",
  error: "statusError",
  unknown: "statusUnknown",
};

const SECTION_TITLE = "section-header";

interface SmitherySkillListItem {
  slug: string;
  namespace: string;
  displayName: string;
  description: string;
  categories: string[];
  homepage: string;
  iconUrl?: string | null;
}

interface IntegrationConnection extends SmitheryConnection {
  authorizationUrl?: string | null;
}

export default function AgentIntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const [agentId, setAgentId] = useState("");
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [servers, setServers] = useState<SmitheryServer[]>([]);
  const [skills, setSkills] = useState<SmitherySkillListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [serversLoading, setServersLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [connectingMcp, setConnectingMcp] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectModal, setConnectModal] = useState<{
    server: SmitheryServer;
    configFields: SmitheryConfigField[];
    authUrl?: string;
    connectionId?: string;
    credentials: Record<string, string>;
    detailLoading?: boolean;
    success?: boolean;
  } | null>(null);
  const authPopupRef = useRef<Window | null>(null);
  const authVerifyInFlightRef = useRef(false);
  const { getToken } = useAuth();
  const t = useTranslations("agentIntegrations");
  const tc = useTranslations("common");
  const confirm = useConfirm();

  useEffect(() => { params.then((p) => setAgentId(p.id)); }, [params]);

  // Debounce search — 200ms for typing, immediate for clearing
  useEffect(() => {
    if (searchQuery.trim() === "") {
      setSearchDebounced("");
      return;
    }
    const id = setTimeout(() => setSearchDebounced(searchQuery.trim()), 200);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const connectedUrls = useMemo(() => new Set(connections.map((c) => c.mcpUrl)), [connections]);
  const ITEMS_PER_PAGE = 48;

  type IntegrationItem = { type: "mcp"; server: SmitheryServer } | { type: "skill"; skill: SmitherySkillListItem };

  const allIntegrations = useMemo<IntegrationItem[]>(() => {
    const mcpItems: IntegrationItem[] = servers
      .filter((s) => !connectedUrls.has(s.mcpUrl))
      .map((server) => ({ type: "mcp", server }));
    const skillItems: IntegrationItem[] = skills.map((skill) => ({ type: "skill", skill }));
    return [...mcpItems, ...skillItems];
  }, [servers, skills, connectedUrls]);

  const totalPages = Math.max(1, Math.ceil(allIntegrations.length / ITEMS_PER_PAGE));
  const pagedIntegrations = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return allIntegrations.slice(start, start + ITEMS_PER_PAGE);
  }, [allIntegrations, currentPage]);

  useEffect(() => { setCurrentPage(1); }, [searchDebounced]);

  // Simple in-memory cache for search results (key = query string)
  const cacheRef = useRef<Map<string, { servers: SmitheryServer[]; skills: SmitherySkillListItem[]; ts: number }>>(new Map());
  const CACHE_TTL = 60_000; // 60s
  const requestIdRef = useRef(0);

  // Load servers + skills in parallel with caching + cancellation
  const loadCatalog = useCallback(async () => {
    const query = searchDebounced;

    // Min 2 chars for search (but empty = show all)
    if (query.length === 1) return;

    // Check cache
    const cacheKey = query || "__all__";
    const cached = cacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setCatalogError(null);
      setServers(cached.servers);
      setSkills(cached.skills);
      setInitialLoaded(true);
      setServersLoading(false);
      setSkillsLoading(false);
      return;
    }

    // Cancel previous request via ID tracking
    const reqId = ++requestIdRef.current;

    // Only show full loading on first load
    if (!initialLoaded) {
      setServersLoading(true);
      setSkillsLoading(true);
    }

    try {
      const token = await getToken();
      if (!token || reqId !== requestIdRef.current) return;

      const [serversRes, skillsRes] = await Promise.all([
        apiClient.smitheryServers(token, { q: query || undefined }),
        apiClient.smitherySkills(token, { q: query || undefined, pageSize: 100 }),
      ]);

      if (reqId !== requestIdRef.current) return;
      setCatalogError(null);
      setServers(serversRes.servers);
      setSkills(skillsRes.skills);
      setInitialLoaded(true);

      // Cache results
      cacheRef.current.set(cacheKey, { servers: serversRes.servers, skills: skillsRes.skills, ts: Date.now() });
      // Evict old cache entries
      if (cacheRef.current.size > 30) {
        const oldest = [...cacheRef.current.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) cacheRef.current.delete(oldest[0]);
      }
    } catch (err) {
      if (reqId === requestIdRef.current) {
        const msg = err instanceof Error ? err.message : t("catalogLoadFailed");
        setCatalogError(msg);
      }
    } finally {
      if (reqId === requestIdRef.current) {
        setServersLoading(false);
        setSkillsLoading(false);
      }
    }
  }, [getToken, searchDebounced, initialLoaded, t]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const loadConnections = useCallback(async () => {
    setLoadError(null);
    try {
      const token = await getToken();
      if (!token) { setConnections([]); return; }
      const res = await apiClient.smitheryConnections(token);
      setConnections(res.connections || []);
    } catch (err) {
      setConnections([]);
      const msg = err instanceof Error ? err.message : t("connectFailed");
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [getToken, t]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  const openConnectModal = useCallback(async (server: SmitheryServer) => {
    setConnectModal({ server, configFields: [], credentials: {}, detailLoading: true });
    try {
      const token = await getToken();
      if (!token) return;
      const detail = await apiClient.smitheryServerDetail(token, server.qualifiedName);
      const configFields = parseSmitheryConfigSchema(detail.configSchema ?? null);
      setConnectModal((prev) => prev ? { ...prev, configFields, detailLoading: false } : null);
    } catch {
      setConnectModal((prev) => prev ? { ...prev, configFields: [], detailLoading: false } : null);
    }
  }, [getToken]);

  const closeConnectModal = useCallback(() => {
    setConnectModal(null);
    setConnectingMcp(null);
    authPopupRef.current = null;
  }, []);

  const handleConnectSubmit = async (withCredentials?: boolean) => {
    if (!connectModal) return;
    const { server, credentials, configFields, connectionId } = connectModal;
    setConnectingMcp(server.mcpUrl);
    try {
      const token = await getToken();
      if (!token) return;
      let mcpUrl = server.mcpUrl;
      let headers: Record<string, string> | undefined;
      if (withCredentials && configFields.length > 0) {
        const headerEntries: [string, string][] = [];
        const queryParams = new URLSearchParams();
        for (const f of configFields) {
          const val = credentials[f.key]?.trim();
          if (!val) continue;
          if (f.target.kind === "header") headerEntries.push([f.target.name, val]);
          else queryParams.set(f.target.name, val);
        }
        headers = headerEntries.length > 0 ? Object.fromEntries(headerEntries) : undefined;
        const qs = queryParams.toString();
        if (qs) mcpUrl = mcpUrl.includes("?") ? `${mcpUrl}&${qs}` : `${mcpUrl}?${qs}`;
      } else if (withCredentials && Object.keys(credentials).length > 0) {
        headers = credentials;
      }
      const result = await apiClient.smitheryConnect(token, { mcpUrl, mcpName: server.displayName, agentId, connectionId, headers });
      if (result.status === "auth_required") {
        setConnectModal((prev) => prev ? { ...prev, authUrl: result.authorizationUrl, connectionId: result.connectionId } : null);
        showToast(t("authOpened", { name: server.displayName }), "info");
        loadConnections();
      } else {
        showToast(t("connectSuccess", { name: server.displayName }), "success");
        setConnectModal((prev) => prev ? { ...prev, success: true } : null);
        loadConnections();
        setTimeout(closeConnectModal, 1200);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("connectFailed");
      const status = (err as { status?: number })?.status;
      if (status === 409) showToast(t("connectConflictHint"), "error");
      else showToast(msg, "error");
    } finally {
      setConnectingMcp(null);
    }
  };

  const verifyAuthorizationStatus = useCallback(async (opts?: { silent?: boolean; background?: boolean }) => {
    if (!connectModal?.connectionId) return;
    if (authVerifyInFlightRef.current) return;
    const silent = opts?.silent ?? false;
    const background = opts?.background ?? false;
    const { server, connectionId } = connectModal;
    authVerifyInFlightRef.current = true;
    if (!background) setConnectingMcp(server.mcpUrl);
    try {
      const token = await getToken();
      if (!token) return;
      const result = await apiClient.smitheryConnect(token, {
        mcpUrl: server.mcpUrl,
        mcpName: server.displayName,
        agentId,
        connectionId,
      });
      if (result.status === "connected") {
        showToast(t("connectSuccess", { name: server.displayName }), "success");
        setConnectModal((prev) => prev ? { ...prev, success: true, authUrl: undefined } : null);
        await loadConnections();
        setTimeout(closeConnectModal, 1200);
      } else {
        setConnectModal((prev) => prev ? { ...prev, authUrl: result.authorizationUrl ?? prev.authUrl, connectionId: result.connectionId } : null);
        if (!silent) showToast(t("authStillPending"), "info");
        await loadConnections();
      }
    } catch {
      if (!silent) showToast(t("connectFailed"), "error");
    } finally {
      authVerifyInFlightRef.current = false;
      if (!background) setConnectingMcp(null);
    }
  }, [agentId, closeConnectModal, connectModal, getToken, loadConnections, t]);

  const handleOpenAuthUrl = () => {
    if (!connectModal?.authUrl) return;
    // Close existing popup if it exists
    if (authPopupRef.current && !authPopupRef.current.closed) {
      authPopupRef.current.close();
    }
    authPopupRef.current = window.open(connectModal.authUrl, "_blank", "noopener,noreferrer,width=520,height=640");
  };

  const disconnectConnection = async (
    conn: Pick<IntegrationConnection, "connectionId" | "mcpName">,
    requireConfirmation = true
  ) => {
    const name = conn.mcpName || conn.connectionId;
    if (requireConfirmation && !(await confirm({ title: t("disconnectTitle", { name }), description: t("disconnectDesc") }))) return false;
    setActionLoading(conn.connectionId);
    try {
      const token = await getToken();
      if (!token) return false;
      await apiClient.smitheryDisconnect(token, conn.connectionId);
      showToast(t("disconnected", { name }), "success");
      await loadConnections();
      return true;
    } catch {
      showToast(t("disconnectFailed"), "error");
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async (conn: Pick<IntegrationConnection, "connectionId" | "mcpName">) => {
    await disconnectConnection(conn, true);
  };

  const handleVerifyAuthorization = async () => {
    await verifyAuthorizationStatus({ silent: false, background: false });
  };

  useEffect(() => {
    if (!connectModal?.authUrl || !connectModal.connectionId) return;
    const onFocus = () => { void verifyAuthorizationStatus({ silent: true, background: true }); };
    const intervalId = window.setInterval(() => {
      const popupClosed = !!authPopupRef.current && authPopupRef.current.closed;
      if (popupClosed) authPopupRef.current = null;
      void verifyAuthorizationStatus({ silent: true, background: true });
    }, 3000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [connectModal?.authUrl, connectModal?.connectionId, verifyAuthorizationStatus]);

  const handleAbortPendingAuthorization = async (conn: Pick<IntegrationConnection, "connectionId" | "mcpName">) => {
    const name = conn.mcpName || conn.connectionId;
    if (!(await confirm({ title: t("abortAuthTitle", { name }), description: t("abortAuthDesc") }))) return;
    const ok = await disconnectConnection(conn, false);
    if (ok && connectModal?.connectionId === conn.connectionId) closeConnectModal();
  };

  const connectionIconByUrl = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const s of servers) {
      map.set(s.mcpUrl, s.iconUrl ?? null);
    }
    return map;
  }, [servers]);
  const getConnectionIconUrl = useCallback((conn: IntegrationConnection): string | null => {
    const byUrl = connectionIconByUrl.get(conn.mcpUrl);
    if (byUrl) return byUrl;
    const byName = servers.find((s) => conn.mcpName && s.displayName === conn.mcpName)?.iconUrl;
    return byName ?? null;
  }, [connectionIconByUrl, servers]);

  const catalogLoading = !initialLoaded && (serversLoading || skillsLoading);

  return (
    <AppShell embedded>
      <PageHeader title={t("title")} description={t("desc")} />

      <div className="space-y-6">
        {/* Connected */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className={SECTION_TITLE}>{t("connected")}</h2>
            {connections.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {connections.length} {connections.length === 1 ? t("integrationSingular") : t("integrationPlural")}
              </span>
            )}
          </div>
          {loadError ? (
            <div className={`box-modal border-destructive/20 p-5`}>
              <p className="text-sm text-destructive">{loadError}</p>
              <Button onClick={() => void loadConnections()} variant="outline" size="sm" className="mt-3">
                {t("retryLoad")}
              </Button>
            </div>
          ) : isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i} className={`box-modal p-4 animate-pulse`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-24 rounded bg-muted" />
                      <div className="h-2.5 w-16 rounded bg-muted" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : connections.length > 0 ? (
            <div className="space-y-3">
              {connections.map((conn) => (
                <div key={conn.connectionId} className={`box-modal p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
                  <div className="flex items-start gap-3">
                    <IntegrationIcon name={conn.mcpName || ""} iconUrl={getConnectionIconUrl(conn)} size={40} />
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{conn.mcpName || conn.connectionId}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conn.status === "connected" ? "bg-green-500" : conn.status === "error" ? "bg-red-500" : "bg-amber-500"}`} />
                        <span className="text-xs text-muted-foreground leading-relaxed">
                          {t(STATUS_LABEL_KEY[conn.status] ?? "statusUnknown")}
                        </span>
                      </div>
                      {conn.status === "error" && conn.errorMessage && (
                        <p className="mt-2 max-w-xl text-xs leading-relaxed text-red-600 dark:text-red-400">
                          {conn.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleDisconnect(conn)}
                    disabled={actionLoading === conn.connectionId}
                    variant="ghost"
                    size="sm"
                    className="justify-center sm:justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    {actionLoading === conn.connectionId ? t("disconnecting") : t("disconnect")}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className={`box-modal px-4 py-6 text-center`}>
              <p className="text-sm font-medium text-muted-foreground">{t("noConnections")}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t("desc")}</p>
            </div>
          )}
        </section>

        {/* Browse integrations */}
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className={SECTION_TITLE}>{t("addIntegration")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("browseIntegrationsDesc")}
              </p>
            </div>
            <div className="relative w-full sm:w-[320px]">
              <Input
              type="search"
              placeholder={t("searchIntegrations")}
              aria-label={t("searchIntegrations")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
              {(serversLoading || skillsLoading) && initialLoaded && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              )}
            </div>
          </div>
          {catalogError && (
            <div className={`box-modal border-destructive/20 p-4`}>
              <p className="text-sm text-destructive">{catalogError}</p>
              <Button onClick={() => void loadCatalog()} variant="outline" size="sm" className="mt-3">
                {t("retryLoad")}
              </Button>
            </div>
          )}

          {catalogLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {[...Array(12)].map((_, i) => (
                <div key={i} className={`box-modal p-4 flex flex-col items-center gap-2 animate-pulse`}>
                  <div className="w-12 h-12 rounded-xl bg-muted" />
                  <div className="h-3 w-20 rounded bg-muted" />
                  <div className="h-2.5 w-28 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : allIntegrations.length === 0 ? (
            <div className={`box-modal p-2`}>
              <EmptyState
                title={t("noIntegrationsFound")}
                description={searchDebounced ? t("searchIntegrations") : t("allSuggestedConnected")}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {pagedIntegrations.map((item) => {
                if (item.type === "mcp") {
                  const server = item.server;
                  return (
                    <button
                      key={`mcp-${server.mcpUrl}`}
                      onClick={() => openConnectModal(server)}
                      disabled={connectingMcp !== null}
                      className={`box-modal p-4 sm:p-5 flex flex-col items-center gap-3 hover:border-gray-300 dark:hover:border-gray-600 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed text-left relative`}
                    >
                      <span className="absolute top-3 right-3 text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium leading-none">MCP</span>
                      <IntegrationIcon name={server.displayName} iconUrl={server.iconUrl} size={48} />
                      <span className="font-medium text-sm line-clamp-1 w-full text-center">{server.displayName}</span>
                      {server.description && (
                        <span className="text-xs text-muted-foreground leading-relaxed line-clamp-2 w-full text-center">{server.description}</span>
                      )}
                      {connectingMcp === server.mcpUrl ? (
                        <span className="text-xs text-muted-foreground animate-pulse">{t("connecting")}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("connect")}</span>
                      )}
                    </button>
                  );
                }
                const skill = item.skill;
                return (
                  <a
                    key={`skill-${skill.namespace}/${skill.slug}`}
                    href={skill.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`box-modal p-4 sm:p-5 flex flex-col items-center gap-3 hover:border-gray-300 dark:hover:border-gray-600 hover:-translate-y-0.5 transition-all text-left relative`}
                  >
                    <span className="absolute top-3 right-3 text-xs px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium leading-none">Skill</span>
                    <IntegrationIcon name={skill.displayName} iconUrl={skill.iconUrl ?? null} size={48} />
                    <span className="font-medium text-sm line-clamp-1 w-full text-center">{skill.displayName}</span>
                    {skill.description && (
                      <span className="text-xs text-muted-foreground leading-relaxed line-clamp-2 w-full text-center">{skill.description}</span>
                    )}
                    {skill.categories.length > 0 && (
                      <span className="text-xs text-muted-foreground/60 line-clamp-1 w-full text-center">{skill.categories.join(", ")}</span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {t("learnMore")}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </a>
                );
              })}
            </div>
          )}
          {totalPages > 1 && !catalogLoading && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <Button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} variant="ghost" size="sm">
                {t("prevPage")}
              </Button>
              <span className="text-sm text-muted-foreground">{t("pageOf", { current: currentPage, total: totalPages })}</span>
              <Button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} variant="ghost" size="sm">
                {t("nextPage")}
              </Button>
            </div>
          )}
        </section>
      </div>

      {/* Connect / OAuth Modal */}
      <Dialog open={!!connectModal} onOpenChange={(open) => !open && closeConnectModal()}>
        <DialogContent className="w-[min(96vw,520px)] max-h-[calc(100vh-1rem)] overflow-hidden p-0 gap-0">
          {connectModal && (
            <>
              <DialogHeader className="gap-3 border-b border-border/60 px-4 py-4 pr-10 sm:px-5 sm:py-5 sm:pr-12 text-left">
                <div className="flex items-start gap-3">
                  <IntegrationIcon
                    name={connectModal.server.displayName}
                    iconUrl={connectModal.server.iconUrl}
                    size={40}
                  />
                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold leading-tight">
                      {connectModal.authUrl
                        ? t("authModalTitle")
                        : t("connectModalTitle", { name: connectModal.server.displayName })}
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-sm leading-relaxed break-words">
                      {connectModal.authUrl
                        ? t("authModalDesc", { name: connectModal.server.displayName })
                        : t("connectModalDesc", { name: connectModal.server.displayName })}
                    </DialogDescription>
                    <p className="mt-2 text-xs text-muted-foreground break-all">
                      {connectModal.server.displayName} · {connectModal.server.mcpUrl.replace(/^https?:\/\//, "")}
                    </p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5 overflow-y-auto">
                {connectModal.success ? (
                  <div className="rounded-2xl border border-green-200/70 bg-green-50 dark:border-green-900/60 dark:bg-green-950/30 flex items-center gap-2 px-4 py-3 text-sm text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{t("connectSuccess", { name: connectModal.server.displayName })}</span>
                  </div>
                ) : connectModal.authUrl ? (
                  <div className="space-y-4">
                    <div className="box-inset rounded-2xl px-4 py-3">
                      <p className="text-sm text-muted-foreground leading-relaxed">{t("authModalHint")}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        onClick={() => {
                          if (!connectModal?.connectionId) return;
                          handleAbortPendingAuthorization({
                            connectionId: connectModal.connectionId,
                            mcpName: connectModal.server.displayName,
                          });
                        }}
                        variant="ghost"
                        className="w-full max-w-full justify-center whitespace-normal break-words text-center h-auto py-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        {t("abortAuth")}
                      </Button>
                      <Button
                        onClick={handleVerifyAuthorization}
                        variant="outline"
                        disabled={connectingMcp === connectModal.server.mcpUrl}
                        className="w-full max-w-full justify-center whitespace-normal break-words text-center h-auto py-2"
                      >
                        {t("authModalResume")}
                      </Button>
                      <Button
                        onClick={handleOpenAuthUrl}
                        disabled={connectingMcp === connectModal.server.mcpUrl}
                        className="w-full max-w-full justify-center whitespace-normal break-words text-center h-auto py-2"
                      >
                        {t("authModalOpenBtn")}
                      </Button>
                    </div>
                  </div>
                ) : connectModal.detailLoading ? (
                  <div className="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground">
                    <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                    <span>{t("loadingConfig")}</span>
                  </div>
                ) : connectModal.configFields.length > 0 ? (
                  <div className="space-y-4">
                    {connectModal.configFields.map((f) => (
                      <div key={f.key}>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          {f.label || f.key}
                          {f.required && <span className="text-red-400 ml-0.5">*</span>}
                        </label>
                        <Input
                          type={/secret|key|token|password/i.test(f.key) ? "password" : "text"}
                          value={connectModal.credentials[f.key] || ""}
                          onChange={(e) => setConnectModal((prev) => prev ? { ...prev, credentials: { ...prev.credentials, [f.key]: e.target.value } } : null)}
                          placeholder={f.description || ""}
                          className="h-9 rounded-xl"
                        />
                      </div>
                    ))}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button onClick={closeConnectModal} variant="ghost" className="w-full max-w-full justify-center whitespace-normal break-words text-center h-auto py-2">
                        {tc("cancel")}
                      </Button>
                      <Button onClick={() => handleConnectSubmit(true)} disabled={connectingMcp !== null} className="w-full max-w-full justify-center whitespace-normal break-words text-center h-auto py-2">
                      {connectingMcp ? t("connecting") : t("connect")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t("connectModalDesc", { name: connectModal.server.displayName })}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button onClick={closeConnectModal} variant="ghost" className="w-full max-w-full justify-center whitespace-normal break-words text-center h-auto py-2">
                        {tc("cancel")}
                      </Button>
                      <Button onClick={() => handleConnectSubmit(false)} disabled={connectingMcp !== null} className="w-full max-w-full justify-center whitespace-normal break-words text-center h-auto py-2">
                      {connectingMcp ? t("connecting") : t("connect")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// ── Shared icon component ───────────────────────────────────

function IntegrationIcon({ name, iconUrl, size }: { name: string; iconUrl: string | null; size: number }) {
  const px = `${size}px`;
  const rounding = size >= 40 ? "rounded-xl" : "rounded-lg";
  return (
    <div className={`${rounding} border border-gray-200/80 dark:border-border/60 flex items-center justify-center bg-gray-50/50 dark:bg-card/30 overflow-hidden p-1.5 shrink-0 relative`} style={{ width: px, height: px }}>
      <span className="text-lg font-medium text-muted-foreground flex items-center justify-center w-full h-full">
        {name.charAt(0).toUpperCase()}
      </span>
      {iconUrl && (
        <img
          src={iconUrl}
          alt=""
          className="w-full h-full object-contain absolute inset-0 p-1.5 bg-inherit"
          onError={(e) => {
            e.currentTarget.style.opacity = "0";
          }}
        />
      )}
    </div>
  );
}
