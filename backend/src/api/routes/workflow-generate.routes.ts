import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { chatWithClaude, resolvePlatformKey } from '../../services/ai.service.js';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import { validateObjectId } from '../../validation/schemas.js';

const generateSchema = z.object({
  prompt: z.string().min(1).max(5000),
  context: z.string().max(10000).optional(),
});

export async function workflowGenerateRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { id: string } }>('/:id/workflows/generate', {
    schema: { tags: ['Workflows'], summary: 'AI-generate a workflow from natural language', params: z.object({ id: z.string() }) },
  }, async (request, reply) => {
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    const db = getDatabase();
    const agent = await db.collection('agents').findOne({
      _id: new ObjectId(request.params.id),
      ...(request.organizationId ? { organizationId: request.organizationId } : { userId: request.userId }),
    });
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    const body = generateSchema.parse(request.body);

    const agentConfig = agent.config || {};
    const tools = (agentConfig.tools || []).map((t: any) => typeof t === 'string' ? t : t.name).filter(Boolean);
    const channels = (agent.channels || []).map((c: any) => c.type || c).filter(Boolean);

    const systemPrompt = `You are a workflow architect. Generate a Lobster workflow YAML from the user's description.

Available agent tools: ${tools.length > 0 ? tools.join(', ') : 'web_search, memory_search, browser, exec, read, write, message'}
Active channels: ${channels.length > 0 ? channels.join(', ') : 'none'}

Rules:
- Output ONLY valid Lobster YAML (name, steps, optional args)
- Each step needs: id, command (and optionally stdin, approval, condition, label)
- Use stdin: $prev_step.stdout to chain outputs
- Add approval: required before destructive actions
- Use condition: $step.approved for gated execution
- Keep step IDs short and descriptive (snake_case)
- Include a label field on each step with a human-readable description

Respond with a JSON object: { "name": string, "description": string, "yaml": string, "steps": [{ "id": string, "command": string, "label": string, "stdin?": string, "approval?": "required"|"optional", "condition?": string }] }

IMPORTANT: Respond ONLY with the JSON object, no markdown fences, no explanation.`;

    let platformKey: { provider: 'anthropic' | 'gemini'; apiKey: string };
    try {
      platformKey = resolvePlatformKey();
    } catch {
      return reply.code(400).send({ error: 'No AI provider configured' });
    }

    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...(body.context ? [
        { role: 'user' as const, content: `Context from our conversation:\n${body.context}` },
        { role: 'assistant' as const, content: 'Understood, I have the context. What workflow should I build?' },
      ] : []),
      { role: 'user' as const, content: body.prompt },
    ];

    try {
      const result = await chatWithClaude({
        system: systemPrompt,
        messages,
        apiKey: platformKey.apiKey,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
      });

      const text = result.content?.[0]?.type === 'text' ? (result.content[0] as any).text : JSON.stringify(result.content);
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return { workflow: parsed };
    } catch (err: any) {
      fastify.log.error({ error: err.message }, 'workflow-generate failed');
      return reply.code(500).send({ error: 'Failed to generate workflow' });
    }
  });
}
