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
    return {
      kind: 'done',
      envelope: {
        summary: typeof o.summary === 'string' ? o.summary : message.trim().slice(0, 2000),
        changedFiles: strArr(o.changedFiles),
        openQuestions: strArr(o.openQuestions),
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
