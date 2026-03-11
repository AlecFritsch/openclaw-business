import type { 
  Agent, 
  AgentConfig,
  AgentTeamMember,
  CreateAgentRequest,
  Session,
  CreateSessionRequest,
  SendMessageRequest,
  Message,
  Channel,
  CreateChannelRequest,
  UpdateChannelRequest,
  User,
  Organization,
  Log,
  LogQuery,
  Template,
  CreateTemplateRequest,
  DeployFromTemplateRequest,
  ActivityEvent,
  OperationsOverview,
  SupportTicket,
  CreateSupportTicketRequest,
  Invoice,
  AuditEntry,
  AuditStatsResponse,
  AuditIntegrityResult,
  AuditComplianceReport,
  SmitheryConnection,
  SmitheryServer,
  SmitherySkill,
  SmitheryConnectRequest,
  SmitheryConnectResponse,
} from '@openclaw-business/shared';

// Use relative path — Next.js rewrites proxy /api/* to the backend server-side.
// This eliminates CORS entirely (browser only talks to Next.js, same origin).
// Falls back to explicit URL only if NEXT_PUBLIC_API_URL is set (legacy/testing).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

class ApiClient {
  /** Maximum retries for transient errors (5xx, network errors) */
  private maxRetries = 2;
  
  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
    token?: string
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {};

        // Only set Content-Type for requests that have a body
        if (options.body) {
          headers['Content-Type'] = 'application/json';
        }

        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        if (options.headers) {
          Object.assign(headers, options.headers);
        }

        const response = await fetch(`${API_BASE}${endpoint}`, {
          ...options,
          headers,
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Request failed' }));
          const err = new Error(error.error || 'Request failed') as Error & { status: number };
          err.status = response.status;
          
          // 401 Unauthorized — throw a typed error so callers can decide what to do.
          // We do NOT redirect here — Clerk middleware handles truly unauthenticated
          // users at the routing level, and a 401 on a background fetch (e.g. polling,
          // model list) should not silently navigate the user away mid-flow.
          if (response.status === 401) {
            (err as any).isAuthError = true;
            throw err;
          }
          
          // 4xx (non-401) — don't retry, client error
          if (response.status >= 400 && response.status < 500) {
            throw err;
          }
          
          // 5xx — retry with backoff
          lastError = err;
          if (attempt < this.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
          throw err;
        }

        return response.json();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Network errors — retry with backoff
        const isNetworkError = lastError.message === 'Failed to fetch' || lastError.message.includes('NetworkError') || lastError.message.includes('ECONNRESET') || lastError.message.includes('socket hang up');
        if (isNetworkError && attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        
        throw lastError;
      }
    }
    
    throw lastError || new Error('Request failed after retries');
  }

  // ── Users ──────────────────────────────────────────────

  async getCurrentUser(token: string): Promise<{ user: User }> {
    return this.fetch('/users/me', {}, token);
  }

