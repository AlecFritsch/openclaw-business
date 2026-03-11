// Workflow Engine Service — orchestrates Lobster workflow execution with run tracking

import { getDatabase } from '../config/database.js';
import { ObjectId } from 'mongodb';
import { gatewayManager } from './gateway-ws.service.js';

// ── Types ──────────────────────────────────────────────────────

export type StepType = 'llm' | 'tool' | 'condition' | 'approval' | 'http' | 'wait' | 'transform';
export type TriggerType = 'manual' | 'cron' | 'webhook' | 'event';
export type RunStatus = 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_approval';

export interface WorkflowStep {
  id: string;
  type: StepType;
  name: string;
  config: Record<string, any>;
  condition?: string;        // JS expression referencing previous step outputs
  onFailure?: 'stop' | 'skip' | 'retry';
  retries?: number;
  timeout?: number;          // seconds
}

export interface WorkflowTrigger {
  type: TriggerType;
  config: Record<string, any>; // cron: { schedule }, webhook: { secret }, event: { channel, event }
}

export interface WorkflowVariable {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: any;
  required?: boolean;
  options?: string[];         // for select type
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
}

// ── Templates ──────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES = [
  {
    id: 'lead-qualification',
    name: 'Lead Qualification',
    description: 'Automatically qualify incoming leads based on criteria and route to the right team',
    category: 'sales',
    icon: 'target',
    steps: [
      { id: 'extract', type: 'llm' as StepType, name: 'Extract Lead Info', config: { prompt: 'Extract company name, size, industry, and budget from the following lead data:\n\n{{input}}', outputFormat: 'json' } },
      { id: 'score', type: 'llm' as StepType, name: 'Score Lead', config: { prompt: 'Score this lead 1-100 based on fit. Consider company size, industry match, and budget.\n\nLead: {{extract.output}}\n\nRespond with JSON: { "score": number, "tier": "hot"|"warm"|"cold", "reason": string }', outputFormat: 'json' } },
      { id: 'route', type: 'condition' as StepType, name: 'Route by Tier', config: { expression: 'score.output.tier', branches: { hot: 'Notify sales lead immediately', warm: 'Add to nurture sequence', cold: 'Archive with reason' } } },
      { id: 'notify', type: 'tool' as StepType, name: 'Send Notification', config: { tool: 'send_message', args: { message: 'New {{score.output.tier}} lead: {{extract.output.company}} — Score: {{score.output.score}}' } } },
    ],
    variables: [
      { key: 'input', label: 'Lead Data', type: 'string' as const, required: true },
    ],
  },
  {
    id: 'support-triage',
    name: 'Support Triage',
    description: 'Classify support tickets, check knowledge base, and draft responses',
    category: 'support',
    icon: 'headphones',
    steps: [
      { id: 'classify', type: 'llm' as StepType, name: 'Classify Ticket', config: { prompt: 'Classify this support ticket into: billing, technical, feature_request, bug, other.\n\nTicket: {{input}}\n\nRespond with JSON: { "category": string, "priority": "low"|"medium"|"high"|"urgent", "summary": string }', outputFormat: 'json' } },
      { id: 'search', type: 'tool' as StepType, name: 'Search Knowledge Base', config: { tool: 'memory_search', args: { query: '{{classify.output.summary}}' } } },
      { id: 'draft', type: 'llm' as StepType, name: 'Draft Response', config: { prompt: 'Draft a helpful support response.\n\nTicket: {{input}}\nCategory: {{classify.output.category}}\nKnowledge: {{search.output}}\n\nBe professional, empathetic, and solution-oriented.' } },
      { id: 'review', type: 'approval' as StepType, name: 'Review Response', config: { message: 'Review the drafted response before sending', approvers: 'team' } },
      { id: 'send', type: 'tool' as StepType, name: 'Send Response', config: { tool: 'send_message', args: { message: '{{draft.output}}' } } },
    ],
    variables: [
      { key: 'input', label: 'Ticket Content', type: 'string' as const, required: true },
    ],
  },
  {
    id: 'content-pipeline',
    name: 'Content Pipeline',
    description: 'Research a topic, generate content, and prepare for publishing',
    category: 'marketing',
    icon: 'pen',
    steps: [
      { id: 'research', type: 'tool' as StepType, name: 'Research Topic', config: { tool: 'web_search', args: { query: '{{topic}} latest trends {{year}}' } } },
      { id: 'outline', type: 'llm' as StepType, name: 'Create Outline', config: { prompt: 'Create a detailed content outline for: {{topic}}\n\nResearch: {{research.output}}\nFormat: {{format}}\nTone: {{tone}}\n\nReturn a structured outline with sections and key points.' } },
      { id: 'approve_outline', type: 'approval' as StepType, name: 'Approve Outline', config: { message: 'Review the content outline before writing' } },
      { id: 'write', type: 'llm' as StepType, name: 'Write Content', config: { prompt: 'Write the full content based on this outline:\n\n{{outline.output}}\n\nTopic: {{topic}}\nFormat: {{format}}\nTone: {{tone}}\nLength: {{length}} words' } },
      { id: 'review', type: 'approval' as StepType, name: 'Final Review', config: { message: 'Review the final content before publishing' } },
    ],
    variables: [
      { key: 'topic', label: 'Topic', type: 'string' as const, required: true },
      { key: 'format', label: 'Format', type: 'select' as const, options: ['Blog Post', 'Newsletter', 'Social Media', 'Report'], default: 'Blog Post' },
      { key: 'tone', label: 'Tone', type: 'select' as const, options: ['Professional', 'Casual', 'Technical', 'Persuasive'], default: 'Professional' },
      { key: 'length', label: 'Word Count', type: 'number' as const, default: 1000 },
    ],
  },
  {
    id: 'daily-report',
    name: 'Daily Report',
    description: 'Aggregate data from multiple sources and generate a daily summary report',
    category: 'operations',
    icon: 'chart',
    steps: [
      { id: 'gather', type: 'llm' as StepType, name: 'Gather Metrics', config: { prompt: 'Summarize the key metrics and events for today based on available data. Focus on: {{focus_areas}}' } },
      { id: 'analyze', type: 'llm' as StepType, name: 'Analyze Trends', config: { prompt: 'Analyze these metrics and identify trends, anomalies, and action items:\n\n{{gather.output}}\n\nProvide: 1) Key highlights 2) Concerns 3) Recommended actions' } },
      { id: 'format', type: 'transform' as StepType, name: 'Format Report', config: { template: '# Daily Report — {{date}}\n\n## Highlights\n{{analyze.output}}\n\n---\nGenerated automatically by {{agent_name}}' } },
      { id: 'deliver', type: 'tool' as StepType, name: 'Send Report', config: { tool: 'send_message', args: { message: '{{format.output}}' } } },
    ],
    variables: [
      { key: 'focus_areas', label: 'Focus Areas', type: 'string' as const, default: 'revenue, support tickets, user signups' },
    ],
  },
  {
    id: 'data-enrichment',
    name: 'Data Enrichment',
    description: 'Enrich a list of records with additional data from web research',
    category: 'operations',
    icon: 'database',
    steps: [
      { id: 'parse', type: 'llm' as StepType, name: 'Parse Input', config: { prompt: 'Parse this data into a JSON array of records. Each record should have the fields that are present:\n\n{{input}}\n\nReturn valid JSON array.', outputFormat: 'json' } },
      { id: 'enrich', type: 'tool' as StepType, name: 'Research Each Record', config: { tool: 'web_search', args: { query: 'company info {{parse.output}}' }, loop: true } },
      { id: 'merge', type: 'llm' as StepType, name: 'Merge Results', config: { prompt: 'Merge the original records with the enriched data:\n\nOriginal: {{parse.output}}\nEnriched: {{enrich.output}}\n\nReturn a clean JSON array with all fields combined.', outputFormat: 'json' } },
    ],
    variables: [
      { key: 'input', label: 'Data (CSV, JSON, or text)', type: 'string' as const, required: true },
    ],
  },
  {
    id: 'onboarding-sequence',
    name: 'Customer Onboarding',
    description: 'Guide new customers through a personalized onboarding sequence',
    category: 'success',
    icon: 'rocket',
    steps: [
      { id: 'profile', type: 'llm' as StepType, name: 'Analyze Customer', config: { prompt: 'Analyze this new customer and create an onboarding profile:\n\nCustomer: {{customer_info}}\nPlan: {{plan}}\n\nReturn JSON: { "industry": string, "goals": string[], "recommended_features": string[], "onboarding_priority": "standard"|"high-touch" }', outputFormat: 'json' } },
      { id: 'welcome', type: 'llm' as StepType, name: 'Draft Welcome Message', config: { prompt: 'Write a personalized welcome message for this customer:\n\nProfile: {{profile.output}}\n\nBe warm, specific to their industry, and highlight the features most relevant to their goals.' } },
      { id: 'checklist', type: 'llm' as StepType, name: 'Generate Checklist', config: { prompt: 'Create a step-by-step onboarding checklist for this customer:\n\nProfile: {{profile.output}}\n\nReturn JSON array of { "step": string, "description": string, "priority": "required"|"recommended"|"optional" }', outputFormat: 'json' } },
      { id: 'send_welcome', type: 'tool' as StepType, name: 'Send Welcome', config: { tool: 'send_message', args: { message: '{{welcome.output}}' } } },
    ],
    variables: [
      { key: 'customer_info', label: 'Customer Info', type: 'string' as const, required: true },
      { key: 'plan', label: 'Plan', type: 'select' as const, options: ['Starter', 'Professional', 'Enterprise'], default: 'Professional' },
    ],
  },
];

