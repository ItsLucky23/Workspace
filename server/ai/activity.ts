//? Central AI-activity feed. EVERY AI completion (theme/design/interviewer/marketing/chat/…) is
//? recorded here from `runAiCompletion`, so the whole workspace can see WHAT the AIs are doing —
//? the prompt (our side), the reasoning/output, the provider and the status — in ONE place: the
//? "Activity" tab of the Workspace-AI panel (no duplicate AI windows). Container-backed agents show
//? their live terminal elsewhere; these one-shot completions show their prompt + result here.
//?
//? Deliberately in-memory + capped (a rolling window of recent runs): it is a live activity view,
//? not an audit log (the durable per-turn record is SpendRecord). Global buffer, tagged by
//? workspaceId; the snapshot filters to the caller's workspace.

export interface AiRun {
  id: string;
  workspaceId: string;
  feature: string;
  label: string;
  prompt: string;    //? our prompt (truncated) — "the general prompt from our side"
  output: string;    //? the model's reasoning/output (truncated)
  providerId: string;
  //? P4-7 — the model the backend RESOLVED for this run (when it reports one), so the routing picker can say
  //? "last ran on <backend> · <model>" rather than only the backend.
  model?: string;
  status: 'ok' | 'error';
  error?: string;
  createdAt: string; //? ISO
  ms: number;        //? how long the turn took
}

const RING: AiRun[] = [];
const MAX = 80;             //? rolling window across all workspaces
const PROMPT_CAP = 800;
const OUTPUT_CAP = 4000;
let seq = 0;

function clip(s: string, cap: number): string { return s.length > cap ? `${s.slice(0, cap)}…` : s; }

//? Record one AI run. Best-effort + never throws (a logging failure must not break a completion).
export function recordAiRun(input: { workspaceId?: string; feature: string; label?: string; prompt: string; output: string; providerId: string; model?: string; status: 'ok' | 'error'; error?: string; startedAt: number }): void {
  const workspaceId = input.workspaceId;
  if (!workspaceId) return; //? only feed runs tagged to a workspace (untagged = internal/system)
  seq += 1;
  RING.push({
    id: `air-${String(seq)}`,
    workspaceId,
    feature: input.feature,
    label: input.label ?? input.feature,
    prompt: clip(input.prompt, PROMPT_CAP),
    output: clip(input.output, OUTPUT_CAP),
    providerId: input.providerId,
    ...(input.model ? { model: input.model } : {}),
    status: input.status,
    ...(input.error ? { error: input.error } : {}),
    createdAt: new Date(input.startedAt).toISOString(),
    ms: Math.max(0, Date.now() - input.startedAt),
  });
  if (RING.length > MAX) RING.splice(0, RING.length - MAX);
}

//? The workspace's recent AI runs, newest first (capped).
export function listAiRuns(workspaceId: string, limit = 30): AiRun[] {
  return RING.filter((r) => r.workspaceId === workspaceId).slice(-limit).toReversed();
}