  async updateUser(token: string, data: Partial<User>): Promise<{ success: boolean }> {
    return this.fetch('/users/me', { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async getApiKeys(token: string): Promise<{ apiKeys: any[] }> {
    return this.fetch('/users/me/api-keys', {}, token);
  }

  async createApiKey(token: string, name: string): Promise<{ apiKey: any }> {
    return this.fetch('/users/me/api-keys', { method: 'POST', body: JSON.stringify({ name }) }, token);
  }

  async deleteApiKey(token: string, keyId: string): Promise<{ success: boolean }> {
    return this.fetch(`/users/me/api-keys/${keyId}`, { method: 'DELETE' }, token);
  }

  // ── Agents ─────────────────────────────────────────────

  async getAgents(token: string): Promise<{ agents: Agent[] }> {
    return this.fetch('/agents', {}, token);
  }

  async getAgent(token: string, agentId: string): Promise<{ agent: Agent }> {
    return this.fetch(`/agents/${agentId}`, {}, token);
  }

  async getAgentAnalytics(token: string, agentId: string): Promise<any> {
    return this.fetch(`/agents/${agentId}/analytics`, {}, token);
  }

  async getAgentConfiguration(token: string, agentId: string): Promise<{ configuration: Partial<AgentConfig> }> {
    return this.fetch(`/agents/${agentId}/configuration`, {}, token);
  }

  async updateAgentConfiguration(token: string, agentId: string, config: any): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/configuration`, { method: 'PATCH', body: JSON.stringify(config) }, token);
  }

  async getAgentTeam(token: string, agentId: string): Promise<{ team: AgentTeamMember[] }> {
    return this.fetch(`/agents/${agentId}/team`, {}, token);
  }

  async addAgentTeamMember(token: string, agentId: string, data: any): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/team`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async removeAgentTeamMember(token: string, agentId: string, memberId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/team/${memberId}`, { method: 'DELETE' }, token);
  }

  async updateAgentTeamMember(token: string, agentId: string, memberId: string, data: any): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/team/${memberId}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  /** Smithery Connect: Create MCP connection, returns auth URL if OAuth needed */
  async smitheryConnect(token: string, data: SmitheryConnectRequest): Promise<SmitheryConnectResponse> {
    return this.fetch('/smithery/connect', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  /** Smithery: Get server details including configSchema */
  async smitheryServerDetail(token: string, qualifiedName: string): Promise<import('@openclaw-business/shared').SmitheryServerDetail> {
    return this.fetch(`/smithery/servers/${encodeURIComponent(qualifiedName)}`, {}, token);
  }

  /** Smithery: Search verified MCP servers */
  async smitheryServers(token: string, params?: { q?: string; pageSize?: number }): Promise<{
    servers: SmitheryServer[];
    pagination: { currentPage: number; pageSize: number; totalPages: number; totalCount: number };
  }> {
    const query = new URLSearchParams();
    if (params?.q) query.set('q', params.q);
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.fetch(`/smithery/servers?${query}`, {}, token);
  }

  /** Smithery: List MCP connections */
  async smitheryConnections(token: string): Promise<{ connections: SmitheryConnection[] }> {
    return this.fetch('/smithery/connections', {}, token);
  }

  /** Smithery: Disconnect MCP */
  async smitheryDisconnect(token: string, connectionId: string): Promise<{ ok: boolean }> {
    return this.fetch(`/smithery/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' }, token);
  }

  /** Smithery: List verified skills */
  async smitherySkills(token: string, params?: { q?: string; page?: number; pageSize?: number }): Promise<{
    skills: SmitherySkill[];
    pagination: { currentPage: number; pageSize: number; totalPages: number; totalCount: number };
  }> {
    const query = new URLSearchParams();
    if (params?.q) query.set('q', params.q);
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.fetch(`/smithery/skills?${query}`, {}, token);
  }

  // ── Missions ──

  async createMission(token: string, agentId: string, data: import('@openclaw-business/shared').CreateMissionRequest): Promise<{ mission: import('@openclaw-business/shared').Mission }> {
    return this.fetch(`/agents/${agentId}/missions`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async listMissions(token: string, agentId: string): Promise<{ missions: import('@openclaw-business/shared').Mission[] }> {
    return this.fetch(`/agents/${agentId}/missions`, {}, token);
  }

  async getMission(token: string, agentId: string, missionId: string): Promise<{ mission: import('@openclaw-business/shared').Mission; runs: import('@openclaw-business/shared').MissionRun[] }> {
    return this.fetch(`/agents/${agentId}/missions/${missionId}`, {}, token);
  }

  async updateMission(token: string, agentId: string, missionId: string, data: import('@openclaw-business/shared').UpdateMissionRequest): Promise<{ mission: import('@openclaw-business/shared').Mission }> {
    return this.fetch(`/agents/${agentId}/missions/${missionId}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async deleteMission(token: string, agentId: string, missionId: string): Promise<{ ok: boolean }> {
    return this.fetch(`/agents/${agentId}/missions/${missionId}`, { method: 'DELETE' }, token);
  }

  async runMission(token: string, agentId: string, missionId: string): Promise<{ runId: string }> {
    return this.fetch(`/agents/${agentId}/missions/${missionId}/run`, { method: 'POST' }, token);
  }

  /** Architect → Workspace Pipeline: Apply config (create or update agent) */
  async applyArchitectConfig(token: string, config: CreateAgentRequest, agentId?: string): Promise<{ agent: Agent; created: boolean }> {
    return this.fetch('/agents/apply-architect-config', {
      method: 'POST',
      body: JSON.stringify({ config, agentId }),
    }, token);
  }

  async createAgent(token: string, data: CreateAgentRequest): Promise<{ agent: Agent }> {
    return this.fetch('/agents', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async pauseAgent(token: string, agentId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/pause`, { method: 'POST' }, token);
  }

  async resumeAgent(token: string, agentId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/resume`, { method: 'POST' }, token);
  }

  async redeployAgent(token: string, agentId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/redeploy`, { method: 'POST' }, token);
  }

  async updateAgent(token: string, agentId: string, data: { name?: string; description?: string; config?: Record<string, unknown> }): Promise<{ agent: any }> {
    return this.fetch(`/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async deleteAgent(token: string, agentId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}`, { method: 'DELETE' }, token);
  }

  // ── Sessions ───────────────────────────────────────────

  async getSessions(
    token: string,
    params?: { agentId?: string; status?: string; limit?: number; offset?: number }
  ): Promise<{ sessions: Session[]; total: number }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/sessions?${query}`, {}, token);
  }

  async getSession(token: string, sessionId: string): Promise<{ session: Session }> {
    return this.fetch(`/sessions/${sessionId}`, {}, token);
  }

  async createSession(token: string, data: CreateSessionRequest): Promise<{ session: Session }> {
    return this.fetch('/sessions', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async getSessionMessages(
    token: string,
    sessionId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{ messages: Message[]; total: number }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/sessions/${sessionId}/messages?${query}`, {}, token);
  }

  async sendMessage(token: string, sessionId: string, data: SendMessageRequest): Promise<{ message: Message }> {
    return this.fetch(`/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async endSession(token: string, sessionId: string): Promise<{ success: boolean }> {
    return this.fetch(`/sessions/${sessionId}/end`, { method: 'POST' }, token);
  }

  // ── Channels ───────────────────────────────────────────

  async getChannels(
    token: string,
    params?: { agentId?: string; type?: string; status?: string }
  ): Promise<{ channels: Channel[] }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/channels?${query}`, {}, token);
  }

  async getChannel(token: string, channelId: string): Promise<{ channel: Channel }> {
    return this.fetch(`/channels/${channelId}`, {}, token);
  }

  async createChannel(token: string, data: CreateChannelRequest): Promise<{ channel: Channel }> {
    return this.fetch('/channels', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async updateChannel(token: string, channelId: string, data: UpdateChannelRequest): Promise<{ success: boolean }> {
    return this.fetch(`/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async deleteChannel(token: string, channelId: string): Promise<{ success: boolean }> {
    return this.fetch(`/channels/${channelId}`, { method: 'DELETE' }, token);
  }

  // ── Logs ───────────────────────────────────────────────

  async getLogs(token: string, params?: LogQuery): Promise<{ logs: Log[]; total: number }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/logs?${query}`, {}, token);
  }

  // ── Analytics ──────────────────────────────────────────

  async getAnalytics(token: string): Promise<any> {
    return this.fetch('/analytics', {}, token);
  }

  // ── Webhooks ───────────────────────────────────────────

  async getWebhooks(token: string, params?: { agentId?: string }): Promise<{ webhooks: Array<{ id: string; url: string; events: string[]; agentId?: string; status: string; createdAt: Date }> }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/webhooks?${query}`, {}, token);
  }

  async createWebhook(token: string, data: any): Promise<{ webhook: any }> {
    return this.fetch('/webhooks', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async deleteWebhook(token: string, webhookId: string): Promise<{ success: boolean }> {
    return this.fetch(`/webhooks/${webhookId}`, { method: 'DELETE' }, token);
  }

  // ── Organization ───────────────────────────────────────

  async getOrganization(token: string): Promise<{ organization: Organization }> {
    return this.fetch('/organization', {}, token);
  }

  async updateOrganization(token: string, data: any): Promise<{ success: boolean }> {
    return this.fetch('/organization', { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async getTeamMembers(token: string): Promise<{ members: any[] }> {
    return this.fetch('/organization/members', {}, token);
  }

  async inviteTeamMember(token: string, email: string, role: string): Promise<{ success: boolean }> {
    return this.fetch('/organization/members', { method: 'POST', body: JSON.stringify({ email, role }) }, token);
  }

  async removeTeamMember(token: string, memberId: string): Promise<{ success: boolean }> {
    return this.fetch(`/organization/members/${memberId}`, { method: 'DELETE' }, token);
  }

  async updateMemberRole(token: string, memberId: string, role: string): Promise<{ success: boolean }> {
    return this.fetch(`/organization/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) }, token);
  }