// ── Engine ──────────────────────────────────────────────────────

function db() { return getDatabase(); }
function workflows() { return db().collection('workflows'); }
function runs() { return db().collection('workflow_runs'); }

/** Generate Lobster YAML from visual steps */
export function stepsToYaml(name: string, steps: WorkflowStep[], variables?: WorkflowVariable[]): string {
  const lines: string[] = [`name: ${name}`];
  if (variables?.length) {
    lines.push('args:');
    for (const v of variables) {
      lines.push(`  ${v.key}:`);
      if (v.default !== undefined) lines.push(`    default: "${v.default}"`);
    }
  }
  lines.push('steps:');
  for (const step of steps) {
    lines.push(`  - id: ${step.id}`);
    if (step.type === 'llm') {
      lines.push(`    command: llm-task --prompt "${(step.config.prompt || '').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
    } else if (step.type === 'tool') {
      lines.push(`    command: ${step.config.tool || 'echo'} ${Object.entries(step.config.args || {}).map(([k, v]) => `--${k} "${v}"`).join(' ')}`);
    } else if (step.type === 'approval') {
      lines.push(`    command: echo "Waiting for approval"`);
      lines.push(`    approval: required`);
    } else if (step.type === 'condition') {
      lines.push(`    command: echo "Evaluating condition"`);
      if (step.condition) lines.push(`    condition: ${step.condition}`);
    } else if (step.type === 'http') {
      lines.push(`    command: curl -s ${step.config.method || 'GET'} "${step.config.url || ''}"`);
    } else if (step.type === 'wait') {
      lines.push(`    command: sleep ${step.config.seconds || 5}`);
    } else if (step.type === 'transform') {
      lines.push(`    command: echo "${(step.config.template || '').replace(/"/g, '\\"')}"`);
    }
    if (step.onFailure === 'skip') lines.push(`    condition: "true"`);
  }
  return lines.join('\n');
}

