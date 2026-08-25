//? Token self-handoff (#4, doc 06). A long interactive `claude` turn fills its context; instead of
//? letting the CLI auto-compact opaquely, the Conductor drives a CONTROLLED handoff → reset → reload
//? cycle when a session crosses its token budget: it asks the AI to write a thorough handoff
//? (`emit-handoff`), stores it as a `Handoff` record, sends `/clear` (or `/compact`), and the NEXT
//? turn reloads that handoff as its opening context — the same claudeSessionId continues, lean.
//?
//? This is carry-over generalized to WITHIN a session (02 §4). Budgets: a per-stage
//? `contextBudgetTokens` (falls back to the workspace/worker default). Token counts are the
//? orchestrator-side running estimate (`AgentSession.tokenEstimate`, #16) — the interactive PTY
//? exposes no exact count. `PreCompact` is the hard backstop (wired at the hook layer).

import { tryCatchSync } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { assertWorkspaceWriterContext } from './writerContext';

//? A JSON value → string[] (drops non-strings). Shared by the parse + reload readers.
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

//? The default worker-turn budget (~80% of a large context window, chars/4 estimated). Resolution
//? order (wired 2026-08-25): per-stage `contextBudgetTokens` → `Workspace.assistantTokenBudget` →
//? this env default. (The old never-imported DEFAULT_ASSISTANT_BUDGET / WS_ASSISTANT_TOKEN_BUDGET
//? was removed the same day.)
export const DEFAULT_WORKER_BUDGET = Number(process.env.WS_TURN_TOKEN_BUDGET ?? '120000');

//? The machine-readable tail of every handoff prompt. Kept SEPARATE from the prose so a workspace's
//? custom `handoffInstruction` can replace the prose while the parseable ws-handoff block contract
//? always survives (a custom instruction without it would silently produce zero handoffs).
export const HANDOFF_BLOCK_SPEC =
  'End your message with a fenced code block exactly like:\n```ws-handoff\n{ "summary": "…", "decisions": ["…"], "state": "…", "next": ["…"], "gotchas": ["…"], "carried": "…" }\n```';

//? The editable default handoff instruction (doc 06 §3). Sent as the prompt that makes the AI write
//? its handoff right before the reset. `Workspace.handoffInstruction` overrides the prose half.
export const DEFAULT_HANDOFF_INSTRUCTION =
  `You are about to be RESET to free up context. Write a thorough handoff so a fresh you can continue seamlessly: the goal; the key decisions and WHY; the current state and what is done; what is left to do next; gotchas/dead-ends to avoid; open questions. If you were given carry-over from a previous stage, fold the still-relevant parts forward so they survive the reset. Be detailed — this is the ONLY thing that survives. ${HANDOFF_BLOCK_SPEC}`;

//? Resolve the handoff prompt for a workspace: its own instruction (with the block spec appended)
//? when set, the built-in default otherwise. Pure.
export function handoffInstructionFor(workspaceOverride: string | null | undefined): string {
  const prose = (workspaceOverride ?? '').trim();
  return prose.length > 0 ? `${prose}\n\n${HANDOFF_BLOCK_SPEC}` : DEFAULT_HANDOFF_INSTRUCTION;
}

//? The structured handoff body the AI emits (doc 06 §6). All fields optional-but-present.
export interface HandoffBody {
  summary: string; decisions: string[]; state: string; next: string[]; gotchas: string[]; carried?: string;
}

//? Resolve the budget for a worker turn: the stage's `contextBudgetTokens` if set (> 0), else the
//? workspace's `assistantTokenBudget` if set (> 0), else the env worker default. Pure.
export function budgetForStage(stageBudget: number | null | undefined, workspaceBudget?: number | null, workerDefault = DEFAULT_WORKER_BUDGET): number {
  if (stageBudget && stageBudget > 0) return stageBudget;
  if (workspaceBudget && workspaceBudget > 0) return workspaceBudget;
  return workerDefault;
}

//? Should the session hand off now? (estimate crossed the budget.) Pure.
export function shouldHandoff(tokenEstimate: number, budget: number): boolean {
  return budget > 0 && tokenEstimate >= budget;
}

//? Parse the AI's ` ```ws-handoff … ``` ` block out of a turn message → a normalized HandoffBody, or
//? null if absent/unparseable. Mirrors the ws-carryover parse (a fenced JSON block). Pure.
export function parseHandoff(message: string): HandoffBody | null {
  const m = /```ws-handoff\s*\n([\s\S]*?)\n```/.exec(message);
  if (!m?.[1]) return null;
  const [, raw] = tryCatchSync(() => JSON.parse(m[1] ?? '') as unknown);
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary : '';
  if (summary.trim().length === 0) return null;
  return {
    summary, decisions: strArr(o.decisions), state: typeof o.state === 'string' ? o.state : '',
    next: strArr(o.next), gotchas: strArr(o.gotchas), ...(typeof o.carried === 'string' ? { carried: o.carried } : {}),
  };
}

//? Store a Handoff record. The stage writer resets the exact runToken-owned session in the same
//? writer action after validating the complete run CAS. Returns the created record's id.
export async function recordHandoff(prisma: PrismaClient, input: { id: string; workspaceId: string; sessionKey: string; ticketId?: string | null; stageId?: string | null; body: HandoffBody; reason: string }): Promise<string> {
  assertWorkspaceWriterContext(input.workspaceId);
  const record = await prisma.handoff.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      workspaceId: input.workspaceId, sessionKey: input.sessionKey, ticketId: input.ticketId ?? null, stageId: input.stageId ?? null,
      body: { summary: input.body.summary, decisions: input.body.decisions, state: input.body.state, next: input.body.next, gotchas: input.body.gotchas, ...(input.body.carried ? { carried: input.body.carried } : {}) },
      reason: input.reason,
    },
    update: {},
  });
  return record.id;
}

//? The latest handoff for a session (the reload source for the next turn), or null.
export async function latestHandoff(prisma: PrismaClient, workspaceId: string, sessionKey: string): Promise<HandoffBody | null> {
  const rec = await prisma.handoff.findFirst({ where: { workspaceId, sessionKey }, orderBy: { createdAt: 'desc' } });
  if (rec?.body === null || rec?.body === undefined || typeof rec.body !== 'object') return null;
  const o = rec.body as Record<string, unknown>;
  return {
    summary: typeof o.summary === 'string' ? o.summary : '', decisions: strArr(o.decisions), state: typeof o.state === 'string' ? o.state : '',
    next: strArr(o.next), gotchas: strArr(o.gotchas), ...(typeof o.carried === 'string' ? { carried: o.carried } : {}),
  };
}

//? Render a handoff back into a plain-text block to inject as the fresh turn's opening context.
export function renderHandoffReload(h: HandoffBody): string {
  const lines = [
    'You were RESET to free up context. Here is your own handoff — continue seamlessly from it:',
    `GOAL / SUMMARY: ${h.summary}`,
    h.state ? `STATE (what is done): ${h.state}` : '',
    h.decisions.length > 0 ? `KEY DECISIONS:\n- ${h.decisions.join('\n- ')}` : '',
    h.next.length > 0 ? `NEXT (what is left):\n- ${h.next.join('\n- ')}` : '',
    h.gotchas.length > 0 ? `GOTCHAS to avoid:\n- ${h.gotchas.join('\n- ')}` : '',
    h.carried ? `CARRIED FORWARD: ${h.carried}` : '',
  ];
  return lines.filter((l) => l.trim().length > 0).join('\n\n');
}