  // ── Billing ────────────────────────────────────────────

  async getUsage(token: string): Promise<{ usage: import('@openclaw-business/shared').BillingUsage }> {
    return this.fetch('/billing/usage', {}, token);
  }

  async getSubscription(token: string): Promise<{ subscription: { plan: string; status: string; currentPeriodEnd?: string } }> {
    return this.fetch('/billing/subscription', {}, token);
  }

  async createCheckout(token: string): Promise<{ url: string }> {
    return this.fetch('/billing/create-checkout', { method: 'POST' }, token);
  }

  /** Havoc Basis: 200€ + optional setup fee (Sales-Call-Flow) */
  async createBasisCheckout(token: string, setupFeeEur?: number): Promise<{ url: string }> {
    return this.fetch('/billing/create-basis-checkout', {
      method: 'POST',
      body: JSON.stringify({ setupFeeEur: setupFeeEur ?? 0 }),
    }, token);
  }

  async createPortal(token: string): Promise<{ url: string }> {
    return this.fetch('/billing/create-portal', { method: 'POST' }, token);
  }

  async getInvoices(token: string): Promise<{ invoices: Invoice[] }> {
    return this.fetch('/billing/invoices', {}, token);
  }

  // ── Workflows (Lobster) ──────────────────────────────

  async getAgentWorkflows(token: string, agentId: string): Promise<{ workflows: any[] }> {
    return this.fetch(`/agents/${agentId}/workflows`, {}, token);
  }

  async createAgentWorkflow(token: string, agentId: string, data: { name: string; description?: string; content?: string; steps?: any[] }): Promise<{ workflow: any }> {
    return this.fetch(`/agents/${agentId}/workflows`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async updateAgentWorkflow(token: string, agentId: string, workflowId: string, data: any): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/workflows/${workflowId}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async deleteAgentWorkflow(token: string, agentId: string, workflowId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/workflows/${workflowId}`, { method: 'DELETE' }, token);
  }

  async runAgentWorkflow(token: string, agentId: string, workflowId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/workflows/${workflowId}/run`, { method: 'POST' }, token);
  }

  async generateWorkflow(token: string, agentId: string, data: { prompt: string; context?: string }): Promise<{ workflow: any }> {
    return this.fetch(`/agents/${agentId}/workflows/generate`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async syncWorkflows(token: string, agentId: string): Promise<{ synced: number; workflows: any[] }> {
    return this.fetch(`/agents/${agentId}/workflows/sync`, { method: 'POST' }, token);
  }

  async getWorkflowRuns(token: string, agentId: string, workflowId: string, limit = 10): Promise<{ runs: any[] }> {
    return this.fetch(`/agents/${agentId}/workflows/${workflowId}/runs?limit=${limit}`, {}, token);
  }

  async approveWorkflowRun(token: string, agentId: string, workflowId: string, runId: string, approved: boolean): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/workflows/${workflowId}/runs/${runId}/approve`, { method: 'POST', body: JSON.stringify({ approved }) }, token);
  }

  async getWorkflowTemplates(token: string, agentId: string): Promise<{ templates: any[] }> {
    return this.fetch(`/agents/${agentId}/workflows/templates`, {}, token);
  }

  async createWorkflowFromTemplate(token: string, agentId: string, templateId: string, name?: string): Promise<{ workflow: any }> {
    return this.fetch(`/agents/${agentId}/workflows/from-template`, { method: 'POST', body: JSON.stringify({ templateId, name }) }, token);
  }

  // ── Operations ─────────────────────────────────────────

  async getOperationsOverview(token: string): Promise<OperationsOverview> {
    return this.fetch('/operations/overview', {}, token);
  }

  // ── Activity Feed ──────────────────────────────────────

  async getActivity(
    token: string,
    params?: { agentId?: string; type?: string; limit?: number; offset?: number }
  ): Promise<{ events: ActivityEvent[]; total: number }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/activity?${query}`, {}, token);
  }

  // ── Templates / Marketplace ────────────────────────────

  async getTemplates(
    token: string,
    params?: { category?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ templates: Template[]; total: number }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/templates?${query}`, {}, token);
  }

  async getTemplate(token: string, templateId: string): Promise<{ template: Template }> {
    return this.fetch(`/templates/${templateId}`, {}, token);
  }

  async createTemplate(token: string, data: CreateTemplateRequest): Promise<{ template: Template }> {
    return this.fetch('/templates', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async deleteTemplate(token: string, templateId: string): Promise<{ success: boolean }> {
    return this.fetch(`/templates/${templateId}`, { method: 'DELETE' }, token);
  }

  async deployFromTemplate(token: string, templateId: string, data?: DeployFromTemplateRequest): Promise<{ agent: Agent }> {
    return this.fetch(`/templates/${templateId}/deploy`, { method: 'POST', body: JSON.stringify(data || {}) }, token);
  }


  // ── Support ────────────────────────────────────────────

  async getSupportTickets(
    token: string,
    params?: { status?: string; limit?: number; offset?: number }
  ): Promise<{ tickets: SupportTicket[]; total: number }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/support/tickets?${query}`, {}, token);
  }