/** Create a new workflow run and execute it */
export async function createRun(workflowId: string, agentId: string, organizationId: string, opts?: { variables?: Record<string, any>; triggeredBy?: TriggerType; userId?: string }): Promise<any> {
  const workflow = await workflows().findOne({ _id: new ObjectId(workflowId), agentId });
  if (!workflow) throw new Error('Workflow not found');

  const run = {
    workflowId,
    workflowName: workflow.name,
    agentId,
    organizationId,
    status: 'pending' as RunStatus,
    triggeredBy: opts?.triggeredBy || 'manual',
    triggeredByUserId: opts?.userId,
    variables: opts?.variables || {},
    steps: (workflow.steps || []).map((s: any) => ({
      stepId: s.id,
      stepName: s.name,
      stepType: s.type,
      status: 'pending' as StepStatus,
    })),
    output: null,
    error: null,
    startedAt: new Date(),
    completedAt: null as Date | null,
    durationMs: null as number | null,
    createdAt: new Date(),
  };

  const result = await runs().insertOne(run);
  const runId = result.insertedId.toString();

  // Update workflow stats
  await workflows().updateOne(
    { _id: new ObjectId(workflowId) },
    { $set: { lastRun: new Date() }, $inc: { totalRuns: 1 } }
  );

  // Execute async (don't await — return immediately)
  executeRun(runId, workflow, agentId, opts?.variables).catch(err => {
    console.error(`[workflow-engine] Run ${runId} failed:`, err.message);
  });

  return { ...run, _id: runId };
}

