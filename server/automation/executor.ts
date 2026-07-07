//? ActionExecutor (#2) — runs a WorkspaceTrigger's action, with an APPROVAL GATE. A trigger whose
//? `requiresApproval` is set (or whose agent-role `mutates`) does NOT execute directly: it opens a
//? `WorkspaceSuggestion` (type 'automation') carrying the action in `patch`, and a human accepting
//? it (accept-suggestion → executeGatedAction) runs it. This preserves the single-writer invariant
//? (B-23): automation PROPOSES, the human consents, the Conductor executes.
//?
//? Actions: notify (in-app bell) · emit-signal (WorkspaceSignal) · start-stage (move the ticket,
//? the #1 watchdog reprovisions it) · invoke-agent-role (dispatch a registered non-coding role →
//? artifact). Self-contained (no Conductor import → no cycle; the Conductor calls fireEvent).

import { tryCatch } from '@luckystack/core';
import { Prisma, type PrismaClient } from '@prisma/client';

import { broadcastTicketDelta } from '../read/broadcast';
import { sendWebPushMany } from '../hooks/webPush';
import { getAgentRole } from './agentRoles';

//? X2 — outbound webhook poster. Injectable so tests capture the POST without a network. Default = a real
//? fetch (best-effort; the caller treats a non-2xx / throw as an error outcome, never a pipeline wedge).
export type WebhookPoster = (url: string, body: string) => Promise<{ ok: boolean; status: number }>;
let webhookPoster: WebhookPoster = async (url, body) => {
  //? External user-configured URL — not a framework `/api/*` route.
  // eslint-disable-next-line luckystack/no-raw-fetch-in-src
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { ok: r.ok, status: r.status };
};
export function __setWebhookPoster(p: WebhookPoster): void { webhookPoster = p; }

//? Bridge a genuinely-JSON value (read off a Json column, or built from params) to Prisma's Json
//? WRITE type. Prisma splits read (JsonValue) from write (InputJsonValue); this is the standard
//? narrowing for a value that is already JSON — not an `as any` escape.
const asJson = (v: unknown): Prisma.InputJsonValue => v ?? {};

//? The action a trigger runs, extracted so it round-trips through a suggestion's `patch` unchanged.
export interface TriggerAction {
  action: string;               // notify | emit-signal | start-stage | invoke-agent-role
  params: Record<string, unknown>;
  ticketKey?: string;           // the ticket the event concerned (if any)
  triggerName?: string;         // for the suggestion title / audit
}

export interface ExecOutcome { status: 'executed' | 'gated' | 'noop' | 'error'; detail?: string }

function str(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
}

