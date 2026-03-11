// Unified Chat Routes — model-agnostic chat with optional RAG knowledge augmentation

import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../../config/database.js';
import { decrypt } from '../../utils/encryption.js';
import { searchKnowledge } from '../../services/knowledge.service.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  sourceIds?: string[];
  conversationId?: string;
}

/** Resolve provider API key + base URL from model string */
async function resolveModel(organizationId: string, model?: string) {
  const db = getDatabase();
  const modelId = model;
  if (!modelId) throw new Error('No model specified. Please configure an AI provider in settings.');
  const [providerName] = modelId.split('/');

  const providerMap: Record<string, { baseUrl: string; headerKey: string }> = {
    anthropic: { baseUrl: 'https://api.anthropic.com/v1/messages', headerKey: 'x-api-key' },
    openai:    { baseUrl: 'https://api.openai.com/v1/chat/completions', headerKey: 'Authorization' },
    google:    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', headerKey: 'x-goog-api-key' },
    groq:      { baseUrl: 'https://api.groq.com/openai/v1/chat/completions', headerKey: 'Authorization' },
  };

  const providerConfig = providerMap[providerName];
  if (!providerConfig) throw new Error(`Unsupported provider: ${providerName}`);

  const provider = await db.collection('providers').findOne({
    organizationId,
    provider: providerName,
    status: 'active',
  });

  if (!provider?.apiKeyEncrypted) {
    throw new Error(`No ${providerName} API key configured. Add one in Settings > AI Providers.`);
  }

  const apiKey = decrypt(provider.apiKeyEncrypted);
  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;

  return { apiKey, modelName, providerName, ...providerConfig };
}

export async function chatRoutes(fastify: FastifyInstance) {
  const db = getDatabase();

  // POST /api/chat/completions — send message, get streamed response
  fastify.post<{ Body: ChatRequest }>('/completions', async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const { messages, model, sourceIds, conversationId } = request.body;
    if (!messages?.length) return reply.badRequest('messages required');

    const resolved = await resolveModel(organizationId, model);
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Build knowledge context (always search if sources exist; sourceIds filters to specific ones)
    let knowledgeContext = '';
    let knowledgeSources: { name: string; score: number }[] = [];
    if (lastUserMsg) {
      const results = await searchKnowledge({ organizationId, query: lastUserMsg, sourceIds: sourceIds?.length ? sourceIds : undefined, limit: 5 });
      if (results.length > 0) {
        knowledgeSources = results.map(r => ({ name: r.sourceName, score: r.score }));
        const context = results.map((r, i) => `[Source ${i + 1}: ${r.sourceName}]\n${r.text}`).join('\n\n');
        knowledgeContext = `Use the following knowledge context to help answer the user's question. If the context doesn't contain relevant information, answer based on your general knowledge.\n\n---\n${context}\n---\n\n`;
      }
    }

    // Prepare messages with knowledge context
    const augmentedMessages = [...messages];
    if (knowledgeContext) {
      augmentedMessages.unshift({ role: 'system', content: knowledgeContext });
    }

    // Store user message
    const convId = conversationId || new ObjectId().toString();
    const userMsg = messages[messages.length - 1];
    await db.collection('chat_messages').insertOne({
      organizationId,
      userId,
      conversationId: convId,
      role: userMsg.role,
      content: userMsg.content,
      model: `${resolved.providerName}/${resolved.modelName}`,
      createdAt: new Date(),
    });

    // Route to provider
    let responseText = '';

    if (resolved.providerName === 'anthropic') {
      const res = await fetch(resolved.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': resolved.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: resolved.modelName,
          max_tokens: 4096,
          system: knowledgeContext || undefined,
          messages: augmentedMessages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return reply.status(res.status).send({ error: `Anthropic API error: ${err.slice(0, 200)}` });
      }

      const data = await res.json() as any;
      responseText = data.content?.[0]?.text || '';
    } else {
      // OpenAI-compatible (OpenAI, Groq)
      const authHeader: Record<string, string> = resolved.providerName === 'google'
        ? { 'x-goog-api-key': resolved.apiKey }
        : { 'Authorization': `Bearer ${resolved.apiKey}` };

      let url = resolved.baseUrl;
      if (resolved.providerName === 'google') {
        url = `${resolved.baseUrl}/models/${resolved.modelName}:generateContent?key=${resolved.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: augmentedMessages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        });

        if (!res.ok) {
          const err = await res.text().catch(() => '');
          return reply.status(res.status).send({ error: `Google API error: ${err.slice(0, 200)}` });
        }

        const data = await res.json() as any;
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({
            model: resolved.modelName,
            messages: augmentedMessages.map(m => ({ role: m.role, content: m.content })),
            max_tokens: 4096,
          }),
        });

        if (!res.ok) {
          const err = await res.text().catch(() => '');
          return reply.status(res.status).send({ error: `${resolved.providerName} API error: ${err.slice(0, 200)}` });
        }

        const data = await res.json() as any;
        responseText = data.choices?.[0]?.message?.content || '';
      }
    }

    // Store assistant response
    await db.collection('chat_messages').insertOne({
      organizationId,
      userId,
      conversationId: convId,
      role: 'assistant',
      content: responseText,
      model: `${resolved.providerName}/${resolved.modelName}`,
      createdAt: new Date(),
    });

    return {
      conversationId: convId,
      message: { role: 'assistant', content: responseText },
      model: `${resolved.providerName}/${resolved.modelName}`,
      sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
    };
  });

  // GET /api/chat/conversations — list user's conversations
  fastify.get('/conversations', async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const conversations = await db.collection('chat_messages').aggregate([
      { $match: { organizationId, userId } },
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: '$conversationId',
        lastMessage: { $first: '$content' },
        lastRole: { $first: '$role' },
        model: { $first: '$model' },
        updatedAt: { $first: '$createdAt' },
        messageCount: { $sum: 1 },
      }},
      { $sort: { updatedAt: -1 } },
      { $limit: 50 },
    ]).toArray();

    return { conversations };
  });

  // GET /api/chat/conversations/:id — get conversation history
  fastify.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const messages = await db.collection('chat_messages')
      .find({ organizationId, userId, conversationId: request.params.id })
      .sort({ createdAt: 1 })
      .project({ role: 1, content: 1, model: 1, createdAt: 1 })
      .toArray();

    return { messages };
  });

  // GET /api/chat/models — list available models based on org's configured providers
  fastify.get('/models', async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.badRequest('Organization required');

    const providers = await db.collection('providers')
      .find({ organizationId, status: 'active' })
      .project({ provider: 1 })
      .toArray();

    const modelMap: Record<string, Array<{ id: string; name: string }>> = {
      anthropic: [
        { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
        { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6' },
      ],
      openai: [
        { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini' },
        { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
        { id: 'openai/o3', name: 'o3' },
      ],
      google: [
        { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro' },
      ],
      groq: [
        { id: 'groq/llama-4-scout', name: 'Llama 4 Scout' },
      ],
    };

    const models = providers.flatMap(p => modelMap[p.provider] || []);
    return { models };
  });
}