/** Execute a workflow run step by step */
async function executeRun(runId: string, workflow: any, agentId: string, variables?: Record<string, any>) {
  await runs().updateOne({ _id: new ObjectId(runId) }, { $set: { status: 'running' } });

  const steps: WorkflowStep[] = workflow.steps || [];
  const stepOutputs: Record<string, any> = { ...variables };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();

    // Update step status to running
    await runs().updateOne(
      { _id: new ObjectId(runId), 'steps.stepId': step.id },
      { $set: { 'steps.$.status': 'running', 'steps.$.startedAt': new Date() } }
    );

    // Check condition
    if (step.condition) {
      try {
        const condResult = evaluateCondition(step.condition, stepOutputs);
        if (!condResult) {
          await runs().updateOne(
            { _id: new ObjectId(runId), 'steps.stepId': step.id },
            { $set: { 'steps.$.status': 'skipped', 'steps.$.completedAt': new Date(), 'steps.$.durationMs': Date.now() - stepStart } }
          );
          continue;
        }
      } catch (err) {
        console.error(`[workflow] Condition evaluation failed for step ${step.id} in run ${runId}:`, (err as Error).message);
      }
    }

    // Handle approval steps
    if (step.type === 'approval') {
      await runs().updateOne(
        { _id: new ObjectId(runId), 'steps.stepId': step.id },
        { $set: { 'steps.$.status': 'waiting_approval' } }
      );
      await runs().updateOne({ _id: new ObjectId(runId) }, { $set: { status: 'waiting_approval', waitingStepId: step.id } });
      return; // Pause execution — will resume on approval
    }

    // Execute step via Lobster
    try {
      const output = await executeStep(step, agentId, stepOutputs);
      stepOutputs[step.id] = { output };

      await runs().updateOne(
        { _id: new ObjectId(runId), 'steps.stepId': step.id },
        { $set: { 'steps.$.status': 'completed', 'steps.$.output': output, 'steps.$.completedAt': new Date(), 'steps.$.durationMs': Date.now() - stepStart } }
      );
    } catch (err: any) {
      const shouldRetry = step.onFailure === 'retry' && (step.retries || 0) > 0;
      if (shouldRetry) {
        // Simple retry (no exponential backoff for now)
        step.retries = (step.retries || 1) - 1;
        i--; // Retry same step
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      await runs().updateOne(
        { _id: new ObjectId(runId), 'steps.stepId': step.id },
        { $set: { 'steps.$.status': 'failed', 'steps.$.error': err.message, 'steps.$.completedAt': new Date(), 'steps.$.durationMs': Date.now() - stepStart } }
      );

      if (step.onFailure === 'skip') continue;

      // Stop workflow
      await runs().updateOne({ _id: new ObjectId(runId) }, {
        $set: { status: 'failed', error: `Step "${step.name}" failed: ${err.message}`, completedAt: new Date(), durationMs: Date.now() - new Date((await runs().findOne({ _id: new ObjectId(runId) }))?.startedAt).getTime() }
      });
      return;
    }
  }

  // All steps completed
  const run = await runs().findOne({ _id: new ObjectId(runId) });
  const lastStep = steps[steps.length - 1];
  await runs().updateOne({ _id: new ObjectId(runId) }, {
    $set: {
      status: 'completed',
      output: stepOutputs[lastStep?.id]?.output || null,
      completedAt: new Date(),
      durationMs: Date.now() - new Date(run?.startedAt).getTime(),
    }
  });

  // Update workflow success count
  await workflows().updateOne({ _id: new ObjectId(workflow._id) }, { $inc: { successRuns: 1 } });
}

/** Execute a single step */
async function executeStep(step: WorkflowStep, agentId: string, context: Record<string, any>): Promise<any> {
  const interpolate = (s: string) => s.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const parts = path.split('.');
    let val: any = context;
    for (const p of parts) val = val?.[p];
    return val !== undefined ? String(val) : `{{${path}}}`;
  });

  if (step.type === 'wait') {
    await new Promise(r => setTimeout(r, (step.config.seconds || 5) * 1000));
    return { waited: step.config.seconds || 5 };
  }

  if (step.type === 'transform') {
    return interpolate(step.config.template || '');
  }

  // Send to Lobster via Gateway
  const client = gatewayManager.getClient(agentId);
  if (!client?.isConnected()) throw new Error('Agent gateway not connected');

  let message: string;
  if (step.type === 'llm') {
    message = interpolate(step.config.prompt || '');
  } else if (step.type === 'tool') {
    const args = Object.entries(step.config.args || {}).map(([k, v]) => `${k}: ${interpolate(String(v))}`).join(', ');
    message = `Use the ${step.config.tool} tool with: ${args}`;
  } else if (step.type === 'http') {
    message = `Make an HTTP ${step.config.method || 'GET'} request to: ${interpolate(step.config.url || '')}`;
  } else if (step.type === 'condition') {
    const expr = interpolate(step.config.expression || '');
    return { evaluated: expr, branches: step.config.branches };
  } else {
    message = `Execute step: ${step.name}`;
  }

  // Send as agent message and capture response
  const result = await client.sendMessage('main', message);
  return result || { sent: true };
}

