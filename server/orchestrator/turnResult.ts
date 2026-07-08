//? Turn-result parsing + carry-over template filling (04b §14, 02 §4). An in-container
//? agent ends its turn with a named fenced block in `last_assistant_message`; the
//? Conductor parses it (NO envelope schema change) to decide done / needs-input / continue,
//? and fills the NEXT stage's `promptTemplate` `{{chips}}` from the stored envelope. Pure +
//? unit-testable — no container/credential needed.

import { tryCatch } from '@luckystack/core';

import { encodeQuestion, type RawQuestion } from '../../src/workspaces/_functions/structuredQuestion';

//? The carry-over envelope an agent emits at stage-done (B-O2 contract, 02 §4).
export interface CarryOverEnvelope {
  summary: string;
  changedFiles: string[];
  openQuestions: string[];
  //? W2 — NON-blocking questions the agent PROCEEDED past with an assumption (a done-envelope openQuestions entry
  //? shaped `{question, assumption}`). Surfaced on the ticket without parking it; a divergent answer → revision.
  advisories?: { q: string; assumption: string }[];
  commitHash?: string;
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
//? (incl. a rendered "Q (assumed: A)" for each advisory) keep feeding `{{openQuestions}}`, the advisories drive W2.
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
    return {
      kind: 'done',
      envelope: {
        summary: typeof o.summary === 'string' ? o.summary : message.trim().slice(0, 2000),
        changedFiles: strArr(o.changedFiles),
        openQuestions: oq.openQuestions,
        ...(oq.advisories.length > 0 ? { advisories: oq.advisories } : {}),
        ...(commitHash ? { commitHash } : {}),
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

//? Fill a stage's `promptTemplate` `{{chips}}` from the incoming carry-over envelope
//? (CARRY_VARS: summary/changedFiles/openQuestions/commitHash). Null envelope (first stage)
//? → chips resolve to empty. Arrays render as newline lists.
export function renderPromptTemplate(template: string, envelope: CarryOverEnvelope | null): string {
  return template
    .replaceAll('{{summary}}', envelope?.summary ?? '')
    .replaceAll('{{changedFiles}}', (envelope?.changedFiles ?? []).join('\n'))
    .replaceAll('{{openQuestions}}', (envelope?.openQuestions ?? []).join('\n'))
    .replaceAll('{{commitHash}}', envelope?.commitHash ?? '');
}
