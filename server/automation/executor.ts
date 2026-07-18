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
import { withTenant } from '../tenant/tenantGuard';
import { getAgentRole } from './agentRoles';
import { docker, dockerAvailable, containerName } from '../container/runtime';
import { runAiCompletion } from '../ai/registry';
import { isObviouslyUnsafeOutboundUrl } from '../security/outboundUrl';
import { safeHttpRequest } from '../security/safeHttp';

//? X2 — outbound webhook poster. Production uses the central DNS-pinned transport; this outer seam remains
//? injectable so the action-envelope integration test can capture the POST without network access.
export type WebhookPoster = (url: string, body: string) => Promise<{ ok: boolean; status: number; blocked?: boolean }>;
let webhookPoster: WebhookPoster = async (url, body) => {
  const result = await safeHttpRequest(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
    timeoutMs: 15_000, maxRedirects: 3, maxRequestBytes: 256_000, maxResponseBytes: 64_000,
  });
  if (!result.ok) {
    const blocked = result.error.code === 'blocked-address' || result.error.code === 'blocked-hostname' || result.error.code === 'non-default-port' || result.error.code === 'credentials-not-allowed' || result.error.code === 'insecure-http-not-allowed' || result.error.code === 'https-downgrade-redirect' || result.error.code === 'cross-origin-redirect-not-allowed';
    return { ok: false, status: 0, blocked };
  }
  return { ok: result.response.status >= 200 && result.response.status < 300, status: result.response.status };
};
export function __setWebhookPoster(p: WebhookPoster): void { webhookPoster = p; }

//? Bridge a genuinely-JSON value (read off a Json column, or built from params) to Prisma's Json
//? WRITE type. Prisma splits read (JsonValue) from write (InputJsonValue); this is the standard
//? narrowing for a value that is already JSON — not an `as any` escape.
const asJson = (v: unknown): Prisma.InputJsonValue => v ?? {};

//? The action a trigger runs, extracted so it round-trips through a suggestion's `patch` unchanged.
export interface TriggerAction {
  action: string;               // notify | webhook | emit-signal | start-stage | invoke-agent-role | run-command | invoke-workspace-ai
  params: Record<string, unknown>;
  ticketKey?: string;           // the ticket the event concerned (if any)
  triggerName?: string;         // for the suggestion title / audit
  signalDepth?: number;         // #83 — the fireEvent recursion depth (for the on_signal loop guard)
}

//? #83 — a late-bound hook so `emit-signal` can raise a `stage.on_signal` EVENT without executor.ts importing
//? triggers.ts (that would be a cycle). triggers.ts registers it at module load; if unset, signals are inert.
export type SignalHook = (prisma: PrismaClient, workspaceId: string, kind: string, ticketKey: string | null, depth: number) => void;
let signalHook: SignalHook | null = null;
export function registerSignalHook(fn: SignalHook): void { signalHook = fn; }

export interface ExecOutcome { status: 'executed' | 'gated' | 'noop' | 'error'; detail?: string }

function str(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
}

//? Compatibility export for the old pure guard tests. Production I/O additionally resolves every A/AAAA
//? answer in safeHttpRequest(), so hostnames cannot bypass this preflight through DNS rebinding.
export function isBlockedWebhookTarget(rawUrl: string): boolean {
  return isObviouslyUnsafeOutboundUrl(rawUrl);
}

//? GAP_SCAN B3 — a notification without a ticket used to carry NO deepLink, so tapping it (in-app or from a
//? push) dumped the user at the app root with no idea what it was about. Every non-ticket sender now names a
//? destination view: the role's own page when it has one, else the activity feed where automation output lives.
const ROLE_VIEW: Record<string, string> = { interviewer: 'interviewer', scraper: 'knowledge', designer: 'designer' };
export function notificationTarget(input: { ticketKey?: string; roleKey?: string }): { deepLink: { view: string; ticketId?: string }; url: string } {
  if (input.ticketKey) return { deepLink: { view: 'board', ticketId: input.ticketKey }, url: `/?ticket=${input.ticketKey}` };
  const view = (input.roleKey ? ROLE_VIEW[input.roleKey] : undefined) ?? 'activity';
  return { deepLink: { view }, url: `/?view=${view}` };
}

