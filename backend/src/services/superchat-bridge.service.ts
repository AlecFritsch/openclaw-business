// Superchat Bridge Service - Havoc-only integration
// Receives webhooks from Superchat, forwards to OpenClaw agent, sends replies via Superchat API

import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { decrypt } from '../utils/encryption.js';
import { gatewayManager } from './gateway-ws.service.js';
import type { SuperchatWebhookPayload } from '@openclaw-business/shared';
import { config } from '../config/env.js';

const SUPERCHAT_API_BASE = config.superchatApiBaseUrl;

/** Superchat channel from GET /v1.0/channels API */
export interface SuperchatChannel {
  type: string; // whats_app, instagram, facebook_messenger, sms, mail, telegram, livechat
  id: string;  // mc_xxx
  name?: string;
  inbox?: { id: string; name?: string; url?: string };
  url?: string;
}

/**
 * List channels from Superchat API (WhatsApp, Instagram, etc.)
 * GET /v1.0/channels with X-API-KEY
 */
export async function listSuperchatChannels(apiKey: string): Promise<SuperchatChannel[]> {
  const url = `${SUPERCHAT_API_BASE}/v1.0/channels?limit=100`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'X-API-KEY': apiKey },
  });

  if (!response.ok) {
    const errBody = await response.text();
    const errMessage = parseSuperchatError(errBody);
    throw new Error(`Superchat API error ${response.status}: ${errMessage}`);
  }

  const data = (await response.json()) as { results?: SuperchatChannel[] };
  return data?.results ?? [];
}

/**
 * Handle incoming Superchat webhook. Forwards message to agent, waits for reply, sends via Superchat API.
 * Payload schema: developers.superchat.com/reference/webhook-payload-model
 */
export async function handleIncomingWebhook(
  agentId: string,
  payload: SuperchatWebhookPayload,
): Promise<void> {
  // Only process message_inbound — ignore contact_updated, message_outbound, etc.
  if (payload.event && payload.event !== 'message_inbound') {
    return; // Silently ignore non-inbound events
  }

  const msg = payload.message;
  const conversationId = msg?.conversation_id ?? payload.conversation?.id;
  // Official API: message.content.body (text type); fallback for legacy/alternate payloads
  let messageText =
    (msg?.content?.body as string) ?? (msg as { text?: string })?.text ?? (msg as { body?: string })?.body;
  // Inbound media (image, file, etc.) has no body — use placeholder so agent can respond
  const contentType = msg?.content?.type as string;
  if ((!messageText || typeof messageText !== 'string') && contentType && contentType !== 'text' && contentType !== 'email') {
    messageText = '[Media erhalten]';
  }
  if (!conversationId || !messageText || typeof messageText !== 'string') {
    throw new Error('Missing conversationId or message text in webhook payload');
  }

  // For send: need contact identifier and channel_id from inbound message
  const contactIdentifier = msg?.from?.identifier ?? msg?.from?.id;
  const channelId = (msg?.to as { channel_id?: string })?.channel_id;

  if (!contactIdentifier || !channelId) {
    throw new Error('Missing contact identifier or channel_id in webhook payload (required for reply)');
  }

  const db = getDatabase();
  const agent = await db.collection('agents').findOne(
    { _id: new ObjectId(agentId) },
    { projection: { gatewayUrl: 1, gatewayToken: 1, status: 1 } },
  );

  if (!agent?.gatewayUrl || !agent?.gatewayToken) {
    throw new Error(`Agent ${agentId} has no gateway config`);
  }
  if (agent.status !== 'running') {
    throw new Error(`Agent ${agentId} is not running`);
  }

  const channel = await db.collection('agent_channels').findOne(
    { agentId, type: 'superchat' },
    { projection: { credentials: 1 } },
  );
  if (!channel?.credentials?.encrypted) {
    throw new Error(`Agent ${agentId} has no Superchat channel configured`);
  }

  let creds: { apiKey?: string };
  try {
    creds = JSON.parse(decrypt(channel.credentials.encrypted));
  } catch {
    throw new Error('Failed to decrypt Superchat credentials');
  }
  if (!creds.apiKey) {
    throw new Error('Superchat API key missing');
  }

  const sessionKey = `agent:${agentId}:superchat:peer:${conversationId}`;
  const gatewayUrl = agent.gatewayUrl as string;
  const gatewayToken = agent.gatewayToken as string;

  if (!gatewayManager.isConnected(agentId)) {
    await gatewayManager.connectAgent({
      agentId,
      url: gatewayUrl,
      token: gatewayToken,
    });
  }

  const client = gatewayManager.getClient(agentId);
  if (!client) {
    throw new Error('Failed to connect to agent gateway');
  }

  // Inject Superchat context so agent can store contactIdentifier/channelId for superchat_send.
  // Per developers.superchat.com: message.from.identifier (E164/email), message.to.channel_id (mc_xxx).
  // Agent parses this, stores in MEMORY.md, never echoes to user.
  const metaLine = `[SUPERCHAT_META contactIdentifier="${contactIdentifier}" channelId="${channelId}" conversationId="${conversationId}"]`;
  const messageWithMeta = `${metaLine}\n\n${messageText}`;

  const sendResult = await client.sendMessage(sessionKey, messageWithMeta);
  const runId = sendResult?.runId;

  if (runId) {
    try {
      await client.request('agent.wait', { runId, timeoutMs: 60000 });
    } catch {
      // Fall through to polling
    }
  }

  const pollIntervals = [1000, 2000, 3000, 5000, 8000];
  let assistantContent = '';

  for (const interval of pollIntervals) {
    await new Promise(resolve => setTimeout(resolve, interval));
    try {
      const history = await client.getSessionHistory(sessionKey, 5);
      const lastAssistant = history
        .filter((m: { role?: string; from?: string }) => m.role === 'assistant' || m.from === 'assistant')
        .pop();
      if (lastAssistant?.content) {
        assistantContent = lastAssistant.content;
        break;
      }
    } catch {
      // Continue polling
    }
  }

  if (!assistantContent) {
    assistantContent = 'Die Antwort wird noch generiert. Bitte kurz warten.';
  }

  await sendMessageViaSuperchat(creds.apiKey, contactIdentifier, channelId, assistantContent);
}

