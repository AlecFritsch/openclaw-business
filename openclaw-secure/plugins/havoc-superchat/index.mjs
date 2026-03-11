/**
 * Havoc Superchat Plugin — unified superchat tool for full Superchat API control.
 * One tool, many actions: send, read conversations, manage contacts, templates, etc.
 */
export default function (api) {
  const ENTERPRISE_HINT = '⚡ Dieses Feature erfordert Superchat Enterprise. Upgrade im Superchat-Dashboard unter Einstellungen → Abo, oder kontaktiere deinen Superchat Account Manager. Nach dem Upgrade funktioniert es sofort — keine Änderung an der Integration nötig.';

  const getEnv = () => {
    const backendUrl = process.env.HAVOC_BACKEND_URL;
    const agentId = process.env.HAVOC_AGENT_ID;
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (!backendUrl || !agentId || !token) return null;
    return { backendUrl: backendUrl.replace(/\/$/, ''), agentId, token };
  };

  const call = async (method, path, { query, body } = {}) => {
    const env = getEnv();
    if (!env) return { content: [{ type: 'text', text: 'Superchat: env vars not set.' }] };
    const params = new URLSearchParams({ agentId: env.agentId, ...query });
    const base = `${env.backendUrl}/api/internal/superchat/${path}`;
    const url = method === 'GET' || method === 'DELETE' ? `${base}?${params}` : base;
    try {
      const opts = { method, headers: { 'X-Gateway-Token': env.token } };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify({ agentId: env.agentId, ...body });
      }
      const res = await fetch(url, opts);
      if (res.status === 204) return { content: [{ type: 'text', text: 'Done.' }] };
      if (res.status === 403) return { content: [{ type: 'text', text: `ENTERPRISE_REQUIRED: ${ENTERPRISE_HINT}` }] };
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { content: [{ type: 'text', text: `Superchat API error: ${data.error || res.status}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `superchat failed: ${err.message}` }] };
    }
  };

  const ACTIONS = {
    // ── Send ──
    send: { method: 'POST', path: 'send', bodyKeys: ['contactIdentifier', 'channelId', 'text'] },
    send_template: { method: 'POST', path: 'messages/template', bodyKeys: ['contactIdentifier', 'channelId', 'templateName', 'templateLanguage', 'variables'] },
    // ── Conversations ──
    conversations: { method: 'GET', path: 'conversations', queryKeys: ['limit'] },
    conversation_detail: { method: 'GET', path: p => `conversations/${p.conversationId}`, queryKeys: [] },
    conversation_update: { method: 'PATCH', path: p => `conversations/${p.conversationId}`, bodyKeys: ['status'] },
    conversation_delete: { method: 'DELETE', path: p => `conversations/${p.conversationId}`, queryKeys: [] },
    // ── Messages ──
    messages: { method: 'GET', path: 'messages', queryKeys: ['conversationId', 'limit'] },
    // ── Contacts ──
    contacts: { method: 'GET', path: 'contacts', queryKeys: ['limit', 'next'] },
    contact_search: { method: 'POST', path: 'contacts/search', bodyKeys: ['field', 'value'] },
    contact_detail: { method: 'GET', path: p => `contacts/${p.contactId}`, queryKeys: [] },
    contact_conversations: { method: 'GET', path: p => `contacts/${p.contactId}/conversations`, queryKeys: [] },
    contact_create: { method: 'POST', path: 'contacts/create', bodyKeys: ['first_name', 'last_name', 'handles'] },
    contact_update: { method: 'PATCH', path: p => `contacts/${p.contactId}`, bodyKeys: ['first_name', 'last_name', 'gender', 'handles', 'custom_attributes'] },
    contact_delete: { method: 'DELETE', path: p => `contacts/${p.contactId}`, queryKeys: [] },
    // ── Channels & Templates ──
    channels: { method: 'GET', path: 'channels', queryKeys: [] },
    templates: { method: 'GET', path: 'templates', queryKeys: [] },
  };

  api.registerTool({
    name: 'superchat',
    description: `Full Superchat API control — one tool for everything.

**action** parameter determines what to do:

SEND:
- "send" — Send message. Needs: contactIdentifier, channelId, text
- "send_template" — Send WhatsApp template. Needs: contactIdentifier, channelId, templateName, templateLanguage. Optional: variables[]

READ CONVERSATIONS:
- "conversations" — List recent conversations. Optional: limit
- "conversation_detail" — Single conversation. Needs: conversationId
- "messages" — Read messages in conversation. Needs: conversationId. Optional: limit. ⚠️ Enterprise only

MANAGE CONVERSATIONS:
- "conversation_update" — Change status (open/done/snoozed). Needs: conversationId, status
- "conversation_delete" — Delete conversation. Needs: conversationId. ⚠️ Confirm with user first!

READ CONTACTS:
- "contacts" — List contacts. Optional: limit
- "contact_search" — Search by email/phone. Needs: field ("mail"/"phone"), value
- "contact_detail" — Full contact info. Needs: contactId
- "contact_conversations" — All conversations for contact. Needs: contactId

MANAGE CONTACTS:
- "contact_create" — Create contact. Needs: first_name. Optional: last_name, handles[{type,value}]
- "contact_update" — Update contact. Needs: contactId. Optional: first_name, last_name, gender, handles, custom_attributes
- "contact_delete" — Delete contact. Needs: contactId. ⚠️ Confirm with user first!

OTHER:
- "channels" — List connected channels (WhatsApp, Email, Instagram, SMS, etc.)
- "templates" — List WhatsApp/message templates

TIPS:
- "Show latest emails" → conversations (limit=10) → messages (conversationId=cv_xxx)
- "Find contact" → contact_search (field="mail", value="user@example.com")
- "WhatsApp after 24h" → templates → send_template
- Messages reading requires Superchat Enterprise. If 403: tell user to upgrade.`,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action to perform (see description for full list)' },
        conversationId: { type: 'string', description: 'Conversation ID (cv_xxx)' },
        contactId: { type: 'string', description: 'Contact ID (co_xxx / ct_xxx)' },
        contactIdentifier: { type: 'string', description: 'Phone E164, email, or contact_id — for sending' },
        channelId: { type: 'string', description: 'Channel ID (mc_xxx) — for sending' },
        text: { type: 'string', description: 'Message text' },
        status: { type: 'string', description: 'Conversation status: open, done, snoozed' },
        field: { type: 'string', description: 'Search field: mail or phone' },
        value: { type: 'string', description: 'Search value' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        gender: { type: 'string' },
        handles: { type: 'array', description: '[{type:"phone"|"mail", value:"..."}]', items: { type: 'object' } },
        custom_attributes: { type: 'array', description: '[{id:"cat_xxx", value:"..."}]', items: { type: 'object' } },
        templateName: { type: 'string' },
        templateLanguage: { type: 'string' },
        variables: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
        next: { type: 'string', description: 'Pagination cursor' },
      },
      required: ['action'],
    },
    async execute(_id, params) {
      const { action, ...rest } = params;
      const def = ACTIONS[action];
      if (!def) return { content: [{ type: 'text', text: `Unknown action "${action}". Valid: ${Object.keys(ACTIONS).join(', ')}` }] };

      const path = typeof def.path === 'function' ? def.path(rest) : def.path;
      const query = {};
      const body = {};
      if (def.queryKeys) for (const k of def.queryKeys) { if (rest[k] != null) query[k] = String(rest[k]); }
      if (def.bodyKeys) for (const k of def.bodyKeys) { if (rest[k] != null) body[k] = rest[k]; }

      return call(def.method, path, {
        query: def.method === 'GET' || def.method === 'DELETE' ? query : undefined,
        body: def.bodyKeys ? body : undefined,
      });
    },
  }, { optional: true });
}
