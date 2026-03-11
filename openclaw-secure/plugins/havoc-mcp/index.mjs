/**
 * OpenClaw Business MCP Plugin — injects MCP tools from Smithery Connect into the agent.
 * Tools are fetched from the backend (which proxies Smithery) at runtime.
 */
export default function (api) {
  const getEnv = () => {
    const backendUrl = process.env.HAVOC_BACKEND_URL;
    const agentId = process.env.HAVOC_AGENT_ID;
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (!backendUrl || !agentId || !token) return null;
    return { backendUrl: backendUrl.replace(/\/$/, ''), agentId, token };
  };

  const fetchTools = async () => {
    const env = getEnv();
    if (!env) return [];
    try {
      const res = await fetch(`${env.backendUrl}/api/internal/mcp-proxy/tools?agentId=${env.agentId}`, {
        headers: { 'X-Gateway-Token': env.token },
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return data.tools || [];
    } catch {
      return [];
    }
  };

  const callTool = async (connectionId, tool, args) => {
    const env = getEnv();
    if (!env) return { content: [{ type: 'text', text: 'MCP: env vars not set.' }] };
    try {
      const res = await fetch(`${env.backendUrl}/api/internal/mcp-proxy/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gateway-Token': env.token },
        body: JSON.stringify({ agentId: env.agentId, connectionId, tool, args }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { content: [{ type: 'text', text: data.error || `MCP call failed: ${res.status}` }] };
      return { content: [{ type: 'text', text: data.content || JSON.stringify(data) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `MCP call failed: ${err.message}` }] };
    }
  };

  // ── mcp_list: List available MCP tools for the org ───────────────────────
  api.registerTool({
    name: 'mcp_list',
    description: 'List all MCP tools available from connected integrations (Intercom, Slack, GitHub, Notion, etc.). Call this first to discover what tools you can use, then use mcp_call to execute.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      const tools = await fetchTools();
      if (tools.length === 0) return { content: [{ type: 'text', text: 'No MCP connected. Connect integrations in the dashboard.' }] };
      const byConn = {};
      for (const t of tools) {
        const k = t.mcpName || t.connectionId;
        if (!byConn[k]) byConn[k] = { mcpName: t.mcpName, connectionId: t.connectionId, tools: [] };
        byConn[k].tools.push({ name: t.name, description: t.description });
      }
      const text = Object.entries(byConn).map(([k, v]) =>
        `**${v.mcpName || k}** (connectionId: ${v.connectionId})\n` +
        v.tools.map(t => `  - ${t.name}: ${t.description || '—'}`).join('\n')
      ).join('\n\n');
      return { content: [{ type: 'text', text }] };
    },
  });

  // ── mcp_call: Execute an MCP tool ───────────────────────────────────────
  api.registerTool({
    name: 'mcp_call',
    description: 'Call an MCP tool from a connected integration. Use mcp_list first to get connectionId and tool names. Pass connectionId (from mcp_list), tool name, and args. Example: mcp_call({ connectionId: "havoc-xxx", tool: "reply_to_conversation", args: { conversationId: "123", message: "Hello" } })',
    parameters: {
      type: 'object',
      properties: {
        connectionId: { type: 'string', description: 'Connection ID from mcp_list' },
        tool: { type: 'string', description: 'Tool name from mcp_list' },
        args: { type: 'object', description: 'Arguments for the tool', additionalProperties: true },
      },
      required: ['connectionId', 'tool'],
    },
    async execute(_id, params) {
      const { connectionId, tool, args } = params || {};
      if (!connectionId || !tool) return { content: [{ type: 'text', text: 'connectionId and tool required' }] };
      return callTool(connectionId, tool, args || {});
    },
  });
}
