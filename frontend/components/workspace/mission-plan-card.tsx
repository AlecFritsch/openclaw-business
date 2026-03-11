"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { useWorkspaceChat } from "@/lib/workspace-chat-context";
import type { CreateMissionRequest, UpdateMissionRequest, MissionTrigger } from "@openclaw-business/shared";

interface MissionPlan {
  name: string;
  description?: string;
  trigger: MissionTrigger;
  prompt: string;
  capabilities?: string[];
  delivery?: { channel?: string; target?: string };
}

interface MissionUpdatePlan {
  _action: "update";
  _missionId: string;
  name?: string;
  description?: string;
  trigger?: MissionTrigger;
  prompt?: string;
  capabilities?: string[];
  delivery?: { channel?: string; target?: string };
}

export type AnyMissionPlan = MissionPlan | MissionUpdatePlan;

function isUpdatePlan(p: AnyMissionPlan): p is MissionUpdatePlan {
  return "_action" in p && p._action === "update";
}

/** Extract one or more mission plans (create or update) from text */
export function extractMissionPlans(text: string): AnyMissionPlan[] {
  const plans: AnyMissionPlan[] = [];

  const codeBlocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g)];
  const sources = codeBlocks.length > 0 ? codeBlocks.map(m => m[1]) : [text];

  for (const src of sources) {
    try {
      const parsed = JSON.parse(src.trim());
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?._action === "update" && item?._missionId) plans.push(item);
          else if (item?.name && item?.trigger?.type && item?.prompt) plans.push(item);
        }
        continue;
      }
      if (parsed?._action === "update" && parsed?._missionId) { plans.push(parsed); continue; }
      if (parsed?.name && parsed?.trigger?.type && parsed?.prompt) { plans.push(parsed); continue; }
    } catch {}

    const match = src.match(/\{[\s\S]*"name"[\s\S]*"trigger"[\s\S]*"prompt"[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj.name && obj.trigger?.type && obj.prompt) plans.push(obj);
      } catch {}
    }
  }

  return plans;
}

/** @deprecated Use extractMissionPlans instead */
export function extractMissionPlan(text: string): MissionPlan | null {
  const plans = extractMissionPlans(text);
  return plans.find((p): p is MissionPlan => !isUpdatePlan(p)) || null;
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: "📅 Scheduled",
  interval: "🔄 Recurring",
  channel_message: "💬 On message",
  webhook: "🔗 Webhook",
  mission_complete: "⛓️ After mission",
  manual: "▶️ Manual",
  event: "⚡ Event",
};

function describeTrigger(trigger: MissionTrigger): string {
  const label = TRIGGER_LABELS[trigger.type] || trigger.type;
  const cfg = trigger.config || {};
  if (trigger.type === "schedule" && cfg.expr) return `${label} — ${cfg.expr}${cfg.tz ? ` (${cfg.tz})` : ""}`;
  if (trigger.type === "interval" && cfg.everyMs) {
    const ms = cfg.everyMs as number;
    if (ms >= 3600000) return `${label} — every ${Math.round(ms / 3600000)}h`;
    return `${label} — every ${Math.round(ms / 60000)}min`;
  }
  if (trigger.type === "channel_message") return `${label}${cfg.channel ? ` on ${cfg.channel}` : ""}${cfg.filter ? ` matching "${cfg.filter}"` : ""}`;
  return label;
}

