//? Turn-result parsing + carry-over template filling (04b §14, 02 §4). An in-container
//? agent ends its turn with a named fenced block in `last_assistant_message`; the
//? Conductor parses it (NO envelope schema change) to decide done / needs-input / continue,
//? and composes the NEXT stage's incoming handover from the stored envelope. Pure +
//? unit-testable — no container/credential needed.

import { tryCatch } from '@luckystack/core';

import { encodeQuestion, type RawQuestion } from '../../src/workspaces/_functions/structuredQuestion';
import { renderUntrustedContext } from '../ai/untrustedContext';

//? The carry-over envelope an agent emits at stage-done (B-O2 contract, 02 §4).
export interface CarryOverEnvelope {
  summary: string;
  changedFiles: string[];
  openQuestions: string[];
  //? W2 — NON-blocking questions the agent PROCEEDED past with an assumption (a done-envelope openQuestions entry
  //? shaped `{question, assumption}`). Surfaced on the ticket without parking it; a divergent answer → revision.
  advisories?: { q: string; assumption: string }[];
  commitHash?: string;
  //? Auto-escalation (StageModelCfg.autoEscalate): the agent's own 1–10 complexity score for the
  //? REMAINING work — the NEXT stage resolves its model tier from it (modelSelect.resolveModelChoice).
  complexityScore?: number;
}

//? What a turn's final message signalled. The stageRunner weighs this against the stage's
//? `doneWhen` (a report-only stage is "done" on a carry-over with nothing committed).
export type TurnResult =
  | { kind: 'done'; envelope: CarryOverEnvelope }
  | { kind: 'needs-input'; questions: string[] }
  | { kind: 'continue' };

//? Extract the body of the first ```<tag> … ``` fenced block, if present.
function fencedBlock(text: string, tag: string): string | null {
  const re = new RegExp('```' + tag + '\\s*([\\s\\S]*?)```', 'i');
  const m = re.exec(text);
  return m?.[1]?.trim() ?? null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

//? W2 — an `openQuestions` entry is either a plain string (a note passed to the next stage, unchanged) OR an
//? object `{question, assumption}` = a NON-blocking question the agent proceeded past. Split them: the strings
//? (incl. a rendered "Q (assumed: A)" for each advisory) keep feeding the next stage's incoming handover, the advisories drive W2.
function extractOpenQuestions(v: unknown): { openQuestions: string[]; advisories: { q: string; assumption: string }[] } {
  if (!Array.isArray(v)) return { openQuestions: [], advisories: [] };
  const openQuestions: string[] = [];
  const advisories: { q: string; assumption: string }[] = [];
  for (const e of v) {
    if (typeof e === 'string') { if (e.trim().length > 0) openQuestions.push(e); continue; }
    if (e !== null && typeof e === 'object') {
      const rec = e as Record<string, unknown>;
      const q = typeof rec.question === 'string' ? rec.question : (typeof rec.q === 'string' ? rec.q : '');
      const assumption = typeof rec.assumption === 'string' ? rec.assumption : '';
      if (q.trim().length > 0) {
        advisories.push({ q, assumption });
        openQuestions.push(assumption.length > 0 ? `${q} (assumed: ${assumption})` : q);
      }
    }
  }
  return { openQuestions, advisories };
}

//? Extract the raw question entries from a parsed `ws-needs-input` body — either a bare array or an
//? object with a `questions` array. Each entry is a plain string (free question) OR an object
//? ({prompt, kind, options}) that `encodeQuestion` turns into the structured needsInput envelope (P-B).
function rawQuestions(parsed: unknown): RawQuestion[] {
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>).questions : null);
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is RawQuestion => typeof x === 'string' || (x !== null && typeof x === 'object'));
}

//? Parse the agent's final message into a turn signal. `ws-carryover` → done (+ envelope);
//? `ws-needs-input` (or a bare request) → needs-input; otherwise the turn just ended → continue.
export async function parseTurnResult(message: string): Promise<TurnResult> {
  const carry = fencedBlock(message, 'ws-carryover');
  if (carry !== null) {
    const [, parsed] = await tryCatch(() => Promise.resolve(JSON.parse(carry) as unknown));
    const o = (parsed !== null && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
    const commitHash = typeof o.commitHash === 'string' ? o.commitHash : undefined;
    const oq = extractOpenQuestions(o.openQuestions);
    //? complexityScore: clamp to the 1–10 contract; anything non-numeric is simply absent.
    const rawScore = typeof o.complexityScore === 'number' && Number.isFinite(o.complexityScore)
      ? Math.min(10, Math.max(1, Math.round(o.complexityScore))) : undefined;
    return {
      kind: 'done',
      envelope: {
        summary: typeof o.summary === 'string' ? o.summary : message.trim().slice(0, 2000),
        changedFiles: strArr(o.changedFiles),
        openQuestions: oq.openQuestions,
        ...(oq.advisories.length > 0 ? { advisories: oq.advisories } : {}),
        ...(commitHash ? { commitHash } : {}),
        ...(typeof rawScore === 'number' ? { complexityScore: rawScore } : {}),
      },
    };
  }
  const needs = fencedBlock(message, 'ws-needs-input');
  if (needs !== null) {
    const [, parsed] = await tryCatch(() => Promise.resolve(JSON.parse(needs) as unknown));
    //? Each entry → its needsInput wire form: a free question stays plain (back-compat), an approve/choice
    //? question becomes the `@@wsq:` envelope the P-B card decodes. Falls back to the raw block as one free
    //? question when nothing parsed.
    const questions = rawQuestions(parsed).map((q) => encodeQuestion(q)).filter((s) => s.length > 0);
    return { kind: 'needs-input', questions: questions.length > 0 ? questions : [needs] };
  }
  return { kind: 'continue' };
}

const NEWLINE = '\n';

//? The INCOMING handover, composed automatically from the previous stage's envelope.
//?
//? This replaced a per-stage template with `{{summary}}`-style slots (owner decision 2026-08-20). The
//? slots were the wrong end of the problem: the user had to pre-write a sentence with holes in it for
//? output that did not exist yet, while the AI that had just done the work — and knows what matters —
//? had no say at all. Now the emitting stage shapes its own handover (`handoverPrompt`) and the
//? receiving stage simply gets it. There is nothing here to configure.
//?
//? CarryOver is previous-AI output, so every non-empty field keeps its OWN untrusted-data block: this
//? is the prompt-injection boundary between two stages, and it did not move.
export function renderIncomingHandover(envelope: CarryOverEnvelope | null): string {
  if (!envelope) return '';
  const parts: string[] = [];
  const field = (label: string, key: string, content: string): void => {
    if (content.trim().length === 0) return;
    parts.push(`${label}:
${renderUntrustedContext({ provenance: `previous AI CarryOver field: ${key}`, content, maxChars: 6000 })}`);
  };
  field('What the previous stage did', 'summary', envelope.summary);
  field('Files it touched', 'changedFiles', envelope.changedFiles.join(NEWLINE));
  field('Questions it left open', 'openQuestions', envelope.openQuestions.join(NEWLINE));
  if ((envelope.commitHash ?? '').trim().length > 0) parts.push(`The ticket's context is pinned to commit ${(envelope.commitHash ?? '').trim()}.`);
  if (parts.length === 0) return '';
  return `## Handover from the previous stage

${parts.join(NEWLINE + NEWLINE)}`;
}
