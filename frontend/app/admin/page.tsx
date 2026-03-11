'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Users, Bot, Search, RefreshCw, LogOut, Zap,
  AlertTriangle, ArrowUpRight, Building2,
  UserCircle, ChevronRight,
} from 'lucide-react';

const API = '/api/admin';

function useAdmin() {
  const [key, setKey] = useState('');
  const [authed, setAuthed] = useState(false);
  useEffect(() => { const s = localStorage.getItem('admin_key'); if (s) { setKey(s); setAuthed(true); } }, []);
  const login = (k: string) => { localStorage.setItem('admin_key', k); setKey(k); setAuthed(true); };
  const logout = () => { localStorage.removeItem('admin_key'); setKey(''); setAuthed(false); };
  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(`${API}${path}`, { ...opts, headers: { 'x-admin-key': key, 'Content-Type': 'application/json', ...opts?.headers } });
    if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
    return res.json();
  }, [key]);
  return { authed, login, logout, api };
}

export default function AdminPage() {
  const { authed, login, logout, api } = useAdmin();
  const [tab, setTab] = useState<'dashboard' | 'kunden' | 'agents'>('dashboard');
  const [dash, setDash] = useState<any>(null);
  const [orgs, setOrgs] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginVal, setLoginVal] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const refresh = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      const [d, o, a] = await Promise.all([api('/dashboard'), api('/orgs'), api('/agents')]);
      setDash(d); setOrgs(o); setAgents(a.agents || []);
    } catch {}
    setLoading(false);
  }, [authed, api]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!search.trim() || !authed) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try { const d = await api(`/search?q=${encodeURIComponent(search)}`); setSearchResults(d.results || []); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [search, authed, api]);

  const quickActivate = async (ownerKey: string, name: string) => {
    try {
      await api('/quick-activate', { method: 'POST', body: JSON.stringify({ ownerKey, days: 30 }) });
      showToast(`${name} → Professional (30d)`);
      refresh();
    } catch (e: any) { showToast(`Error: ${e.message}`); }
  };

  if (!authed) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="card w-80 p-8 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Zap className="w-4 h-4 text-primary" /></div>
          <div><div className="text-sm font-medium">Admin</div><div className="text-xs text-muted-foreground">Internal Dashboard</div></div>
        </div>
        <input type="password" placeholder="API Key" value={loginVal}
          onChange={e => setLoginVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loginVal && login(loginVal)}
          className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground" />
        <button onClick={() => loginVal && login(loginVal)} className="btn-primary-sm w-full">Login</button>
      </div>
    </div>
  );

  const customers = (orgs?.orgs || []).map((o: any) => ({
    ...o, key: o.clerkId, plan: o.subscription?.plan, trialEndsAt: o.trialEndsAt || o.subscription?.trialEndsAt,
  }));

  const tabs = [
    { id: 'dashboard' as const, icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'kunden' as const, icon: Users, label: 'Kunden' },
    { id: 'agents' as const, icon: Bot, label: 'Agents' },
  ];

  const alertCount = dash?.alerts?.expiredTrials?.length || 0;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 card px-4 py-3 text-sm shadow-lg flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Zap className="w-4 h-4 text-primary" /></div>
          <div>
            <h1 className="text-lg font-medium">Admin</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Internal Dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { api('/metrics/force-sync', { method: 'POST' }); refresh(); }}
            className="btn-ghost-sm gap-1.5"><RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />Sync</button>
          <button onClick={logout} className="btn-ghost-sm gap-1.5"><LogOut className="w-3 h-3" /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.id ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.id === 'kunden' && customers.length > 0 && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full ml-1">{customers.length}</span>}
            {t.id === 'agents' && agents.length > 0 && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full ml-1">{agents.length}</span>}
            {t.id === 'dashboard' && alertCount > 0 && <span className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full ml-1">{alertCount}</span>}
          </button>
        ))}
      </div>

      {/* ═══ DASHBOARD ═══ */}
      {tab === 'dashboard' && dash && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { icon: Building2, label: 'Orgs', value: dash.stats.orgs },
              { icon: UserCircle, label: 'Users', value: dash.stats.users },
              { icon: Bot, label: 'Agents', value: dash.stats.agents, sub: `${dash.stats.running} aktiv` },
              { icon: AlertTriangle, label: 'Alerts', value: alertCount, warn: alertCount > 0 },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <s.icon className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</span>
                </div>
                <div className={`text-2xl font-mono font-medium ${s.accent ? 'text-emerald-600 dark:text-emerald-400' : ''} ${s.warn ? 'text-amber-600 dark:text-amber-400' : ''}`}>{s.value}</div>
                {s.sub && <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Alerts */}
            <div className="card">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-sm font-medium">Attention</span>
                {alertCount > 0 && <span className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">{alertCount}</span>}
              </div>
              <div className="divide-y divide-border">
                {(dash.alerts.expiredTrials || []).map((o: any) => (
                  <div key={o.clerkId} className="px-5 py-3 flex items-center justify-between group">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm">{o.name}</span>
                      <span className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-md">abgelaufen</span>
                    </div>
                    <button onClick={() => quickActivate(o.clerkId, o.name)}
                      className="text-xs text-primary hover:underline flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Activate <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {alertCount === 0 && <div className="px-5 py-10 text-center text-muted-foreground text-sm">Alles gut 👍</div>}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ═══ KUNDEN ═══ */}
      {tab === 'kunden' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Suchen: Email, Name, Organisation..."
              className="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground" />
          </div>

          {searchResults.length > 0 && (
            <div className="card">
              <div className="px-5 py-3 border-b border-border text-sm font-medium flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                {searchResults.length} Ergebnisse
              </div>
              <div className="divide-y divide-border">
                {searchResults.map((r: any) => (
                  <div key={r.key} className="px-5 py-3 flex items-center justify-between group">
                    <div className="flex items-center gap-2.5">
                      {r.type === 'org' ? <Building2 className="w-3.5 h-3.5 text-blue-500" /> : <UserCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                      <span className="text-sm font-medium">{r.name}</span>
                      {r.type === 'org' && (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${r.plan === 'professional' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                          {r.plan || 'unpaid'}
                        </span>
                      )}
                    </div>
                    {r.type === 'org' ? (
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => quickActivate(r.key, r.name)}
                          className="btn-primary-sm gap-1"><Zap className="w-3 h-3" />Activate</button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">Org aktivieren <ChevronRight className="w-3 h-3" /></span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Customers */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">Organisationen</span>
              </div>
              <span className="text-xs text-muted-foreground">{customers.length}</span>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 text-left font-medium">Organisation</th>
                <th className="px-5 py-2.5 text-left font-medium">Plan</th>
                <th className="px-5 py-2.5 text-left font-medium">Läuft bis</th>
                <th className="px-5 py-2.5 w-20"></th>
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {customers.map((o: any) => {
                  const expired = o.trialEndsAt && new Date(o.trialEndsAt).getTime() < Date.now();
                  return (
                    <tr key={o.key} className="hover:bg-accent/50 transition-colors group">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium">{o.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${
                          o.plan === 'professional' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                          'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}>{o.plan || 'unpaid'}</span>
                      </td>
                      <td className="px-5 py-3">
                        {o.trialEndsAt ? (
                          <span className={`text-xs font-mono ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {new Date(o.trialEndsAt).toLocaleDateString('de-DE')}
                          </span>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {o.plan !== 'professional' && (
                          <button onClick={() => quickActivate(o.key, o.name)}
                            className="btn-primary-sm gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Zap className="w-3 h-3" />Activate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {customers.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">Keine Organisationen</td></tr>}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ═══ AGENTS ═══ */}
      {tab === 'agents' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Alle Agents</span>
            </div>
            <span className="text-xs text-muted-foreground">{agents.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-5 py-2.5 text-left font-medium">Name</th>
              <th className="px-5 py-2.5 text-left font-medium">Status</th>
              <th className="px-5 py-2.5 text-left font-medium">Owner</th>
              <th className="px-5 py-2.5 w-20"></th>
            </tr></thead>
            <tbody className="divide-y divide-border/50">
              {agents.map((a: any) => (
                <tr key={a._id} className="hover:bg-accent/50 transition-colors group">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium">{a.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        a.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'
                      }`} />
                      <span className="text-xs text-muted-foreground">{a.status}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground font-mono text-xs">{a.organizationId || a.userId}</td>
                  <td className="px-5 py-3 text-right"></td>
                </tr>
              ))}
              {agents.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">Keine Agents</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
