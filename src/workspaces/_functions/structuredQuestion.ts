//? P-B — structured approvals. A ticket's `needsInput` is a single string column and stays one (no schema
//? change, no new verb): a FREE question is stored as its plain prompt (back-compat with every existing
//? reader — the banner, the answer-queue, `isRealNeedsInput`), while an APPROVE or CHOICE question is stored
//? as a compact `@@wsq:` JSON envelope. `parseStructuredQuestion` decodes either shape; `encodeQuestion` is
//? the inverse the orchestrator uses when persisting the agent's `ws-needs-input`. Pure + shared by the
//? server (turnResult/stageRunner/snapshot) and the client card, so both agree on the wire shape.

export type QuestionKind = 'approve' | 'choice' | 'free';

export interface StructuredQuestion {
  kind: QuestionKind;
  prompt: string;
  options: string[]; //? only meaningful for `choice`; always present (empty for approve/free) so callers don't null-check
}

const ENVELOPE_PREFIX = '@@wsq:';

//? The raw object an agent may put in its `ws-needs-input` block (each entry). A bare string ⇒ a free question.
export type RawQuestion = string | { prompt?: unknown; kind?: unknown; options?: unknown };

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
}

//? Normalise a raw agent question (string OR object) into a StructuredQuestion. Unknown/empty kinds and any
//? malformed shape degrade to a free question so a bad envelope never breaks the loop.
export function normalizeQuestion(raw: RawQuestion): StructuredQuestion {
  if (typeof raw === 'string') return { kind: 'free', prompt: raw.trim(), options: [] };
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  const options = strArr(raw.options);
  if (raw.kind === 'approve') return { kind: 'approve', prompt, options: [] };
  //? A choice needs ≥2 options to be answerable; otherwise it's really a free/approve question.
  if (raw.kind === 'choice' && options.length >= 2) return { kind: 'choice', prompt, options };
  return { kind: 'free', prompt, options: [] };
}

//? Encode a structured question into the single `needsInput` string. Free ⇒ the plain prompt (so legacy
//? readers are unaffected); approve/choice ⇒ the `@@wsq:` envelope.
export function encodeQuestion(raw: RawQuestion): string {
  const q = normalizeQuestion(raw);
  if (q.kind === 'free' || q.prompt.length === 0) return q.prompt;
  return ENVELOPE_PREFIX + JSON.stringify(q.kind === 'choice' ? { kind: q.kind, prompt: q.prompt, options: q.options } : { kind: q.kind, prompt: q.prompt });
}

//? Decode a stored `needsInput` string back into a StructuredQuestion. A non-envelope string is a free
//? question (its own text as the prompt); a malformed envelope also degrades to free (never throws).
export function parseStructuredQuestion(raw: string | null | undefined): StructuredQuestion {
  const text = (raw ?? '').trim();
  if (!text.startsWith(ENVELOPE_PREFIX)) return { kind: 'free', prompt: text, options: [] };
  //? Guard JSON.parse synchronously: this helper is isomorphic (imported by the client card AND the server
  //? orchestrator/snapshot) and MUST stay sync — the only client-exported tryCatch is async, which would
  //? force this pure decoder + every caller async. tryCatchSync isn't in the client bundle, so a scoped raw
  //? try/catch is the correct tool here; a bad envelope degrades to a free question, never throws.
  // eslint-disable-next-line luckystack/no-raw-try-catch -- sync isomorphic decoder; async tryCatch would poison the call chain, tryCatchSync is server-only
  try {
    const parsed = JSON.parse(text.slice(ENVELOPE_PREFIX.length)) as RawQuestion;
    const q = normalizeQuestion(parsed);
    return q.prompt.length > 0 ? q : { kind: 'free', prompt: text, options: [] };
  } catch {
    return { kind: 'free', prompt: text, options: [] };
  }
}

//? The human-readable prompt for any stored needsInput string (for list/queue display that shouldn't show
//? the raw envelope).
export function questionPrompt(raw: string | null | undefined): string {
  return parseStructuredQuestion(raw).prompt;
}