export function MissionPlanCard({ plan, messageText }: { plan: MissionPlan; messageText: string }) {
  const { getToken } = useAuth();
  const { agentId } = useWorkspaceChat();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleConfirm = async () => {
    if (!agentId) return;
    setCreating(true);
    try {
      const token = await getToken();
      if (!token) return;
      const req: CreateMissionRequest = {
        name: plan.name,
        description: plan.description,
        trigger: plan.trigger,
        prompt: plan.prompt,
        capabilities: plan.capabilities,
        delivery: plan.delivery,
      };
      await apiClient.createMission(token, agentId, req);
      setCreated(true);
      showToast(`Mission "${plan.name}" created`, "success");
      window.dispatchEvent(new CustomEvent("open-missions-panel"));
      window.dispatchEvent(new CustomEvent("close-mission-mode"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create mission", "error");
    } finally {
      setCreating(false);
    }
  };

  // Show the non-JSON part of the message as context
  const contextText = messageText
    .replace(/```(?:json)?\s*\n?[\s\S]*?\n?```/g, "")
    .replace(/\{[\s\S]*"name"[\s\S]*"trigger"[\s\S]*"prompt"[\s\S]*\}/, "")
    .trim();

  return (
    <div className="my-2 rounded-xl border border-purple-200 dark:border-purple-800/50 bg-purple-50/50 dark:bg-purple-950/20 overflow-hidden">
      {contextText && (
        <p className="px-4 pt-3 text-sm text-foreground leading-relaxed">{contextText}</p>
      )}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🎯</span>
          <span className="font-medium text-sm">{plan.name}</span>
        </div>
        {plan.description && (
          <p className="text-xs text-muted-foreground">{plan.description}</p>
        )}
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
            {describeTrigger(plan.trigger)}
          </span>
          {plan.delivery?.channel && (
            <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
              → {plan.delivery.channel}{plan.delivery.target ? ` ${plan.delivery.target}` : ""}
            </span>
          )}
          {plan.capabilities?.map((c) => (
            <span key={c} className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-muted-foreground">{c}</span>
          ))}
        </div>
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Autonomous prompt</summary>
          <p className="mt-1 p-2 rounded-lg bg-background border border-border text-xs text-muted-foreground whitespace-pre-wrap">{plan.prompt}</p>
        </details>
      </div>
      {!created ? (
        <div className="px-4 py-2.5 border-t border-purple-200/50 dark:border-purple-800/30 flex items-center gap-2">
          <button
            onClick={handleConfirm}
            disabled={creating}
            className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {creating ? "Creating..." : "✓ Create Mission"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="px-4 py-2.5 border-t border-green-200/50 dark:border-green-800/30 bg-green-50/50 dark:bg-green-950/20">
          <span className="text-xs text-green-700 dark:text-green-400 font-medium">✓ Mission created — visible in Missions panel</span>
        </div>
      )}
    </div>
  );
}

export function MissionUpdateCard({ plan }: { plan: MissionUpdatePlan }) {
  const { getToken } = useAuth();
  const { agentId } = useWorkspaceChat();
  const [updating, setUpdating] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleConfirm = async () => {
    if (!agentId) return;
    setUpdating(true);
    try {
      const token = await getToken();
      if (!token) return;
      const { _action, _missionId, ...fields } = plan;
      await apiClient.updateMission(token, agentId, _missionId, fields as UpdateMissionRequest);
      setUpdated(true);
      showToast("Mission updated", "success");
      window.dispatchEvent(new CustomEvent("close-mission-mode"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update mission", "error");
    } finally {
      setUpdating(false);
    }
  };

  const changes = Object.entries(plan).filter(([k]) => !k.startsWith("_"));

  return (
    <div className="my-2 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-base">✏️</span>
          <span className="font-medium text-sm">Update Mission</span>
          <span className="text-xs text-muted-foreground font-mono">{plan._missionId.slice(0, 8)}…</span>
        </div>
        <div className="space-y-1">
          {changes.map(([key, val]) => (
            <div key={key} className="text-xs">
              <span className="text-muted-foreground">{key}:</span>{" "}
              <span className="text-foreground">{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
            </div>
          ))}
        </div>
      </div>
      {!updated ? (
        <div className="px-4 py-2.5 border-t border-amber-200/50 dark:border-amber-800/30 flex items-center gap-2">
          <button onClick={handleConfirm} disabled={updating} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors">
            {updating ? "Updating..." : "✓ Apply Changes"}
          </button>
          <button onClick={() => setDismissed(true)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="px-4 py-2.5 border-t border-green-200/50 dark:border-green-800/30 bg-green-50/50 dark:bg-green-950/20">
          <span className="text-xs text-green-700 dark:text-green-400 font-medium">✓ Mission updated</span>
        </div>
      )}
    </div>
  );
}