/** Simple condition evaluator */
function evaluateCondition(expr: string, context: Record<string, any>): boolean {
  try {
    const fn = new Function(...Object.keys(context), `return Boolean(${expr})`);
    return fn(...Object.values(context));
  } catch { return true; }
}

/** Resume a run after approval */
export async function approveRun(runId: string, approved: boolean, userId?: string): Promise<void> {
  const run = await runs().findOne({ _id: new ObjectId(runId) });
  if (!run || run.status !== 'waiting_approval') throw new Error('Run is not waiting for approval');

  const stepId = run.waitingStepId;
  await runs().updateOne(
    { _id: new ObjectId(runId), 'steps.stepId': stepId },
    { $set: { 'steps.$.status': approved ? 'completed' : 'failed', 'steps.$.output': { approved, approvedBy: userId }, 'steps.$.completedAt': new Date() } }
  );

  if (!approved) {
    await runs().updateOne({ _id: new ObjectId(runId) }, { $set: { status: 'cancelled', completedAt: new Date(), error: 'Approval rejected' } });
    return;
  }

  // Resume execution from next step
  const workflow = await workflows().findOne({ _id: new ObjectId(run.workflowId) });
  if (!workflow) return;

  await runs().updateOne({ _id: new ObjectId(runId) }, { $set: { status: 'running' }, $unset: { waitingStepId: '' } });

  // Find the step index after the approval step and continue
  const steps: WorkflowStep[] = workflow.steps || [];
  const approvalIdx = steps.findIndex(s => s.id === stepId);
  if (approvalIdx < 0 || approvalIdx >= steps.length - 1) {
    await runs().updateOne({ _id: new ObjectId(runId) }, { $set: { status: 'completed', completedAt: new Date() } });
    return;
  }

  // Build context from completed steps
  const stepOutputs: Record<string, any> = { ...run.variables };
  for (const sr of run.steps) {
    if (sr.output) stepOutputs[sr.stepId] = { output: sr.output };
  }

  // Continue from next step
  const remainingSteps = steps.slice(approvalIdx + 1);
  const partialWorkflow = { ...workflow, steps: remainingSteps };
  executeRun(runId, partialWorkflow, run.agentId, stepOutputs).catch(err => {
    console.error(`[workflow-engine] Resume run ${runId} failed:`, err.message);
  });
}

/** Cancel a running/pending run */
export async function cancelRun(runId: string): Promise<void> {
  await runs().updateOne(
    { _id: new ObjectId(runId), status: { $in: ['pending', 'running', 'waiting_approval'] } },
    { $set: { status: 'cancelled', completedAt: new Date() } }
  );
}

/** Get run history for a workflow */
export async function getRunHistory(workflowId: string, opts?: { limit?: number; offset?: number }): Promise<any[]> {
  return runs()
    .find({ workflowId })
    .sort({ createdAt: -1 })
    .skip(opts?.offset || 0)
    .limit(opts?.limit || 20)
    .toArray();
}

/** Get a single run with full details */
export async function getRun(runId: string): Promise<any> {
  return runs().findOne({ _id: new ObjectId(runId) });
}

/** Get workflow stats */
export async function getWorkflowStats(agentId: string, organizationId: string): Promise<any> {
  const wfs = await workflows().find({ agentId, organizationId }).toArray();
  const totalRuns = wfs.reduce((sum, w) => sum + (w.totalRuns || 0), 0);
  const successRuns = wfs.reduce((sum, w) => sum + (w.successRuns || 0), 0);

  const recentRuns = await runs()
    .find({ agentId })
    .sort({ createdAt: -1 })
    .limit(10)
    .project({ _id: 1, workflowName: 1, status: 1, durationMs: 1, createdAt: 1, triggeredBy: 1 })
    .toArray();

  const avgDuration = recentRuns.filter(r => r.durationMs).reduce((sum, r) => sum + r.durationMs, 0) / (recentRuns.filter(r => r.durationMs).length || 1);

  return {
    totalWorkflows: wfs.length,
    activeWorkflows: wfs.filter(w => w.status === 'active').length,
    totalRuns,
    successRate: totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0,
    avgDurationMs: Math.round(avgDuration),
    recentRuns,
  };
}
