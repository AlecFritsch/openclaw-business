/**
 * Havoc Knowledge Plugin — automatic RAG context injection + manual search tool.
 *
 * 1. before_prompt_build hook: auto-searches knowledge base with the last user
 *    message and injects matching context via prependContext.
 * 2. knowledge_search tool: still available for explicit/refined searches.
 */
export default function (api) {
  const getEnv = () => {
    const backendUrl = process.env.HAVOC_BACKEND_URL;
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (!backendUrl || !token) return null;
    return { backendUrl: backendUrl.replace(/\/$/, ''), token };
  };

  const MIN_SCORE = 0.72;

  async function searchBackend(query, limit = 3) {
    const env = getEnv();
    if (!env) return [];
    try {
      const res = await fetch(`${env.backendUrl}/api/internal/knowledge/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gateway-Token': env.token },
        body: JSON.stringify({ query, limit }),
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return data.results || [];
    } catch {
      return [];
    }
  }

  // ── Auto-inject knowledge context before every prompt ──────────────────
  api.registerHook(
    'before_prompt_build',
    async (ctx) => {
      const messages = ctx.messages || [];
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (!lastUser?.content) return;

      const query = typeof lastUser.content === 'string'
        ? lastUser.content
        : lastUser.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
      if (!query.trim() || query.length < 3) return;

      const results = await searchBackend(query, 3);
      const relevant = results.filter(r => r.score >= MIN_SCORE);
      if (relevant.length === 0) return;

      const context = relevant.map(r => `[${r.sourceName}]\n${r.text}`).join('\n\n---\n\n');

      ctx.prependContext = (ctx.prependContext || '') +
        `\n<knowledge_base>\nThe following information was retrieved from the organization's knowledge base. Use it to answer the user's question when relevant.\n\n${context}\n</knowledge_base>\n`;
    },
    { name: 'havoc-knowledge.auto-inject', description: 'Auto-inject RAG knowledge context before prompt build' },
  );

  // ── Manual search tool (for explicit/refined queries) ──────────────────
  api.registerTool({
    name: 'knowledge_search',
    description:
      'Search the organization knowledge base (uploaded files, crawled websites, Notion pages, Google Drive docs). Use this for follow-up or refined searches when the auto-injected context is insufficient.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Semantic search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
    async execute(_toolCallId, params) {
      const env = getEnv();
      if (!env) return { content: [{ type: 'text', text: 'Knowledge search unavailable: HAVOC_BACKEND_URL not set.' }] };

      try {
        const results = await searchBackend(params.query, params.limit || 5);
        if (results.length === 0) return { content: [{ type: 'text', text: 'No relevant knowledge found.' }] };

        const text = results.map((r, i) =>
          `[${i + 1}] ${r.sourceName} (score: ${(r.score * 100).toFixed(0)}%)\n${r.text}`
        ).join('\n\n---\n\n');

        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Knowledge search failed: ${err.message}` }] };
      }
    },
  });
}