/** Max retries for 429 Rate Limit (Context7: 2500 req/5min per workspace) */
const SUPERCHAT_RATE_LIMIT_MAX_RETRIES = 3;
const SUPERCHAT_RATE_LIMIT_BACKOFF_MS = 2000;

/**
 * Parse Superchat API error response. Schema: { errors: [{ title, detail, url, docs, statusCode }] }
 */
function parseSuperchatError(errBody: string): string {
  try {
    const parsed = JSON.parse(errBody) as { errors?: Array<{ detail?: string; title?: string }> };
    const first = parsed?.errors?.[0];
    if (first?.detail) return first.detail;
    if (first?.title) return first.title;
  } catch {
    // Fall through to raw body
  }
  return errBody;
}

/**
 * Send a message via Superchat API.
 * API: POST /v1.0/messages, X-API-KEY header, body per developers.superchat.com/reference/createmessage
 * Retries on 429 (rate limit) with exponential backoff.
 */
export async function sendMessageViaSuperchat(
  apiKey: string,
  toIdentifier: string, // contact identifier (phone E164, email, or contact_id)
  channelId: string, // mc_xxx - channel to send from
  text: string,
): Promise<void> {
  const url = `${SUPERCHAT_API_BASE}/v1.0/messages`;

  for (let attempt = 0; attempt <= SUPERCHAT_RATE_LIMIT_MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      // Context7: v1.0/messages uses content.text (not body) per developers.superchat.com
      body: JSON.stringify({
        to: [{ identifier: toIdentifier }],
        from: { channel_id: channelId },
        content: { type: 'text', text },
      }),
    });

    if (response.ok) return;

    const errBody = await response.text();
    const errMessage = parseSuperchatError(errBody);

    if (response.status === 429 && attempt < SUPERCHAT_RATE_LIMIT_MAX_RETRIES) {
      const backoff = SUPERCHAT_RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, backoff));
      continue;
    }

    throw new Error(`Superchat API error ${response.status}: ${errMessage}`);
  }

  throw new Error('Superchat API request failed after retries');
}