//? Directly run an action (past any gate). Best-effort per action; a bad action is a noop, never a
//? throw, so one misconfigured trigger can't wedge the pipeline.
export async function executeTriggerAction(prisma: PrismaClient, workspaceId: string, a: TriggerAction): Promise<ExecOutcome> {
  //? GAP_SCAN E2 — trigger actions are cron-driven, so they had NO tenant scope: every query they made ran
  //? unscoped and row isolation never applied. The action body now runs inside the trigger's workspace
  //? scope (report-first — the guard records what strict enforcement would have rejected).
  return withTenant(workspaceId, 'automation.action', () => runTriggerActionBody(prisma, workspaceId, a));
}

async function runTriggerActionBody(prisma: PrismaClient, workspaceId: string, a: TriggerAction): Promise<ExecOutcome> {
  switch (a.action) {
    case 'notify': {
      //? In-app notification to every workspace member (respecting per-user opt-out is the bell's job).
      const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
      const title = str(a.params, 'title') ?? a.triggerName ?? 'Automation';
      const body = str(a.params, 'body') ?? '';
      if (members.length === 0) return { status: 'noop' };
      const notifyTarget = notificationTarget({ ...(a.ticketKey ? { ticketKey: a.ticketKey } : {}) });
      await prisma.notification.createMany({ data: members.map((m) => ({ workspaceId, userId: m.userId, type: 'automation', title, body, deepLink: notifyTarget.deepLink })) });
      //? A2 — also push it to every member's devices (best-effort; no-op without VAPID/subscriptions).
      await sendWebPushMany(prisma, members.map((m) => m.userId), { title, body, url: notifyTarget.url, ...(a.ticketKey ? { tag: `ticket-${a.ticketKey}` } : {}) }, 'automation');
      return { status: 'executed', detail: `notified ${String(members.length)}` };
    }
    case 'webhook': {
      //? X2 — POST a compact event envelope to a user-configured URL. Requires http(s); a non-2xx/throw is an
      //? error outcome (best-effort, never throws). SEC6: internal/loopback/link-local/metadata targets are
      //? refused (self-hosted multi-tenant SSRF posture).
      const url = str(a.params, 'url');
      if (!url || !/^https?:\/\//i.test(url)) return { status: 'noop', detail: 'no-url' };
      if (isBlockedWebhookTarget(url)) return { status: 'error', detail: 'webhook-target-blocked' };
      const payload = { event: a.triggerName ?? 'trigger', ticketKey: a.ticketKey ?? null, payload: a.params.payload ?? null, workspaceId };
      const [err, res] = await tryCatch(() => webhookPoster(url, JSON.stringify(payload)));
      if (err || !res?.ok) return { status: 'error', detail: res?.blocked ? 'webhook-target-blocked' : 'webhook-failed' };
      return { status: 'executed', detail: `posted ${String(res.status)}` };
    }
    case 'emit-signal': {
      //? Append a WorkspaceSignal (monotonic seq) — the serial signal feed other triggers watch.
      const last = await prisma.workspaceSignal.findFirst({ where: { workspaceId }, orderBy: { seq: 'desc' }, select: { seq: true } });
      const kind = str(a.params, 'kind') ?? 'custom';
      await prisma.workspaceSignal.create({ data: { workspaceId, seq: (last?.seq ?? 0) + 1, kind, payload: asJson(a.params.payload) } });
      //? #83 — raise the `stage.on_signal` EVENT so triggers can chain off the signal (via the injected hook →
      //? no executor→triggers import cycle). The depth rides through so fireEvent can bound signal→signal chains.
      if (signalHook) signalHook(prisma, workspaceId, kind, a.ticketKey ?? null, a.signalDepth ?? 0);
      return { status: 'executed' };
    }
    case 'start-stage': {
      //? Move the event's ticket to the target stage; the #1 watchdog re-provisions an idle
      //? activated ticket in an AI-enabled stage, so no direct engine coupling is needed here.
      const target = str(a.params, 'targetStageId');
      if (!a.ticketKey || !target) return { status: 'noop' };
      const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: a.ticketKey }, select: { id: true, projectId: true } });
      if (!ticket) return { status: 'noop' };
      const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: ticket.projectId, key: target }, select: { id: true } });
      if (!stage) return { status: 'noop' };
      const res = await prisma.ticket.updateMany({ where: { id: ticket.id, workspaceId, projectId: ticket.projectId }, data: { stageId: target, status: 'idle' } });
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
      //? B3 — a role artifact without a ticket deep-links to that ROLE's page (interviewer findings land on
      //? the interviewer, not the app root).
      const roleTarget = notificationTarget({ ...(a.ticketKey ? { ticketKey: a.ticketKey } : {}), roleKey: role.key });
      await prisma.notification.createMany({ data: members.map((m) => ({ workspaceId, userId: m.userId, type: 'ai-suggestion', title: `${role.label}: ${artifact.title}`, body: artifact.body, deepLink: roleTarget.deepLink })) });
      //? A2 — push the AI suggestion to every member's devices too (best-effort).
      await sendWebPushMany(prisma, members.map((m) => m.userId), { title: `${role.label}: ${artifact.title}`, body: artifact.body, url: roleTarget.url, ...(a.ticketKey ? { tag: `ticket-${a.ticketKey}` } : {}) }, 'aiSuggestion');
      return { status: 'executed', detail: role.key };
    }
    case 'run-command': {
      //? #90 — run a shell command INSIDE the event ticket's workspace container (never on the host —
      //? invariant #4: the Assistant/automation is scoped to a workspace, never host/system-level). ALWAYS
      //? operator-gated (runTriggerAction force-gates it), so a human approved this exact run. Bounded
      //? output is posted back as a notification. No ticket/container/docker ⇒ a clean noop, never a throw.
      const command = str(a.params, 'command');
      if (!command || !a.ticketKey) return { status: 'noop', detail: 'run-command-needs-ticket-and-command' };
      if (!(await dockerAvailable())) return { status: 'noop', detail: 'docker-unavailable' };
      const container = containerName(workspaceId, a.ticketKey);
      const res = await docker(['exec', '-w', '/work', container, 'sh', '-lc', command]);
      const combined = [res.out, res.err].filter((s) => s.length > 0).join('\n').slice(0, 2000);
      const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
      const title = `${a.triggerName ?? 'Command'} · exit ${String(res.code)}`;
      await prisma.notification.createMany({ data: members.map((m) => ({ workspaceId, userId: m.userId, type: 'automation', title, body: combined || '(no output)', deepLink: notificationTarget({ ticketKey: a.ticketKey }).deepLink })) });
      return res.code === 0 ? { status: 'executed', detail: `exit 0` } : { status: 'error', detail: `exit ${String(res.code)}` };
    }
    case 'invoke-workspace-ai': {
      //? #90 — dispatch the (non-coding) Workspace-AI with a prompt and post its answer as a notification.
      //? Runs on the pluggable provider layer (feature 'custom-generate') — a Q&A/summarise task, NOT the
      //? PTY coding agent's job (invariant #6). Empty prompt ⇒ noop.
      const prompt = str(a.params, 'prompt');
      if (!prompt) return { status: 'noop', detail: 'invoke-workspace-ai-needs-prompt' };
      const completion = await runAiCompletion('custom-generate', { prompt, workspaceId, label: `Automation · ${a.triggerName ?? 'invoke-workspace-ai'}` });
      if (!completion.ok) return { status: 'error', detail: completion.error ?? 'ai-failed' };
      const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
      const body = completion.text.slice(0, 2000);
      const aiTarget = notificationTarget({ ...(a.ticketKey ? { ticketKey: a.ticketKey } : {}) });
      await prisma.notification.createMany({ data: members.map((m) => ({ workspaceId, userId: m.userId, type: 'ai-suggestion', title: a.triggerName ?? 'Workspace-AI', body, deepLink: aiTarget.deepLink })) });
      await sendWebPushMany(prisma, members.map((m) => m.userId), { title: a.triggerName ?? 'Workspace-AI', body, url: aiTarget.url }, 'aiSuggestion');
      return { status: 'executed', detail: 'answered' };
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
  //? #90 — run-command is ALWAYS operator-gated regardless of the trigger's flag (a human must approve
  //? every arbitrary in-container command run) — invariant #4 safety.
  const mustGate = requiresApproval || (role?.mutates ?? false) || a.action === 'run-command';
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
