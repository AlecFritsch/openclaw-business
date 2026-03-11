import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import { chatWithClaude, chatWithGemini, tavilySearch, resolvePlatformKey } from '../../services/ai.service.js';
import { config } from '../../config/env.js';
import {
  errorResponseSchema,
} from '../../validation/response-schemas.js';
import type Anthropic from '@anthropic-ai/sdk';

// Helper: Call platform AI (Anthropic or Gemini)
async function callPlatformAI(options: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
}): Promise<string> {
  const platformKey = resolvePlatformKey();
  if (platformKey.provider === 'gemini') {
    const response = await chatWithGemini({
      system: options.system,
      messages: options.messages,
      maxTokens: options.maxTokens || 4096,
      apiKey: platformKey.apiKey,
    });
    return response.content;
  } else {
    const response = await chatWithClaude({
      system: options.system,
      messages: options.messages,
      maxTokens: options.maxTokens || 4096,
      tier: 'fast',
      enableCaching: true,
      apiKey: platformKey.apiKey,
    });
    return (response.content || [])
      .filter(b => (b as { type?: string }).type === 'text')
      .map(b => (b as { text: string }).text)
      .join('');
  }
}

export default async function aiRoutes(fastify: FastifyInstance) {
  // Trial guard: block AI helpers when trial expired (costs platform credits)
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && request.trialExpired) {
      return reply.code(403).send({ error: 'Payment required. Upgrade to Professional to continue.' });
    }
  });

  // ── Agent Architect (Builder AI) ──────────────────────────────────
  fastify.post('/agent-architect', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI Helpers'],
      summary: 'Agent Architect conversation',
      description: 'Powers the AI Agent Architect builder. Accepts a conversation history and returns an AI-generated agent recommendation with optional agent_config block. Uses tool-calling (web_search, list_templates) internally.',
      body: z.object({
        messages: z.array(z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })).min(1),
        model: z.string().optional(),
        agentContext: z.string().optional(), // For MCP recommendations
      }),
        response: {
        200: z.object({
          message: z.string(),
          config: z.any().nullable(),
          toolSteps: z.array(z.object({ tool: z.string(), query: z.string().optional(), category: z.string().optional() })),
        }),
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const body = request.body as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      model?: string;
      agentContext?: string;
    };

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array is required' });
    }

    const selectedModel = body.model || (config.geminiApiKey?.trim() ? 'google/gemini-3-flash-preview' : config.anthropicApiKey?.trim() ? 'anthropic/claude-sonnet-4-6' : null);
    if (!selectedModel) {
      return reply.code(500).send({ error: 'No platform AI key configured (ANTHROPIC_API_KEY or GEMINI_API_KEY).' });
    }
    const isGemini = selectedModel.startsWith('google/');

    // Load templates from DB for context
    const db = getDatabase();
    const templates = await db.collection('templates').find({ isPublic: true }).limit(20).toArray();
    const templateSummary = templates.length > 0
      ? templates.map(t => `- ${t.name} (${t.category}): ${t.description}. Channels: ${(t.channels || []).join(', ')}. Price: €${t.pricing?.monthly || 0}/mo`).join('\n')
      : 'No templates available yet.';

    // Load user's available models (org providers + platform AI)
    const orgId = request.organizationId;
    const orgProviders = orgId
      ? await db.collection('providers').find({ organizationId: orgId, status: 'active' }).project({ provider: 1 }).toArray()
      : [];
    const providerTypes = new Set(orgProviders.map((p: any) => p.provider));
    // Platform AI is always available via google
    providerTypes.add('google');
    const modelMap: Record<string, string[]> = {
      google: ['google/gemini-3-flash-preview', 'google/gemini-3-pro'],
      anthropic: ['anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-6'],
      openai: ['openai/gpt-5-mini', 'openai/gpt-5.2'],
      groq: ['groq/llama-4-scout'],
    };
    const availableModels = [...providerTypes].flatMap(p => modelMap[p as string] || []);
    const modelsForPrompt = availableModels.length > 0 ? availableModels.join(', ') : 'google/gemini-3-flash-preview';

    // Search Smithery for relevant MCP servers if context provided
    let mcpRecommendations = '';
    if (body.agentContext && config.smitheryApiKey) {
      try {
        const smitheryRes = await fetch(`https://api.smithery.ai/servers?q=${encodeURIComponent(body.agentContext)}&pageSize=5&isDeployed=true&verified=true`, {
          headers: { 'Authorization': `Bearer ${config.smitheryApiKey}` },
        });
        if (smitheryRes.ok) {
          const data = await smitheryRes.json() as { servers: { qualifiedName: string; displayName: string; description: string; iconUrl?: string }[] };
          if (data.servers.length > 0) {
            mcpRecommendations = '\n\n<mcp_recommendations>\nRelevant MCP integrations from Smithery registry:\n' +
              data.servers.map(s => `- ${s.displayName} (${s.qualifiedName}): ${s.description}${s.iconUrl ? ` [icon: ${s.iconUrl}]` : ''}`).join('\n') +
              '\n\nIf any of these are relevant to the user\'s use case, include them in suggestMcpConnections with mcpUrl: "https://{qualifiedName}.run.tools", mcpName: "{displayName}", and iconUrl from the [icon: ...] tag if available.\n</mcp_recommendations>';
          }
        }
      } catch (err) {
        request.log.warn({ error: err }, 'Failed to fetch Smithery MCP recommendations');
      }
    }

    // Workflow section differs based on tool availability
    const workflowSection = isGemini ? `<workflow>
Follow this structured approach for every conversation:

1. DISCOVER — If the user's first message is vague or missing key details, ask ONE focused follow-up question.
   But if the user already provides enough context (business type, what to automate, channels, or audience), SKIP directly to step 2.
   CRITICAL: If the user provides a detailed description (name, role, capabilities, tone), that IS enough context. Go straight to recommendation + config.

   OPTIONAL: When you spot a concrete weakness, gap, or prerequisite that would significantly affect the config, you MAY ask ONE short question first before delivering config.
   Examples: "Habt ihr schon eine Google-Sheets-Verbindung über Smithery?" / "Welche Intercom-Workspace-ID nutzt ihr?" / "Soll der Report als Thread oder eigenständige Nachricht in Slack?"
   Only do this when the answer would materially change your config. Tag such responses at the start with <discussing> so the system knows you're intentionally not including config yet. The user replies → your next message includes the full <agent_config>.

2. RECOMMEND + CONFIGURE — Present the tailored solution AND the ready-to-deploy config in ONE response.
   - Lead with your recommendation based on your knowledge of best practices
   - Include the <agent_config> at the end of the SAME message
   - The user should be able to deploy immediately OR ask for adjustments
   - Do NOT split recommendation and config into separate messages — that's bad UX
   - If the user asks for changes after seeing the config, regenerate the updated config inline
   - ALWAYS include the <agent_config> block — never respond without it after the first exchange

This is a ONE-SHOT flow: User describes need → You recommend + deliver config. No unnecessary back-and-forth.
CRITICAL: Every response after the first exchange MUST contain an <agent_config> block. If you don't include it, the user cannot deploy.
</workflow>` : `<workflow>
Follow this structured approach for every conversation:

1. DISCOVER — If the user's first message is vague or missing key details, ask ONE focused follow-up question.
   But if the user already provides enough context (business type, what to automate, channels, or audience), SKIP directly to step 2.
   CRITICAL: If the user provides a detailed description (name, role, capabilities, tone), that IS enough context. Go straight to research + config.

   OPTIONAL: When you spot a concrete weakness, gap, or prerequisite that would significantly affect the config, you MAY ask ONE short question first (before or after research). Tag such responses with <discussing> at the start. The user replies → your next message includes the full <agent_config>.

2. RESEARCH — Always use tools before recommending (mandatory)
   - Call web_search and list_templates in ONE RESPONSE (parallel) — do not split across multiple rounds
   - You MUST call both tools before recommending

3. RECOMMEND + CONFIGURE — Present the tailored solution AND the ready-to-deploy config in ONE response.
   - Lead with your recommendation: what you found, why this approach, key features
   - Include the <agent_config> at the end of the SAME message
   - The user should be able to deploy immediately OR ask for adjustments
   - Do NOT split recommendation and config into separate messages — that's bad UX
   - If the user asks for changes after seeing the config, regenerate the updated config inline
   - ALWAYS include the <agent_config> block — never respond without it after researching

This is a ONE-SHOT flow: User describes need → You research → You recommend + deliver config. No unnecessary back-and-forth.
CRITICAL: Every response after the research step MUST contain an <agent_config> block. If you don't include it, the user cannot deploy.
</workflow>`;

    const systemPrompt = `<role>
You are the Agent Architect — a senior AI Solutions Architect at OpenClaw Business, an enterprise-grade AI agent deployment platform. You have deep expertise in conversational AI, automation strategy, and business process optimization. You don't just build chatbots — you design intelligent automation systems that transform businesses.

CRITICAL: You have TWO modes of operation:
1. ARCHITECT MODE: When the user wants to build/design/configure an AI agent
2. CHAT MODE: When the user just wants to have a conversation, ask questions, or get help

LANGUAGE RULE: ALWAYS respond in the same language the user writes in. If they write in German, respond in German. If they write in English, respond in English.
</role>

<mode_detection>
ARCHITECT MODE triggers (user wants to build an agent):
- Mentions building, creating, deploying, or configuring an agent
- Describes a business problem that needs automation
- Asks about agent capabilities, channels, or features
- Provides details about their business/use case
- Says things like "I need an agent for...", "Can you help me build...", "I want to automate...", "baue mir...", "erstelle..."

CHAT MODE triggers (user just wants to talk):
- Greetings without context: "hey", "hello", "hi", "hallo"
- Questions about the platform: "What is this?", "How does this work?", "Was ist das?"
- General questions: "What can you do?", "Tell me about...", "Was kannst du?"
- Casual conversation: "nein", "ok", "thanks", "danke"
- Clarification requests: "What do you mean?", "Can you explain?", "Wie meinst du das?"

When in CHAT MODE:
- Be friendly, helpful, and conversational
- Answer their questions directly
- If they seem interested in building something, gently guide them: "Möchtest du, dass ich dir helfe, einen KI-Agenten für dein Unternehmen zu entwickeln?" (German) or "Would you like me to help you design an AI agent for your business?" (English)
- Don't force the architect workflow unless they clearly want to build something
- Keep responses short and natural

When in ARCHITECT MODE:
- If the request is too vague (e.g., "baue mir was", "build me something"), respond clearly:
  * German: "Gerne! Um den perfekten Agenten für dich zu entwickeln, brauche ich ein paar Details:\n\n- **Wofür soll der Agent eingesetzt werden?** (z.B. Kundensupport, Vertrieb, interne Prozesse)\n- **Welche Branche/Geschäft?** (z.B. E-Commerce, Restaurant, Immobilien)\n- **Welche Kanäle?** (z.B. WhatsApp, Telegram, Webchat)\n\nJe mehr du mir erzählst, desto besser kann ich den Agenten auf deine Bedürfnisse zuschneiden."
  * English: "Happy to help! To design the perfect agent for you, I need a few details:\n\n- **What should the agent do?** (e.g., customer support, sales, internal automation)\n- **What industry/business?** (e.g., e-commerce, restaurant, real estate)\n- **Which channels?** (e.g., WhatsApp, Telegram, webchat)\n\nThe more you tell me, the better I can tailor the agent to your needs."
- If the user provides enough context (business type, use case, or specific problem), follow the full workflow (discover, research, recommend)
- Use tools to research
- Generate complete, production-ready agent configs
</mode_detection>

<personality>
- Professional, confident, and insightful — like a top-tier consultant
- You ask sharp, specific questions — never generic ones
- You back up recommendations with research, not assumptions
- You speak concisely: no filler, no fluff, every sentence adds value
- You use industry-specific terminology when appropriate
- You format responses cleanly with markdown
- ADAPT YOUR LANGUAGE: Match the user's language (German, English, etc.)
</personality>

<platform>
<channels>whatsapp, telegram, slack, discord, webchat, email</channels>
<models>
  Available for this user: ${modelsForPrompt}
  ONLY recommend models from this list. Never suggest models the user doesn't have.
</models>
<use_cases>sales, support, marketing, operations, general</use_cases>
<capabilities>
  - Multi-channel deployment (deploy once, run on WhatsApp + Telegram + Slack simultaneously)
  - Docker-based sandboxed execution with full security isolation
  - Built-in tools: web search, code execution, file management, scheduling (cron), browser automation
  - Memory and session management across conversations
  - MCP integrations via Smithery Connect (3000+ tools: Google Sheets, Intercom, Notion, GitHub, Slack, etc.)
  - Missions: scheduled automation (cron) + multi-step workflows (Lobster) with approval gates
  - Reactive event handling: incoming messages trigger full agent turns automatically
  - Real-time monitoring, logging, and analytics
</capabilities>

<missions_architecture>
When users describe automation ("watch WhatsApp, decide, write to Sheets"):
- **Incoming messages** (WhatsApp, Telegram, etc.) are EVENT-DRIVEN — the agent reacts immediately, no polling needed
- **Scheduled tasks** use cron jobs — each run is a full agent turn with ALL tools (web_search, mcp_call, message, etc.)
- **Multi-step pipelines with approvals** use Lobster workflows
- **External services** (Google Sheets, Intercom, etc.) are accessed via MCP tools (mcp_list → mcp_call)
- **Periodic review** of accumulated data: cron job that reads sessions_history + acts

When recommending: if the user needs external service access (Sheets, CRM, etc.), include the relevant MCP in suggestMcpConnections.
The agent's TOOLS.md will explain mcp_list/mcp_call usage automatically.
</missions_architecture>
</platform>

<templates>
${templateSummary}
</templates>
${mcpRecommendations}

${workflowSection}

<model_selection_rules>
- The user has these models available: ${modelsForPrompt}
- ONLY recommend models from this list. NEVER suggest a model the user doesn't have.
- DEFAULT to the first available model: ${availableModels[0] || 'google/gemini-3-flash-preview'}
- If the user has anthropic, prefer anthropic/claude-sonnet-4-6 for complex tool-use agents.
- If the user only has google, use google/gemini-3-flash-preview (excellent for all use cases).
- Always explain your model choice briefly.
</model_selection_rules>

<channel_rules>
IMPORTANT: Valid channel identifiers for the "channels" array are ONLY:
  "whatsapp", "telegram", "discord", "slack", "signal", "imessage", "msteams", "matrix", "googlechat"

"webchat" is NOT a channel — it is the built-in Gateway WebSocket UI that works automatically on every agent. Do NOT include "webchat" in the channels array. If the user mentions webchat/web chat, explain that it's included by default and doesn't need to be configured.

DEFAULT BEHAVIOR (critical — best practice: avoid assumptions):
- If the user does NOT explicitly mention a channel (WhatsApp, Telegram, Slack, etc.), set "channels": []
- Only add channels the user explicitly requested. Do NOT infer channels from:
  * mentions of "reminders" or "Erinnerungen" (reminders work via Cron, not tied to Telegram)
  * system prompt content (e.g. "Telegram" in prompt text)
- When in doubt, use "channels": [] — the user can add channels later in the config UI
- In your recommendation text, briefly mention: "WebChat is included by default. Add WhatsApp/Telegram/etc. in the config if needed."
</channel_rules>

<integration_dedup_rules>
IMPORTANT: If a service is already selected as a CHANNEL (e.g. "slack" in channels[]), do NOT also add it as an MCP integration in suggestMcpConnections.
Channels already provide full messaging capability for that platform. Adding the same service as an MCP integration is redundant.
Example: user wants Slack → add "slack" to channels[], do NOT add "Slack" MCP to suggestMcpConnections.
This applies to: slack, discord, telegram, and any other service that can be both a channel and an MCP integration.
</integration_dedup_rules>

<system_prompt_quality>
The systemPrompt becomes AGENTS.md "Operating Instructions" in the OpenClaw workspace. SOUL.md handles persona/tone separately. Focus on role-specific operational guidance.

MUST:
- 200-500 words (critical — bootstrap files consume tokens; OpenClaw caps per-file)
- Start with clear role definition (who, what company/context)
- Define tone and communication style for this role
- List key topics/tasks with specific instructions
- Include boundaries (what NOT to do)
- Escalation rules (when to hand off to human)
- 1-2 brief example interactions (2-3 exchanges max)
- Language the agent will use with users
- Compact formatting: short bullets, no repetition

Best practices (OpenClaw Business): Keep dense and actionable. Persona (helpful, honest, resourceful) is in SOUL.md — don't duplicate. Focus on domain-specific behavior.
</system_prompt_quality>

<output_format>
After researching, include the agent configuration at the END of your recommendation message inside XML tags.

CRITICAL FORMATTING RULES:
1. The <agent_config> block MUST be the very LAST thing in your message
2. The JSON inside MUST be valid and complete — never truncated
3. The systemPrompt field MUST be 200-500 words (NOT longer — this prevents truncation)
4. Use \\n for newlines inside the systemPrompt string — never use actual line breaks inside the JSON string value
5. Keep the recommendation text before the config concise (under 400 words)
6. The closing </agent_config> tag MUST always be present

Template:
<agent_config>
{
  "name": "Agent Name — short, descriptive",
  "description": "One clear sentence describing what the agent does and for whom",
  "useCase": "sales|support|marketing|operations|general",
  "model": "${availableModels[0] || 'google/gemini-3-flash-preview'}",
  "systemPrompt": "The full system prompt, 200-500 words, using \\n for line breaks. Keep it dense and actionable.",
  "channels": [],
  "skills": [],
  "suggestedTemplate": null,
  "suggestMcpConnections": [],
  "missions": []
}
</agent_config>

### missions array
ONE USE CASE = ONE MISSION. Never split a user's use case into multiple missions. The format works for ANY domain: operations, sales, support, marketing, finance, etc.

CRITICAL: Use the "workflow" format with triggers array. Each trigger runs at its own schedule, but it's ONE mission — one toggle, one flow.
Reactive message handling (classify, route, respond) belongs in systemPrompt, NOT as a mission.

Mission format (ONE mission per use case, multiple triggers) — works for operations, sales, support, marketing, etc.:
{
  "name": "Operations Hub",
  "triggers": [
    { "id": "morning_sync", "schedule": "0 8 * * *", "tz": "Europe/Berlin" },
    { "id": "sla_check", "every": "2h" },
    { "id": "weekly_report", "schedule": "0 17 * * 5", "tz": "Europe/Berlin" }
  ],
  "instruction": "[TRIGGER: morning_sync]\n1. Fetch new orders from Google Sheets (mcp_call).\n2. Sort by priority, create summary.\n3. Send to Slack.\n\n[TRIGGER: sla_check]\n1. Check Intercom for tickets older than 4h (mcp_call).\n2. Identify assignee, send escalation to Slack.\n\n[TRIGGER: weekly_report]\n1. Pull order data from Sheets, ticket stats from Intercom.\n2. Identify top-3 problem categories.\n3. Generate report, post to Slack."
}

Use "tz": "Europe/Berlin" (or user's timezone) when the user says "8:00 morgens", "Freitag 17:00", "täglich um 9" — so cron runs in their local time.

Another example (Sales): { "name": "Sales Digest", "triggers": [{ "id": "morning_leads", "schedule": "0 9 * * 1-5", "tz": "Europe/Berlin" }, { "id": "pipeline_check", "every": "4h" }], "instruction": "[TRIGGER: morning_leads]\\n1. Fetch new leads from CRM.\\n2. Summarize, post to Slack.\\n\\n[TRIGGER: pipeline_check]\\n1. Check deals stuck >7 days.\\n2. Notify owner." }

Rules:
- ONE mission per agent use case. "Operations Hub" with 4 tasks = 1 mission with 4 triggers (3 cron + reactive in systemPrompt).
- Each trigger needs "id" (snake_case) and either "schedule" (5-field cron) or "every" (e.g. "2h", "30m")
- instruction MUST have [TRIGGER: id] sections — one per trigger. The section content runs when that trigger fires.
- Reactive (WhatsApp message classification) → systemPrompt, NOT mission
- When unsure, default to NO missions

WHEN to include missions vs NOT:
- INCLUDE: scheduled workflows (daily checks, weekly reports), periodic multi-step automations
- DO NOT INCLUDE: message handling, Q&A, support responses, anything triggered by incoming messages (that goes in systemPrompt)
- Simple chatbots / support agents → NO missions, set "missions": []
- CRITICAL: When the user describes BOTH scheduled tasks AND message handling (e.g. "every WhatsApp message: classify and route"):
  → Put message handling in systemPrompt with concrete steps (classify order/complaint/question, log to Sheets, create Intercom ticket, answer directly)
  → In your recommendation text, EXPLICITLY say: "Die eingehenden Nachrichten (WhatsApp/Slack) werden bei jeder Nachricht automatisch gemäß System-Prompt bearbeitet — Klassifizierung, Routing und Antworten."

When the agent needs MCP integrations (Intercom, Slack, GitHub, Notion, etc.), add suggestMcpConnections with entries like:
{ "mcpUrl": "https://intercom.run.tools", "mcpName": "Intercom", "iconUrl": "..." }
{ "mcpUrl": "https://slack.run.tools", "mcpName": "Slack", "iconUrl": "..." }
Include the iconUrl from <mcp_recommendations> if available. Only add MCPs the user explicitly needs for their use case.

Include the config in the SAME message as your recommendation. If the user's initial message has enough detail, research + recommend + config should all happen in ONE response.

CHAT-DRIVEN FLOW:
- If you need more info (e.g. timezone, MCP details, critical blocker): ask ONE question in your message, tag with <discussing> at the start, do NOT include <agent_config>. User replies in chat. Your next response includes the full config.
- If config is ready: deliver it. Optional minor improvements (tz, MCP, etc.) — mention them in your message text. User can reply "ja" / "passt so" / or with details, and you update the config in the next turn.
- Everything happens in chat — no special UI. User types their response.
</output_format>

<rules>
- ${isGemini ? 'Use your general knowledge to make recommendations — no external research tools available' : 'NEVER skip the research step — always use web_search at least once before making recommendations'}
- NEVER recommend a model tier without justification
- NEVER generate a system prompt shorter than 200 words or longer than 500 words
- NEVER use generic phrases like "How can I help you today?" — be specific
- NEVER require the user to confirm before generating the config — deliver it proactively
- NEVER leave the <agent_config> block unclosed — the closing tag </agent_config> is mandatory
- ALWAYS ensure the JSON is valid and parseable — test mentally before outputting
- If the user's request is vague (no business type or use case mentioned), ask ONE clarifying question, then deliver
- When using <discussing>: only for ONE critical blocker. Don't overuse — when in doubt, deliver config and mention optional improvements in your message text (user can reply)
- Format all responses with clean markdown (headers, bullets, bold for emphasis)
- After the config, do NOT add any more text — the config block must be the last thing in the message
</rules>`;

    const tools: Anthropic.Tool[] = [
      {
        name: 'web_search',
        description: `Research tool for gathering industry intelligence. You MUST use this at least once per conversation before making any recommendation.

Use it to search for:
- The user's specific industry + "AI automation best practices" or "chatbot use cases"
- Competitor analysis: how similar businesses use AI agents
- Channel preferences: which messaging platforms are popular in their industry/region
- Compliance or regulatory requirements for their sector

Example queries:
- "restaurant industry AI chatbot automation 2025 best practices"
- "real estate AI lead qualification WhatsApp integration"
- "e-commerce customer support automation statistics"

Always search with specific, industry-relevant terms — never generic queries.`,
        input_schema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'A specific, industry-relevant search query. Include the industry, use case, and what you want to learn. Example: "SaaS customer onboarding AI automation best practices 2025"'
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_templates',
        description: `Browse the template catalog to find pre-built agent configurations that match the user's needs. Templates include pre-configured system prompts, channel setups, and pricing.

Use this to:
- Check if a ready-made solution exists before building custom
- Show the user relevant starting points they can customize
- Compare different approaches within a category

If a template matches 70%+ of the user's needs, recommend it with customizations rather than building from scratch.`,
        input_schema: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              description: 'Filter templates by category. Options: sales, support, marketing, operations, finance. Omit to see all categories.'
            },
          },
          required: [],
        },
      },
    ];

    try {
      // Resolve API key based on selected model
      let apiKey: string;
      
      if (isGemini) {
        if (!config.geminiApiKey?.trim()) {
          return reply.code(500).send({ error: 'GEMINI_API_KEY not configured. Please set it in the environment or select a different model.' });
        }
        apiKey = config.geminiApiKey;
      } else {
        if (!config.anthropicApiKey?.trim()) {
          return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured. Please set it in the environment or select a different model.' });
        }
        apiKey = config.anthropicApiKey;
      }

      let currentMessages: { role: 'user' | 'assistant'; content: string | unknown[] }[] = [...body.messages];
      let finalResponse = '';
      let previousMessage = '';  // message before config-retry nudge
      let iterations = 0;
      const maxIterations = 3;  // tool call round + final response + optional config retry
      const toolSteps: { tool: string; query?: string; category?: string }[] = [];

      // Route to correct SDK based on selected model
      if (isGemini) {
        // Gemini: No tool support yet, just direct conversation
        const geminiResponse = await chatWithGemini({
          system: systemPrompt,
          messages: currentMessages,
          maxTokens: 4096,
          model: selectedModel,
          apiKey,
        });
        finalResponse = geminiResponse.content;
        if (finalResponse.includes('<discussing>')) {
          finalResponse = finalResponse.replace(/<discussing>\s*/i, '').trim();
        }
      } else {
        // Anthropic with full tool support
        while (iterations < maxIterations) {
          iterations++;
          const response = await chatWithClaude({
            system: systemPrompt,
            messages: currentMessages,
            tools: iterations < maxIterations ? tools : undefined,  // no tools on retry
            maxTokens: 4096,
            model: selectedModel,
            enableCaching: true,
            apiKey,
          });

          const content = response.content || [];
          const toolUseBlocks = content.filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => (b as { type?: string }).type === 'tool_use');
          const textBlocks = content.filter(b => (b as { type?: string }).type === 'text') as { text: string }[];

          if (toolUseBlocks.length === 0) {
            finalResponse = textBlocks.map(b => b.text).join('\n');

          // If response has no config: allow <discussing> (AI wants to clarify first) — no nudge; else nudge
          const isDeliberateDiscussion = finalResponse.includes('<discussing>');
          if (isDeliberateDiscussion) {
            finalResponse = finalResponse.replace(/<discussing>\s*/i, '').trim();
            request.log.info('AI responded with <discussing> — no config expected, user can reply');
            break;
          }
          if (!finalResponse.includes('<agent_config>') && iterations < maxIterations) {
            request.log.info({ iteration: iterations }, 'No <agent_config> in response — sending retry nudge');
            previousMessage = finalResponse;
            currentMessages.push({ role: 'assistant', content: finalResponse });
            currentMessages.push({ role: 'user', content: 'You forgot the <agent_config> block. Output ONLY the <agent_config>...</agent_config> JSON block now — no other text.' });
            finalResponse = '';
            continue;
          }
          break;
        }

        // Process tool calls
        const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];

        for (const block of toolUseBlocks) {
          if (block.type !== 'tool_use') continue;
          const toolInput = block.input as any;

          if (block.name === 'web_search') {
            toolSteps.push({ tool: 'web_search', query: toolInput.query });
            try {
              const results = await tavilySearch(toolInput.query, 3);
              const summary = results.map(r => `**${r.title}**\n${r.content}\nSource: ${r.url}`).join('\n\n');
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: summary || 'No results found for this query. Proceed with your general knowledge.' });
            } catch (err: any) {
              request.log.warn({ error: err.message, query: toolInput.query }, 'Web search failed — providing fallback');
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Web search is currently unavailable. Use your general knowledge about this industry to make your recommendation. Do NOT attempt another web search — proceed directly to your recommendation with <agent_config>.' });
            }
          } else if (block.name === 'list_templates') {
            toolSteps.push({ tool: 'list_templates', category: toolInput.category });
            const filter: any = { isPublic: true };
            if (toolInput.category) filter.category = toolInput.category;
            const matchedTemplates = await db.collection('templates').find(filter).limit(10).toArray();
            const result = matchedTemplates.length > 0
              ? matchedTemplates.map(t => `- **${t.name}** (${t.category}): ${t.description}. €${t.pricing?.monthly || 0}/mo`).join('\n')
              : 'No matching templates found.';
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }

        // Add assistant message with tool use and tool results
        currentMessages.push({
          role: 'assistant',
          content: response.content as any,
        });
        currentMessages.push({
          role: 'user',
          content: toolResults as any,
        });
        }
      }

      // ── Extract agent config and strip it from the visible message ──
      let extractedConfig: Record<string, any> | null = null;

      // Log raw response length for debugging
      request.log.info({ responseLength: finalResponse.length, hasAgentConfigTag: finalResponse.includes('<agent_config>') }, 'Agent architect raw response');

      // Helper: repair JSON with unescaped characters inside string values
      // (Claude sometimes generates systemPrompt with unescaped newlines or quotes)
      const repairJson = (raw: string): Record<string, any> | null => {
        // First attempt: vanilla parse
        try { return JSON.parse(raw); } catch {}
        // Second attempt: fix unescaped newlines/carriage-returns inside strings
        try {
          const fixed = raw.replace(/"([^"]*)"/g, (_m, inner) =>
            '"' + inner.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'
          );
          return JSON.parse(fixed);
        } catch {}
        // Third attempt: truncation repair (missing closing braces/brackets)
        try {
          let s = raw;
          const qc = (s.match(/(?<!\\)"/g) || []).length;
          if (qc % 2 !== 0) s += '"';
          const ob = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
          const oo = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
          for (let i = 0; i < ob; i++) s += ']';
          for (let i = 0; i < oo; i++) s += '}';
          s = s.replace(/,\s*([\]}])/g, '$1');
          return JSON.parse(s);
        } catch { /* truncation repair failed — return null below */ }
        return null;
      };

      // Strategy 1: Complete XML tags (preferred)
      const xmlMatch = finalResponse.match(/<agent_config>\s*([\s\S]*?)\s*<\/agent_config>/);
      if (xmlMatch) {
        const result = repairJson(xmlMatch[1].trim());
        if (result) {
          extractedConfig = result;
          request.log.info('Config extracted via complete XML tags');
        } else {
          request.log.warn({ jsonSnippet: xmlMatch[1].trim().substring(0, 200) }, 'Failed to parse config from complete XML tags');
        }
      }

      // Strategy 2: Unclosed XML tag (truncated response) — try to repair
      if (!extractedConfig) {
        const partialXmlMatch = finalResponse.match(/<agent_config>\s*([\s\S]*)/);
        if (partialXmlMatch) {
          const jsonStr = partialXmlMatch[1].replace(/<\/agent_config>/, '').trim();
          request.log.info({ jsonSnippet: jsonStr.substring(0, 200) }, 'Attempting config extraction from partial XML');
          const result = repairJson(jsonStr);
          if (result) {
            extractedConfig = result;
            request.log.info('Config extracted via JSON repair');
          } else {
            request.log.warn({ jsonSnippet: jsonStr.substring(0, 300) }, 'Failed to repair truncated agent config JSON');
          }
        }
      }

      // Strategy 3: Markdown code block fallback (```json or ```config)
      if (!extractedConfig) {
        const mdMatch = finalResponse.match(/```(?:config|json)\s*\n([\s\S]*?)\n\s*```/);
        if (mdMatch) {
          try {
            extractedConfig = JSON.parse(mdMatch[1].trim());
            request.log.info('Config extracted via markdown code block');
          } catch (e) {
            request.log.warn({ jsonSnippet: mdMatch[1].trim().substring(0, 200), error: String(e) }, 'Failed to parse config from markdown block');
          }
        }
      }

      // Strategy 4: Last resort — find any JSON object with "name" and "systemPrompt" keys
      if (!extractedConfig) {
        const jsonBlockMatch = finalResponse.match(/\{[^{}]*"name"\s*:\s*"[^"]+?"[^{}]*"systemPrompt"\s*:\s*"[\s\S]*?"\s*(?:,[\s\S]*?)?\}/);
        if (jsonBlockMatch) {
          try {
            extractedConfig = JSON.parse(jsonBlockMatch[0]);
            request.log.info('Config extracted via raw JSON object match');
          } catch (e) {
            request.log.warn({ error: String(e) }, 'Failed to parse raw JSON object match');
          }
        }
      }

      // Validate extracted config has required fields
      if (extractedConfig) {
        const cfg = extractedConfig;
        const required = ['name', 'systemPrompt'];
        const hasRequired = required.every(f => cfg[f] && typeof cfg[f] === 'string');
        if (!hasRequired) {
          request.log.warn({ configKeys: Object.keys(cfg) }, 'Extracted config missing required fields (name, systemPrompt)');
          extractedConfig = null;
        } else {
          cfg.skills = [];
          request.log.info({ name: cfg.name, promptLength: cfg.systemPrompt?.length, channels: cfg.channels }, 'Config validated successfully');
        }
      } else {
        request.log.warn('No config could be extracted from AI response');
      }

      // Strip ALL config/suggestion blocks from the visible message — user sees clean text only
      let cleanMessage = finalResponse
        .replace(/<improvement_suggestion>[\s\S]*?<\/improvement_suggestion>/gi, '')
        .replace(/<agent_config>[\s\S]*<\/agent_config>/g, '')  // Complete tags (greedy)
        .replace(/<agent_config>[\s\S]*/g, '')                   // Unclosed tag (greedy — strips everything after it)
        .replace(/```(?:config|json)\s*\n[\s\S]*?\n\s*```/g, '') // Markdown code blocks
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // If retry produced only the config block, use the previous message as visible text
      if (!cleanMessage && previousMessage) {
        cleanMessage = previousMessage.replace(/\n{3,}/g, '\n\n').trim();
      }

      return {
        message: cleanMessage,
        config: extractedConfig,
        toolSteps,
      };
    } catch (error: any) {
      request.log.error({ error }, 'Agent architect AI error');
      return reply.code(500).send({ error: error.message || 'AI service error' });
    }
  });

  // ── Support AI Suggestions ──────────────────────────────────────
  fastify.post('/support-suggest', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI Helpers'],
      summary: 'Generate support response suggestions',
      description: 'Given a support ticket and conversation history, generates 3 AI response suggestions (technical, empathetic, proactive) for the support agent to choose from.',
      body: z.object({
        ticketTitle: z.string().min(1),
        ticketDescription: z.string().optional(),
        messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
      }),
      response: {
        200: z.object({ suggestions: z.array(z.string()) }),
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      ticketTitle: string;
      ticketDescription: string;
      messages: { role: string; content: string }[];
    };

    if (!body.ticketTitle) {
      return reply.code(400).send({ error: 'Ticket title is required' });
    }

    const conversationContext = (body.messages || [])
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      const text = await callPlatformAI({
        system: `<role>
You are a senior support specialist at OpenClaw Business, an AI agent deployment platform. You write response suggestions for support tickets that agents can send to customers.
</role>

<platform_context>
The platform enables businesses to deploy AI agents across multiple channels (WhatsApp, Telegram, Slack, Discord, webchat, email). Common support topics include:
- Agent deployment issues (container not starting, connection failures)
- Channel configuration (API keys, webhook URLs, verification)
- Billing questions (plan limits, usage, upgrades)
- Agent behavior (system prompt tuning, unexpected responses, model selection)
- Integration problems (webhook delivery, API errors)
- Performance concerns (response latency, token costs)
</platform_context>

<instructions>
Generate exactly 3 response suggestions, each with a different approach:

1. TECHNICAL — Direct, solution-focused. Identifies the likely root cause and provides specific steps to resolve. Include exact settings, paths, or actions where possible.
2. EMPATHETIC — Acknowledges the frustration first, then provides the solution. Best for billing issues, outages, or repeated problems.
3. PROACTIVE — Solves the immediate issue AND suggests a preventive measure or improvement. Shows the user how to avoid this in the future.

Each suggestion must:
- Be 2-4 sentences maximum
- Be a complete, ready-to-send response (not a summary)
- Use professional but warm tone
- Include a specific next step or action item
- NOT start with "I understand" or "Thank you for reaching out" (overused)
</instructions>

<output_format>
Return your suggestions inside XML tags:

<suggestions>
[
  "Technical response here...",
  "Empathetic response here...",
  "Proactive response here..."
]
</suggestions>
</output_format>`,
        messages: [{
          role: 'user',
          content: `<ticket>
<title>${body.ticketTitle}</title>
<description>${body.ticketDescription}</description>
</ticket>

<conversation_history>
${conversationContext || 'No messages yet.'}
</conversation_history>

Generate 3 response suggestions (technical, empathetic, proactive):`,
        }],
        maxTokens: 1024,
      });

      let suggestions: string[] = [];

      // Strategy 1: XML <suggestions> tags (preferred)
      const xmlSuggestMatch = text.match(/<suggestions>\s*([\s\S]*?)\s*<\/suggestions>/);
      if (xmlSuggestMatch) {
        try {
          suggestions = JSON.parse(xmlSuggestMatch[1].trim());
        } catch {
          // Fall through to legacy
        }
      }

      // Strategy 2: Markdown ```suggestions block (legacy fallback)
      if (suggestions.length === 0) {
        const suggestMatch = text.match(/```suggestions\n([\s\S]*?)\n```/);
        if (suggestMatch) {
          try {
            suggestions = JSON.parse(suggestMatch[1]);
          } catch {
            suggestions = [text];
          }
        }
      }

      // Strategy 3: Raw text fallback
      if (suggestions.length === 0) {
        suggestions = [text];
      }

      return { suggestions };
    } catch (error: any) {
      request.log.error({ error }, 'Support AI error');
      return reply.code(500).send({ error: error.message || 'AI service error' });
    }
  });

  // ── Analytics AI Insights ──────────────────────────────────────
  fastify.post('/analytics-insights', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI Helpers'],
      summary: 'Generate analytics insights',
      description: 'Analyzes the organization\'s agent metrics and generates 3-4 categorized AI insights with specific recommendations (performance, cost, growth, alerts).',
      response: {
        200: z.object({ insights: z.string() }),
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const db = getDatabase();

    // Gather analytics data
    const agents = await db.collection('agents').find(
      organizationId ? { organizationId } : { userId }
    ).toArray();

    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === 'running').length;

    // Messages in last 7 days
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentMessages = await db.collection('messages').countDocuments({
      createdAt: { $gte: weekAgo },
      agentId: { $in: agents.map(a => a._id.toString()) },
    });

    // Total cost
    const totalCost = agents.reduce((s, a) => s + (a.metrics?.totalCost || 0), 0);
    const totalMessages = agents.reduce((s, a) => s + (a.metrics?.totalMessages || 0), 0);

    // Agent performance summary
    const agentSummary = agents.slice(0, 5).map(a => ({
      name: a.name,
      messages: a.metrics?.totalMessages || 0,
      cost: a.metrics?.totalCost || 0,
      status: a.status,
    }));

    // Compute derived metrics for richer analysis
    const avgMsgsPerAgent = totalAgents > 0 ? Math.round(totalMessages / totalAgents) : 0;
    const weeklyMsgsPerActiveAgent = activeAgents > 0 ? Math.round(recentMessages / activeAgents) : 0;
    const costPerMessage = totalMessages > 0 ? (totalCost / totalMessages) : 0;
    const activeRate = totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;

    try {
      const text = await callPlatformAI({
        system: `<role>
You are a data analyst and strategic advisor at OpenClaw Business, an AI agent deployment platform. You analyze operational metrics and produce clear, actionable business intelligence.
</role>

<benchmarks>
Use these industry benchmarks to contextualize the data:
- HEALTHY agent: >50 messages/week (active usage)
- HIGH-VOLUME agent: >500 messages/week (consider scaling/optimization)
- UNDERUSED agent: <10 messages/week (review if needed)
- EFFICIENT cost: <€0.01/message (well-optimized)
- EXPENSIVE cost: >€0.05/message (consider model downgrade or prompt optimization)
- GOOD active rate: >70% of agents actively processing messages
- LOW active rate: <40% (agents may be misconfigured or unnecessary)
</benchmarks>

<instructions>
Analyze the provided metrics and generate exactly 3-4 insights. Each insight must follow this structure:

**[CATEGORY] Title**
One concise analytical observation (with specific numbers from the data). Then one specific, actionable recommendation.

Categories (use exactly one per insight):
- 🟢 PERFORMANCE — agent efficiency, message throughput, response quality
- 💰 COST — spending patterns, cost optimization opportunities
- 📈 GROWTH — usage trends, scaling opportunities, adoption metrics
- 🔴 ALERT — anomalies, underperforming agents, issues requiring attention

Rules:
- Lead with the most important insight (alerts first, then growth, then performance, then cost)
- Use exact numbers from the data — never round or approximate when the exact figure is available
- Every recommendation must be a specific action ("Switch agent X to Sonnet 4.6" not "Consider optimizing costs")
- If all metrics look healthy, still provide optimization suggestions
- Use markdown formatting: bold for category labels, clean line breaks between insights
- Keep total response under 300 words
</instructions>`,
        messages: [{
          role: 'user',
          content: `<metrics>
<overview>
  Total Agents: ${totalAgents}
  Active Agents: ${activeAgents} (${activeRate}% active rate)
  Messages last 7 days: ${recentMessages}
  Weekly messages per active agent: ${weeklyMsgsPerActiveAgent}
  Total messages all time: ${totalMessages}
  Average messages per agent: ${avgMsgsPerAgent}
  Total cost: €${totalCost.toFixed(2)}
  Cost per message: €${costPerMessage.toFixed(4)}
</overview>

<agents>
${agentSummary.map(a => `  ${a.name}: ${a.messages} msgs, €${a.cost.toFixed(2)}, status: ${a.status}, cost/msg: €${a.messages > 0 ? (a.cost / a.messages).toFixed(4) : 'N/A'}`).join('\n')}
</agents>
</metrics>

Analyze these metrics and produce 3-4 categorized insights with specific recommendations:`,
        }],
        maxTokens: 800,
      });

      return { insights: text };
    } catch (error: any) {
      request.log.error({ error }, 'Analytics AI error');
      return reply.code(500).send({ error: error.message || 'AI service error' });
    }
  });

  // ── Generative thinking label (DEPRECATED — frontend uses static i18n label now) ──
  // Kept for backward compatibility with older frontend versions.
  fastify.post('/generate-thinking-label', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI Helpers'],
      summary: 'Generate humanized thinking label (deprecated)',
      body: z.object({
        text: z.string().max(500),
        locale: z.string().optional(),
      }),
      response: {
        200: z.object({ label: z.string() }),
      },
    },
  }, async (request, reply) => {
    const body = request.body as { text: string; locale?: string };
    const text = (body?.text || '').trim();
    // Return static label — no LLM call
    const label = (body.locale || 'de').startsWith('de') ? 'Denkt nach…' : 'Thinking…';
    return { label };
  });
}