//? Directly run an action (past any gate). Best-effort per action; a bad action is a noop, never a
//? throw, so one misconfigured trigger can't wedge the pipeline.
export async function executeTriggerAction(prisma: PrismaClient, workspaceId: string, a: TriggerAction): Promise<ExecOutcome> {
  switch (a.action) {
    case 'notify': {
      //? In-app notification to every workspace member (respecting per-user opt-out is the bell's job).
      const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
      const title = str(a.params, 'title') ?? a.triggerName ?? 'Automation';
      const body = str(a.params, 'body') ?? '';
      if (members.length === 0) return { status: 'noop' };
      await prisma.notification.createMany({ data: members.map((m) => ({ workspaceId, userId: m.userId, type: 'automation', title, body, ...(a.ticketKey ? { deepLink: { view: 'board', ticketId: a.ticketKey } } : {}) })) });
      //? A2 — also push it to every member's devices (best-effort; no-op without VAPID/subscriptions).
      await sendWebPushMany(prisma, members.map((m) => m.userId), { title, body, url: '/', ...(a.ticketKey ? { tag: `ticket-${a.ticketKey}` } : {}) }, 'automation');
      return { status: 'executed', detail: `notified ${String(members.length)}` };
    }
    case 'webhook': {
      //? X2 — POST a compact event envelope to a user-configured URL. Requires http(s); a non-2xx/throw is an
      //? error outcome (best-effort, never throws). SSRF hardening (blocking internal targets) is a follow-up —
      //? the URL is the workspace-owner's own configured endpoint.
      const url = str(a.params, 'url');
      if (!url || !/^https?:\/\//i.test(url)) return { status: 'noop', detail: 'no-url' };
      const payload = { event: a.triggerName ?? 'trigger', ticketKey: a.ticketKey ?? null, payload: a.params.payload ?? null, workspaceId };
      const [err, res] = await tryCatch(() => webhookPoster(url, JSON.stringify(payload)));
      if (err || !res?.ok) return { status: 'error', detail: 'webhook-failed' };
      return { status: 'executed', detail: `posted ${String(res.status)}` };
    }
    case 'emit-signal': {
      //? Append a WorkspaceSignal (monotonic seq) — the serial signal feed other triggers watch.
      const last = await prisma.workspaceSignal.findFirst({ where: { workspaceId }, orderBy: { seq: 'desc' }, select: { seq: true } });
      await prisma.workspaceSignal.create({ data: { workspaceId, seq: (last?.seq ?? 0) + 1, kind: str(a.params, 'kind') ?? 'custom', payload: asJson(a.params.payload) } });
      return { status: 'executed' };
    }
    case 'start-stage': {
      //? Move the event's ticket to the target stage; the #1 watchdog re-provisions an idle
      //? activated ticket in an AI-enabled stage, so no direct engine coupling is needed here.
      const target = str(a.params, 'targetStageId');
      if (!a.ticketKey || !target) return { status: 'noop' };
      const res = await prisma.ticket.updateMany({ where: { workspaceId, key: a.ticketKey }, data: { stageId: target, status: 'idle' } });
      if (res.count === 0) return { status: 'noop' };
      await broadcastTicketDelta(prisma, workspaceId, [a.ticketKey]);
      return { status: 'executed', detail: `moved ${a.ticketKey}→${target}` };
    }
    case 'invoke-agent-role': {
      //? Dispatch a registered non-coding role (plugin). A mutating role must have been gated already
      //? (runTrigger enforces it); here we just run + record its artifact as a notification.
      const role = getAgentRole(str(a.params, 'role') ?? '');
      if (!role) return { status: 'noop', detail: 'unknown-role' };
      const artifact = await role.run({ workspaceId, ...(a.ticketKey ? { ticketKey: a.ticketKey } : {}), params: a.params });
      if (!artifact) return { status: 'executed', detail: 'no-artifact' };
      const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
      await prisma.notification.createMany({ data: members.map((m) => ({ workspaceId, userId: m.userId, type: 'ai-suggestion', title: `${role.label}: ${artifact.title}`, body: artifact.body, ...(a.ticketKey ? { deepLink: { view: 'board', ticketId: a.ticketKey } } : {}) })) });
      //? A2 — push the AI suggestion to every member's devices too (best-effort).
      await sendWebPushMany(prisma, members.map((m) => m.userId), { title: `${role.label}: ${artifact.title}`, body: artifact.body, url: '/', ...(a.ticketKey ? { tag: `ticket-${a.ticketKey}` } : {}) }, 'aiSuggestion');
      return { status: 'executed', detail: role.key };
    }
    default: {
      return { status: 'noop', detail: 'unknown-action' };
    }
  }
}

//? Run a trigger's action THROUGH the gate. Gated (requiresApproval, or a mutating agent-role) →
//? open an 'automation' suggestion carrying the action; else execute now.
export async function runTriggerAction(prisma: PrismaClient, workspaceId: string, a: TriggerAction, requiresApproval: boolean): Promise<ExecOutcome> {
  const role = a.action === 'invoke-agent-role' ? getAgentRole(str(a.params, 'role') ?? '') : undefined;
  const mustGate = requiresApproval || (role?.mutates ?? false);
  if (mustGate) {
    await prisma.workspaceSuggestion.create({
      data: {
        workspaceId, type: 'automation',
        title: a.triggerName ? `Approve: ${a.triggerName}` : `Approve automation: ${a.action}`,
        body: `Trigger wants to run “${a.action}”${a.ticketKey ? ` on ${a.ticketKey}` : ''}.`,
        ticketIds: [], patch: asJson({ action: a.action, params: a.params, ...(a.ticketKey ? { ticketKey: a.ticketKey } : {}) }), status: 'open',
      },
    });
    return { status: 'gated' };
  }
  return executeTriggerAction(prisma, workspaceId, a);
}

//? Execute the action a human just approved (accept-suggestion on an 'automation' suggestion). The
//? action was stored in the suggestion's `patch`. Returns noop if the patch isn't a valid action.
export async function executeGatedAction(prisma: PrismaClient, workspaceId: string, patch: unknown): Promise<ExecOutcome> {
  if (patch === null || typeof patch !== 'object') return { status: 'noop' };
  const p = patch as Record<string, unknown>;
  const action = typeof p.action === 'string' ? p.action : '';
  if (!action) return { status: 'noop' };
  return executeTriggerAction(prisma, workspaceId, {
    action,
    params: (p.params !== null && typeof p.params === 'object' ? p.params : {}) as Record<string, unknown>,
    ...(typeof p.ticketKey === 'string' ? { ticketKey: p.ticketKey } : {}),
  });
}