  async createSupportTicket(token: string, data: CreateSupportTicketRequest): Promise<{ ticket: SupportTicket }> {
    return this.fetch('/support/tickets', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async getSupportTicket(token: string, ticketId: string): Promise<{ ticket: SupportTicket }> {
    return this.fetch(`/support/tickets/${ticketId}`, {}, token);
  }

  async addSupportMessage(token: string, ticketId: string, content: string, isAgent?: boolean): Promise<{ message: any }> {
    return this.fetch(`/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, isAgent }),
    }, token);
  }

  async updateSupportTicket(token: string, ticketId: string, data: any): Promise<{ success: boolean }> {
    return this.fetch(`/support/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  // ── Agent Channels (OpenClaw) ───────────────────────────────

  async getAgentChannels(token: string, agentId: string): Promise<{ channels: any[] }> {
    return this.fetch(`/agents/${agentId}/channels`, {}, token);
  }

  async addAgentChannel(token: string, agentId: string, data: {
    type: string;
    credentials?: Record<string, string>;
    dmPolicy?: string;
    allowFrom?: string[];
    groupPolicy?: string;
    groupAllowFrom?: string[];
  }): Promise<{ channel: any }> {
    return this.fetch(`/agents/${agentId}/channels`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async updateAgentChannel(token: string, agentId: string, channelType: string, data: {
    name?: string;
    dmPolicy?: string;
    allowFrom?: string[];
    groupPolicy?: string;
    groupAllowFrom?: string[];
    [key: string]: unknown;
  }): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/channels/${channelType}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async removeAgentChannel(token: string, agentId: string, channelType: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/channels/${channelType}`, { method: 'DELETE' }, token);
  }

  /** Superchat live channels (WhatsApp, Instagram, etc.) from Superchat API */
  async getSuperchatChannels(token: string, agentId: string): Promise<{ channels: Array<{ type: string; id: string; name?: string; inbox?: { id: string; name?: string }; url?: string }> }> {
    return this.fetch(`/agents/${agentId}/channels/superchat/live`, {}, token);
  }

  // ── Gateway (Live Dashboard) ────────────────────────────────

  async getGatewayHealth(token: string, agentId: string): Promise<{ health: any }> {
    return this.fetch(`/agents/${agentId}/gateway/health`, {}, token);
  }

  async getGatewaySessions(token: string, agentId: string): Promise<{ sessions: any[] }> {
    return this.fetch(`/agents/${agentId}/gateway/sessions`, {}, token);
  }

  async getSessionHistory(token: string, agentId: string, sessionKey: string, limit?: number): Promise<{ messages: any[] }> {
    const params = new URLSearchParams({ sessionKey });
    if (limit) params.set('limit', String(limit));
    return this.fetch(`/agents/${agentId}/gateway/history?${params}`, {}, token);
  }

  async sendGatewayMessage(token: string, agentId: string, sessionKey: string, text: string): Promise<{ success: boolean; runId?: string }> {
    return this.fetch(`/agents/${agentId}/gateway/send`, { method: 'POST', body: JSON.stringify({ sessionKey, text }) }, token);
  }

  async getGatewayLogs(token: string, agentId: string, lines?: number): Promise<{ logs: string }> {
    const query = lines ? `?lines=${lines}` : '';
    return this.fetch(`/agents/${agentId}/gateway/logs${query}`, {}, token);
  }

  async getGatewayStats(token: string, agentId: string): Promise<{ stats: any; status: string }> {
    return this.fetch(`/agents/${agentId}/gateway/stats`, {}, token);
  }

  async getGatewayCronJobs(token: string, agentId: string): Promise<{ jobs: any[] }> {
    return this.fetch(`/agents/${agentId}/gateway/cron`, {}, token);
  }

  async addGatewayCronJob(token: string, agentId: string, data: { name: string; schedule?: string; at?: string; every?: string; message?: string; delivery?: { mode: 'webhook'; url: string } }): Promise<{ jobId: string }> {
    return this.fetch(`/agents/${agentId}/gateway/cron`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async removeGatewayCronJob(token: string, agentId: string, jobId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/cron/${jobId}`, { method: 'DELETE' }, token);
  }

  async runGatewayCronJob(token: string, agentId: string, jobId: string, force?: boolean): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/cron/${jobId}/run`, { method: 'POST', body: JSON.stringify({ force }) }, token);
  }

  async enableGatewayCronJob(token: string, agentId: string, jobId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/cron/${jobId}/enable`, { method: 'POST' }, token);
  }

  async disableGatewayCronJob(token: string, agentId: string, jobId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/cron/${jobId}/disable`, { method: 'POST' }, token);
  }

  async getGatewayCronRuns(token: string, agentId: string, jobId: string, limit?: number): Promise<{ runs: any[] }> {
    const query = limit ? `?limit=${limit}` : '';
    return this.fetch(`/agents/${agentId}/gateway/cron/${jobId}/runs${query}`, {}, token);
  }

  // ── Gateway Config RPC ─────────────────────────────────────────

  async getGatewayConfig(token: string, agentId: string): Promise<{ config: any; hash: string }> {
    return this.fetch(`/agents/${agentId}/gateway/config`, {}, token);
  }

  async patchGatewayConfig(token: string, agentId: string, data: { raw: string; baseHash: string; sessionKey?: string; restartDelayMs?: number }): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/config`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async applyGatewayConfig(token: string, agentId: string, data: { raw: string; baseHash?: string; sessionKey?: string; restartDelayMs?: number }): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/config`, { method: 'PUT', body: JSON.stringify(data) }, token);
  }

  async getGatewayConfigSchema(token: string, agentId: string): Promise<{ schema: any }> {
    return this.fetch(`/agents/${agentId}/gateway/config/schema`, {}, token);
  }

  // ── Gateway Skills RPC ─────────────────────────────────────────

  async getGatewaySkills(token: string, agentId: string): Promise<{ skills: any }> {
    return this.fetch(`/agents/${agentId}/gateway/skills`, {}, token);
  }

  async installGatewaySkill(token: string, agentId: string, slug: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/skills/${slug}/install`, { method: 'POST' }, token);
  }

  async updateGatewaySkill(token: string, agentId: string, slug: string, data: { enabled?: boolean; apiKey?: string; env?: Record<string, string> }): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/skills/${slug}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  // ── Gateway Chat Controls ──────────────────────────────────────

  async abortGatewayChat(token: string, agentId: string, sessionKey: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/chat/abort`, { method: 'POST', body: JSON.stringify({ sessionKey }) }, token);
  }

  async injectGatewayChat(token: string, agentId: string, sessionKey: string, text: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/chat/inject`, { method: 'POST', body: JSON.stringify({ sessionKey, text }) }, token);
  }

  // ── Gateway System ─────────────────────────────────────────────

  async getGatewayModels(token: string, agentId: string): Promise<{ models: any }> {
    return this.fetch(`/agents/${agentId}/gateway/models`, {}, token);
  }

  async getGatewayStatus(token: string, agentId: string): Promise<{ status: any }> {
    return this.fetch(`/agents/${agentId}/gateway/status`, {}, token);
  }

  async getGatewayChannelsStatus(token: string, agentId: string): Promise<{ channels: any }> {
    return this.fetch(`/agents/${agentId}/gateway/channels/status`, {}, token);
  }

  async getGatewayPresence(token: string, agentId: string): Promise<{ presence: any }> {
    return this.fetch(`/agents/${agentId}/gateway/presence`, {}, token);
  }

  async getGatewayNodes(token: string, agentId: string): Promise<{ nodes: any }> {
    return this.fetch(`/agents/${agentId}/gateway/nodes`, {}, token);
  }

  async getGatewayLogsTail(token: string, agentId: string, params?: { lines?: number; filter?: string }): Promise<{ logs: any }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/agents/${agentId}/gateway/logs/tail?${query}`, {}, token);
  }

  async patchGatewaySession(token: string, agentId: string, sessionKey: string, data: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/sessions/${encodeURIComponent(sessionKey)}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  // ── Workspace (Persona Files) ──────────────────────────────────

  async getPersonaFiles(token: string, agentId: string): Promise<{ files: { filename: string; content: string; size: number }[] }> {
    return this.fetch(`/agents/${agentId}/workspace/persona`, {}, token);
  }

  async getWorkspaceFile(token: string, agentId: string, filename: string): Promise<{ file: { filename: string; content: string; size: number } }> {
    return this.fetch(`/agents/${agentId}/workspace/file/${encodeURIComponent(filename)}`, {}, token);
  }

  async writeWorkspaceFile(token: string, agentId: string, filename: string, content: string): Promise<{ success: boolean; version?: number }> {
    return this.fetch(`/agents/${agentId}/workspace/file/${encodeURIComponent(filename)}`, { method: 'PUT', body: JSON.stringify({ content }) }, token);
  }

  async getFileVersions(token: string, agentId: string, filename: string, limit = 50, skip = 0): Promise<{ versions: any[]; total: number; filename: string }> {
    return this.fetch(`/agents/${agentId}/workspace/file/${encodeURIComponent(filename)}/versions?limit=${limit}&skip=${skip}`, {}, token);
  }

  async getFileVersion(token: string, agentId: string, filename: string, version: number): Promise<{ version: any }> {
    return this.fetch(`/agents/${agentId}/workspace/file/${encodeURIComponent(filename)}/versions/${version}`, {}, token);
  }

  async restoreFileVersion(token: string, agentId: string, filename: string, version: number): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/workspace/file/${encodeURIComponent(filename)}/restore/${version}`, { method: 'POST' }, token);
  }

  async listWorkspaceFiles(token: string, agentId: string, directory?: string): Promise<{ files: string[] }> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return this.fetch(`/agents/${agentId}/workspace${query}`, {}, token);
  }

  // ── Memory ────────────────────────────────────────────────────

  async listMemoryFiles(token: string, agentId: string): Promise<{ files: string[] }> {
    return this.fetch(`/agents/${agentId}/memory`, {}, token);
  }

  async searchMemory(token: string, agentId: string, query: string): Promise<{ results: any[] }> {
    return this.fetch(`/agents/${agentId}/memory/search?q=${encodeURIComponent(query)}`, {}, token);
  }

  async readMemoryFile(token: string, agentId: string, path: string): Promise<{ file: { filename: string; content: string; size: number } }> {
    return this.fetch(`/agents/${agentId}/memory/file/${path}`, {}, token);
  }

  async writeMemoryFile(token: string, agentId: string, path: string, content: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/memory/file/${path}`, { method: 'PUT', body: JSON.stringify({ content }) }, token);
  }

  async deleteMemoryFile(token: string, agentId: string, path: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/memory/file/${path}`, { method: 'DELETE' }, token);
  }

  // ── Knowledge ──────────────────────────────────────────────────

  async getKnowledgeSources(token: string): Promise<{ sources: any[] }> {
    return this.fetch(`/knowledge/sources`, {}, token);
  }

  async uploadKnowledgeFile(token: string, formData: FormData): Promise<any> {
    const res = await fetch(`${API_BASE}/knowledge/sources`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }
    return res.json();
  }

  async addKnowledgeText(token: string, data: { name: string; content: string }): Promise<any> {
    return this.fetch('/knowledge/sources', { method: 'POST', body: JSON.stringify({ type: 'text', ...data }) }, token);
  }

  async crawlWebsite(token: string, data: { url: string; maxPages?: number; maxDepth?: number; schedule?: string }): Promise<any> {
    return this.fetch('/knowledge/crawl', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async deleteKnowledgeSource(token: string, sourceId: string): Promise<any> {
    return this.fetch(`/knowledge/sources/${sourceId}`, { method: 'DELETE' }, token);
  }

  async getKnowledgeChunks(token: string, sourceId: string): Promise<{ chunks: any[] }> {
    return this.fetch(`/knowledge/sources/${sourceId}/chunks`, {}, token);
  }

  async searchKnowledge(token: string, data: { query: string; limit?: number }): Promise<{ results: any[] }> {
    return this.fetch('/knowledge/search', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async getKnowledgeAnalytics(token: string): Promise<any> {
    return this.fetch(`/knowledge/analytics`, {}, token);
  }

  // ── Knowledge Integrations ─────────────────────────────────────

  async getKnowledgeIntegrations(token: string): Promise<{ integrations: any[] }> {
    return this.fetch('/knowledge/integrations', {}, token);
  }

  async getGoogleAuthUrl(token: string): Promise<{ url: string }> {
    return this.fetch(`/knowledge/integrations/google/auth`, {}, token);
  }

  async exchangeGoogleCode(token: string, code: string): Promise<{ integration: any }> {
    return this.fetch('/knowledge/integrations/google/callback', { method: 'POST', body: JSON.stringify({ code }) }, token);
  }

  async getNotionAuthUrl(token: string): Promise<{ url: string }> {
    return this.fetch(`/knowledge/integrations/notion/auth`, {}, token);
  }

  async exchangeNotionCode(token: string, code: string): Promise<{ integration: any }> {
    return this.fetch('/knowledge/integrations/notion/callback', { method: 'POST', body: JSON.stringify({ code }) }, token);
  }

  async syncIntegration(token: string, integrationId: string): Promise<any> {
    return this.fetch(`/knowledge/integrations/${integrationId}/sync`, { method: 'POST' }, token);
  }

  async deleteIntegration(token: string, integrationId: string): Promise<any> {
    return this.fetch(`/knowledge/integrations/${integrationId}`, { method: 'DELETE' }, token);
  }

  async getIntegrationItems(token: string, integrationId: string): Promise<{ items: any[]; selectedItems: string[] }> {
    return this.fetch(`/knowledge/integrations/${integrationId}/items`, {}, token);
  }

  async saveIntegrationItems(token: string, integrationId: string, selectedItems: string[]): Promise<any> {
    return this.fetch(`/knowledge/integrations/${integrationId}/items`, { method: 'PUT', body: JSON.stringify({ selectedItems }) }, token);
  }

  // ── Contacts ──────────────────────────────────────────────────

  async listContacts(token: string, options?: { search?: string; tag?: string; channel?: string }): Promise<{ contacts: any[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.tag) params.set('tag', options.tag);
    if (options?.channel) params.set('channel', options.channel);
    return this.fetch(`/contacts?${params.toString()}`, {}, token);
  }

  async getContact(token: string, contactId: string): Promise<{ contact: any }> {
    return this.fetch(`/contacts/${contactId}`, {}, token);
  }

  async updateContact(token: string, contactId: string, data: { name?: string; tags?: string[]; notes?: string }): Promise<{ contact: any }> {
    return this.fetch(`/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(data) }, token);
  }

  async mergeContacts(token: string, targetId: string, sourceId: string): Promise<{ contact: any }> {
    return this.fetch(`/contacts/${targetId}/merge/${sourceId}`, { method: 'POST' }, token);
  }

  async deleteContact(token: string, contactId: string): Promise<{ success: boolean }> {
    return this.fetch(`/contacts/${contactId}`, { method: 'DELETE' }, token);
  }

  // ── Usage & Cost ──────────────────────────────────────────────

  async getAgentUsage(token: string, agentId: string): Promise<{ usage: any; cost: any }> {
    return this.fetch(`/agents/${agentId}/gateway/usage`, {}, token);
  }

  // ── Session Management ────────────────────────────────────────

  async resetSession(token: string, agentId: string, sessionKey: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/sessions/${encodeURIComponent(sessionKey)}/reset`, { method: 'POST' }, token);
  }

  async compactSession(token: string, agentId: string, sessionKey: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/sessions/${encodeURIComponent(sessionKey)}/compact`, { method: 'POST' }, token);
  }

  async deleteSession(token: string, agentId: string, sessionKey: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/sessions/${encodeURIComponent(sessionKey)}`, { method: 'DELETE' }, token);
  }

  // ── Channel Logout ────────────────────────────────────────────

  async logoutChannel(token: string, agentId: string, channel: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/gateway/channels/${channel}/logout`, { method: 'POST' }, token);
  }

  // ── DM Pairing ────────────────────────────────────────────────

  async getPairingSummary(token: string, agentId: string): Promise<{ totalPending: number }> {
    return this.fetch(`/agents/${agentId}/pairing-summary`, {}, token);
  }

  async listPairingRequests(token: string, agentId: string, channel: string): Promise<{ requests: any[] }> {
    return this.fetch(`/agents/${agentId}/pairing/${encodeURIComponent(channel)}`, {}, token);
  }

  async approvePairing(token: string, agentId: string, channel: string, code: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/pairing/${encodeURIComponent(channel)}/approve`, { method: 'POST', body: JSON.stringify({ code }) }, token);
  }

  async rejectPairing(token: string, agentId: string, channel: string, code: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/pairing/${encodeURIComponent(channel)}/reject`, { method: 'POST', body: JSON.stringify({ code }) }, token);
  }

  // ── Channel Login (QR) ────────────────────────────────────────

  async startChannelLogin(token: string, agentId: string, channel: string = 'whatsapp', relink = false): Promise<any> {
    return this.fetch(`/agents/${agentId}/channels/login/start`, { method: 'POST', body: JSON.stringify({ channel, relink }) }, token);
  }

  async getChannelLoginStatus(token: string, agentId: string, channel: string = 'whatsapp'): Promise<any> {
    return this.fetch(`/agents/${agentId}/channels/login/status?channel=${encodeURIComponent(channel)}`, {}, token);
  }

  async stopChannelLogin(token: string, agentId: string, channel: string = 'whatsapp'): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/channels/login/stop`, { method: 'POST', body: JSON.stringify({ channel }) }, token);
  }

  // ── Exec Approvals ────────────────────────────────────────────

  async listExecApprovals(token: string, agentId: string): Promise<{ approvals: any[] }> {
    return this.fetch(`/agents/${agentId}/exec-approvals`, {}, token);
  }

  async resolveExecApproval(token: string, agentId: string, requestId: string, approved: boolean): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/exec-approvals/${requestId}/resolve`, { method: 'POST', body: JSON.stringify({ approved }) }, token);
  }

  // ── Skills (ClawHub) ────────────────────────────────────────

  async browseSkills(token: string, params?: { category?: string; search?: string }): Promise<{ skills: any[]; total: number; categories: string[] }> {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    return this.fetch(`/skills/browse?${query}`, {}, token);
  }

  async getSkillDetail(token: string, slug: string): Promise<{ skill: any }> {
    return this.fetch(`/skills/browse/${slug}`, {}, token);
  }

  async getSkillSecurity(token: string, slug: string): Promise<{
    slug: string;
    allowed: boolean;
    security: any;
    warnings: string[];
    skill: any;
  }> {
    return this.fetch(`/skills/security/${slug}`, {}, token);
  }

  async getSkillRequirements(token: string, slug: string): Promise<{ envVars: string[]; primaryEnv: string | null }> {
    return this.fetch(`/skills/requirements/${slug}`, {}, token);
  }

  async getSkillReadme(token: string, slug: string): Promise<{ content: string }> {
    return this.fetch(`/skills/readme/${slug}`, {}, token);
  }

  async getInstalledSkills(token: string, agentId: string): Promise<{ skills: any[] }> {
    return this.fetch(`/skills/agents/${agentId}`, {}, token);
  }

  async installSkill(token: string, agentId: string, data: {
    slug: string;
    env?: Record<string, string>;
    apiKey?: string;
    acknowledgedWarnings?: boolean;
  }): Promise<{ skill: any }> {
    return this.fetch(`/skills/agents/${agentId}/install`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async uninstallSkill(token: string, agentId: string, slug: string): Promise<{ success: boolean }> {
    return this.fetch(`/skills/agents/${agentId}/${slug}`, { method: 'DELETE' }, token);
  }

  async updateSkillConfig(token: string, agentId: string, slug: string, data: { enabled?: boolean; env?: Record<string, string>; apiKey?: string }): Promise<{ success: boolean }> {
    return this.fetch(`/skills/agents/${agentId}/${slug}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  // ── Multi-Agent (Advanced) ──────────────────────────────────

  async getSubAgents(token: string, agentId: string): Promise<{ subAgents: any[] }> {
    return this.fetch(`/agents/${agentId}/sub-agents`, {}, token);
  }

  async addSubAgent(token: string, agentId: string, data: { name: string; isDefault?: boolean; bindings?: any[] }): Promise<{ subAgent: any }> {
    return this.fetch(`/agents/${agentId}/sub-agents`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async removeSubAgent(token: string, agentId: string, subId: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/sub-agents/${subId}`, { method: 'DELETE' }, token);
  }

  async updateSubAgentOverrides(token: string, agentId: string, subId: string, overrides: {
    model?: string;
    toolProfile?: string;
    toolAllow?: string[];
    toolDeny?: string[];
    sandboxMode?: string;
    heartbeatEnabled?: boolean;
    heartbeatInterval?: string;
    identityName?: string;
    identityAvatar?: string;
  }): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/sub-agents/${subId}/overrides`, { method: 'PATCH', body: JSON.stringify(overrides) }, token);
  }

  // ── Model Failover ─────────────────────────────────────────

  async getModelConfig(token: string, agentId: string): Promise<{ config: any; availableModels: any[] }> {
    return this.fetch(`/agents/${agentId}/models`, {}, token);
  }

  async updateModelConfig(token: string, agentId: string, data: any): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/models`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  // ── Agent Webhooks ─────────────────────────────────────────

  async getAgentWebhooks(token: string, agentId: string): Promise<{ webhooks: any[] }> {
    return this.fetch(`/agents/${agentId}/webhooks`, {}, token);
  }

  async createAgentWebhook(token: string, agentId: string, data: { name: string }): Promise<{ webhook: any }> {
    return this.fetch(`/agents/${agentId}/webhooks`, { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async deleteAgentWebhook(token: string, agentId: string, name: string): Promise<{ success: boolean }> {
    return this.fetch(`/agents/${agentId}/webhooks/${name}`, { method: 'DELETE' }, token);
  }

  // ── AI ──────────────────────────────────────────────────────
  async agentArchitect(token: string, messages: { role: 'user' | 'assistant'; content: string }[], model?: string, agentContext?: string, signal?: AbortSignal | null): Promise<{ message: string; config: any; toolSteps?: { tool: string; query?: string; category?: string }[] }> {
    return this.fetch('/ai/agent-architect', { method: 'POST', body: JSON.stringify({ messages, model, agentContext }), signal }, token);
  }

  async supportSuggest(token: string, ticketTitle: string, ticketDescription: string, messages: { role: string; content: string }[]): Promise<{ suggestions: string[] }> {
    return this.fetch('/ai/support-suggest', { method: 'POST', body: JSON.stringify({ ticketTitle, ticketDescription, messages }) }, token);
  }

  async analyticsInsights(token: string): Promise<{ insights: string }> {
    return this.fetch('/ai/analytics-insights', { method: 'POST', body: JSON.stringify({}) }, token);
  }

  // ── AI Providers ──────────────────────────────────────────────

  async getProviders(token: string): Promise<{ providers: any[] }> {
    return this.fetch('/providers', {}, token);
  }

  async createProvider(token: string, data: { provider: string; apiKey: string; baseUrl?: string; label?: string }): Promise<any> {
    return this.fetch('/providers', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async updateProvider(token: string, id: string, data: { apiKey?: string; baseUrl?: string; label?: string }): Promise<any> {
    return this.fetch(`/providers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
  }

  async deleteProvider(token: string, id: string): Promise<{ success: boolean }> {
    return this.fetch(`/providers/${id}`, { method: 'DELETE' }, token);
  }

  async validateProviderKey(token: string, data: { provider: string; apiKey: string; baseUrl?: string }): Promise<{ valid: boolean; error?: string; models?: string[] }> {
    return this.fetch('/providers/validate', { method: 'POST', body: JSON.stringify(data) }, token);
  }

  async getAvailableModels(token: string): Promise<{ models: string[]; providers: string[] }> {
    return this.fetch('/providers/models', {}, token);
  }

  // ── Node Relay (Browser Bridge) ──────────────────────────────


  // ── Audit & Compliance ──────────────────────────────────────────

  async getAuditTrail(token: string, params?: {
    agentId?: string;
    category?: string;
    action?: string;
    riskLevel?: string;
    outcome?: string;
    actorType?: string;
    search?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: any[]; total: number; integrityStatus: string }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') query.set(k, String(v));
      });
    }
    const qs = query.toString();
    return this.fetch(`/audit${qs ? `?${qs}` : ''}`, {}, token);
  }

  async getAuditEntry(token: string, id: string): Promise<{ entry: any }> {
    return this.fetch(`/audit/${id}`, {}, token);
  }

  async getAuditStats(token: string): Promise<{
    totalEntries: number;
    last24h: number;
    last7d: number;
    last30d: number;
    topActions: { action: string; count: number }[];
    riskDistribution: Record<string, number>;
    actorDistribution: Record<string, number>;
    chainIntegrity: string;
  }> {
    return this.fetch('/audit/stats', {}, token);
  }

  async verifyAuditIntegrity(token: string, limit?: number): Promise<{
    status: string;
    checkedEntries: number;
    firstEntry?: string;
    lastEntry?: string;
    brokenAt?: { entryId: string; expectedHash: string; actualHash: string; timestamp: string };
  }> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.fetch(`/audit/verify${qs}`, {}, token);
  }

  async exportAuditTrail(token: string, params: {
    format: 'json' | 'csv';
    from?: string;
    to?: string;
    agentId?: string;
    category?: string;
    includeMetadata?: boolean;
  }): Promise<Blob> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') query.set(k, String(v));
    });
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}/audit/export?${query.toString()}`, { headers });
    if (!response.ok) {
      const text = await response.text().catch(() => 'Export failed');
      throw new Error(`Export failed (${response.status}): ${text}`);
    }
    return response.blob();
  }

  async getAuditComplianceReport(token: string, from: string, to: string): Promise<any> {
    return this.fetch(`/audit/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {}, token);
  }

  // ── RBAC ────────────────────────────────────────────────────────

  async getUserPermissions(token: string): Promise<{
    role: string;
    permissions: string[];
  }> {
    return this.fetch('/organization/permissions', {}, token);
  }

  async getAvailableRoles(token: string): Promise<{
    roles: Array<{
      id: string;
      name: string;
      description: string;
      permissions: string[];
      isCustomizable: boolean;
    }>;
  }> {
    return this.fetch('/organization/roles', {}, token);
  }

  async acceptInvitation(token: string, inviteToken: string): Promise<{ success: boolean; organizationId: string; message: string }> {
    return this.fetch('/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token: inviteToken }),
    }, token);
  }

  async setMemberRole(token: string, memberId: string, role: string): Promise<{ success: boolean }> {
    return this.fetch(`/organization/members/${memberId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }, token);
  }

  // ── Analytics / Usage ───────────────────────────────────────────

  async getUsageAnalytics(token: string, params?: { from?: string; to?: string; agentId?: string }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.agentId) query.set('agentId', params.agentId);
    const qs = query.toString();
    return this.fetch(`/analytics/usage${qs ? `?${qs}` : ''}`, {}, token);
  }

  async getModelBreakdown(token: string, params?: { from?: string; to?: string; agentId?: string }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.agentId) query.set('agentId', params.agentId);
    const qs = query.toString();
    return this.fetch(`/analytics/models${qs ? `?${qs}` : ''}`, {}, token);
  }

  async exportUsageData(token: string, params: { from: string; to: string; format: 'json' | 'csv'; agentId?: string }): Promise<Blob> {
    const query = new URLSearchParams({ from: params.from, to: params.to, format: params.format });
    if (params.agentId) query.set('agentId', params.agentId);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}/analytics/export?${query.toString()}`, { headers });
    return response.blob();
  }

  // ── Approvals ───────────────────────────────────────────────────

  async listApprovals(
    token: string,
    params?: { status?: string; agentId?: string; limit?: number; offset?: number }
  ): Promise<{ approvals: any[]; total: number; counts: any }> {
    const query = new URLSearchParams(params as any).toString();
    return this.fetch(`/approvals?${query}`, {}, token);
  }

  async getApprovalCounts(token: string): Promise<{ pending: number; approved: number; rejected: number; expired: number; total: number }> {
    return this.fetch('/approvals/counts', {}, token);
  }

  async resolveApproval(token: string, id: string, body: { status: 'approved' | 'rejected'; note?: string }): Promise<{ approval: any }> {
    return this.fetch(`/approvals/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }, token);
  }

  // ── SSO/SCIM Security ──────────────────────────────────────────

  async getSecuritySettings(token: string): Promise<{
    ssoRequired: boolean;
    allowedDomains: string[];
    scimEnabled: boolean;
  }> {
    return this.fetch('/organization/security', {}, token);
  }

  async updateSecuritySettings(token: string, data: {
    ssoRequired?: boolean;
    allowedDomains?: string[];
    scimEnabled?: boolean;
  }): Promise<{ success: boolean }> {
    return this.fetch('/organization/security', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token);
  }
}

export const apiClient = new ApiClient();
