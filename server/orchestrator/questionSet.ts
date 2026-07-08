//? W1 — multi-question sets. The agent's `ws-needs-input` block can carry MORE than one question; previously
//? only `questions[0]` survived (the rest were silently dropped). This module is the PURE core of the
//? multi-question flow: parse the stored set, apply answers (one-at-a-time stepper OR a batch), and build the
//? combined `--resume` prompt fed to the parked agent once every question is answered. No DB / no I/O →
//? unit-testable. The orchestrator (stageRunner persists the set; the Conductor's answer-input applies it).

import { questionPrompt } from '../../src/workspaces/_functions/structuredQuestion';

//? One open question: `q` is the stored needsInput wire form (plain for free, `@@wsq:` for approve/choice);
//? `a` is the human's answer (null while unanswered).
export interface OpenQuestion { q: string; a: string | null }

//? Parse the stored `needsInputQuestions` JSON into a set, with a legacy fallback: a ticket that only has the
//? single `needsInput` banner (pre-W1, or a one-question turn) is treated as a one-entry set.
export function parseNeedsInputQuestions(raw: unknown, bannerFallback: string | null): OpenQuestion[] {
  if (Array.isArray(raw)) {
    const out: OpenQuestion[] = [];
    for (const entry of raw) {
      if (entry !== null && typeof entry === 'object') {
        const rec = entry as Record<string, unknown>;
        const q = typeof rec.q === 'string' ? rec.q : '';
        const a = typeof rec.a === 'string' ? rec.a : null;
        if (q.trim().length > 0) out.push({ q, a });
      }
    }
    if (out.length > 0) return out;
  }
  const banner = (bannerFallback ?? '').trim();
  return banner.length > 0 ? [{ q: banner, a: null }] : [];
}

export interface ApplyResult { set: OpenQuestion[]; newlyAnswered: OpenQuestion[]; appliedCount: number }

//? Apply answers to the first unanswered question(s), returning a NEW set (never mutates the input). A `batch`
//? fills the still-open questions in order; a `single` answers only the first unanswered one (the stepper).
//? Blank answers are ignored (they don't count as answered).
export function applyAnswers(set: OpenQuestion[], input: { single?: string | null; batch?: string[] | null }): ApplyResult {
  const next = set.map((x) => ({ ...x }));
  const newlyAnswered: OpenQuestion[] = [];
  const batch = input.batch ?? null;
  if (batch && batch.length > 0) {
    let bi = 0;
    for (const item of next) {
      if (item.a !== null) continue;
      if (bi >= batch.length) break;
      const ans = (batch[bi] ?? '').trim();
      bi += 1;
      if (ans.length > 0) { item.a = ans; newlyAnswered.push({ ...item }); }
    }
  } else {
    const ans = (input.single ?? '').trim();
    if (ans.length > 0) {
      const item = next.find((x) => x.a === null);
      if (item) { item.a = ans; newlyAnswered.push({ ...item }); }
    }
  }
  return { set: next, newlyAnswered, appliedCount: newlyAnswered.length };
}

//? The first still-unanswered question's wire form (the new banner), or null when every question is answered.
export function firstUnanswered(set: OpenQuestion[]): string | null {
  return set.find((x) => x.a === null)?.q ?? null;
}

//? Build the resume prompt fed to `claude --resume` once ALL questions are answered. A single question resumes
//? with just its answer (byte-identical to the pre-W1 single-question flow); multiple questions resume with a
//? numbered, human-readable Q→A list (envelopes decoded via questionPrompt).
export function buildCombinedAnswerPrompt(set: OpenQuestion[]): string {
  const answered = set.filter((x) => x.a !== null);
  if (answered.length <= 1) return answered[0]?.a ?? '';
  const lines = answered.map((x, i) => `${String(i + 1)}. ${questionPrompt(x.q)}\n   → ${x.a ?? ''}`);
  return `Answers to your questions:\n${lines.join('\n')}`;
}
