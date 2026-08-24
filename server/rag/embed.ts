//? @adr 0325
//? Embeddings for the RAG store (07 §D). Pluggable, mirroring the AI-provider abstraction: the Gemini
//? embeddings API when a key is available (higher quality); otherwise a deterministic LOCAL embedder
//? (hashed token + char-trigram bag, L2-normalised) so retrieval works fully offline and in tests — a
//? lexical-semantic proxy that is genuinely useful for code (symbol/identifier overlap).
//?
//? Fase 5.2 — the embedder is fixed PER WORKSPACE, not per deployment: the stored choice
//? (`__ai_provider_embedding` = 'gemini-embedding[:model]' | 'local-embedding', saved through the same
//? save-ai-provider op as every per-feature backend) resolves first, its key comes from the workspace's
//? AiConnection ('gemini-embedding'), and the host GEMINI_API_KEY stays as the legacy fallback for a
//? workspace without a choice. Cosine only compares same-embedder vectors, so every stored chunk is
//? stamped with the producing embedder's tag and retrieval GATES on it — switching embedders is
//? detectable and requires a re-index rather than silently mixing vector spaces.

import { tryCatch, getPrismaClient } from '@luckystack/core';

import { connectionFor } from '../ai/connections';
import { AI_EMBEDDING_FEATURE, AI_OVERRIDE_PREFIX } from '../ai/workspaceAssignments';
import { recordAiRun } from '../ai/activity';
import { recordTurnSpend } from '../spend/record';

//? Read the key LAZILY (at call time), not at module load: `GEMINI_API_KEY` is a @luckystack/secret-manager
//? pointer that only resolves into process.env AFTER boot's secret resolution — capturing it at import time
//? would freeze the unresolved pointer (key set but silently forced to the local fallback). Mirrors the
//? deliberate lazy read in server/ai/providers/geminiApi.ts.
const geminiKey = (): string => process.env.GEMINI_API_KEY ?? '';
//? text-embedding-004 was retired by Google (404s since mid-2026, silently forcing the local
//? fallback) — gemini-embedding-001 is the current embeddings model (3072-dim).
const EMBED_MODEL = process.env.WS_EMBED_MODEL ?? 'gemini-embedding-001';
const LOCAL_DIM = 256;

const localTag = (): string => `local:v1:${String(LOCAL_DIM)}`;

//? The resolved embedder for one call: which implementation, with which key/model, under which tag.
interface ResolvedEmbedder { kind: 'gemini' | 'local'; apiKey: string; model: string; tag: string }

const HOST_EMBEDDER = (): ResolvedEmbedder =>
  (geminiKey().length > 0
    ? { kind: 'gemini', apiKey: geminiKey(), model: EMBED_MODEL, tag: `gemini:${EMBED_MODEL}` }
    : { kind: 'local', apiKey: '', model: '', tag: localTag() });

//? Resolve the workspace's embedder. No workspaceId / no stored choice ⇒ the host legacy behaviour
//? (GEMINI_API_KEY present → Gemini, else local) so existing deployments keep their exact semantics.
//? A stored gemini choice whose key is missing everywhere degrades to LOCAL — with the local tag, so
//? the mismatch is visible instead of producing key-less 401 vectors. Never throws.
async function resolveEmbedder(workspaceId?: string): Promise<ResolvedEmbedder> {
  if (!workspaceId) return HOST_EMBEDDER();
  const [, row] = await tryCatch(() => getPrismaClient().envVar.findFirst({
    where: { workspaceId, key: `${AI_OVERRIDE_PREFIX}${AI_EMBEDDING_FEATURE}` }, select: { value: true },
  }));
  const value = (row?.value ?? '').trim();
  if (value.length === 0) return HOST_EMBEDDER();
  if (value === 'local-embedding') return { kind: 'local', apiKey: '', model: '', tag: localTag() };
  const colon = value.indexOf(':');
  const providerId = colon === -1 ? value : value.slice(0, colon);
  if (providerId !== 'gemini-embedding') return HOST_EMBEDDER();
  const pinnedModel = colon === -1 ? '' : value.slice(colon + 1).trim();
  const connection = await connectionFor(workspaceId, 'gemini-embedding');
  //? Each step can legitimately be the empty string (no pin, keyless/modelless row) — fall through.
  const connModel = (connection?.model ?? '').trim();
  const model = pinnedModel.length > 0 ? pinnedModel : (connModel.length > 0 ? connModel : EMBED_MODEL);
  const apiKey = connection?.apiKey ?? '';
  const key = apiKey.length > 0 ? apiKey : geminiKey();
  if (key.length === 0) return { kind: 'local', apiKey: '', model: '', tag: localTag() };
  return { kind: 'gemini', apiKey: key, model, tag: `gemini:${model}` };
}

/** The HOST-level legacy tag (no workspace choice consulted) — global corpora + legacy '' rows. */
export function embedTag(): string {
  return HOST_EMBEDDER().tag;
}

/** The tag of the embedder THIS workspace's vectors are produced with (Fase 5.2). */
export async function embedTagFor(workspaceId?: string): Promise<string> {
  const resolved = await resolveEmbedder(workspaceId);
  return resolved.tag;
}

/** Whether a stored chunk's tag is comparable with the current tag. Legacy rows (written before the
 *  per-row stamp existed, tag '') were produced by the HOST embedder of their day — accept them only
 *  when the current tag IS the host tag, so two known-different embedders never mix. */
export function embedTagMatches(rowTag: string, currentTag: string): boolean {
  return rowTag === currentTag || (rowTag === '' && currentTag === embedTag());
}

//? FNV-1a — a small, fast, stable string hash (no Math.random, deterministic across runs).
function hash(s: string): number {
  let h = 2_166_136_261; //? FNV-1a 32-bit offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.codePointAt(i) ?? 0;
    h = Math.imul(h, 16_777_619); //? FNV-1a 32-bit prime
  }
  return h >>> 0;
}

function l2norm(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  if (n === 0) return v;
  return v.map((x) => x / n);
}

//? Deterministic local embedding: word buckets + char-trigram buckets (sub-word robustness), then
//? L2-normalise so a dot product IS the cosine. Same text → same vector, always.
function localEmbed(text: string): number[] {
  const v = Array.from<number>({ length: LOCAL_DIM }).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const t of tokens) {
    const wi = hash(t) % LOCAL_DIM;
    v[wi] = (v[wi] ?? 0) + 1;
    for (let i = 0; i + 3 <= t.length; i++) {
      const ci = hash(t.slice(i, i + 3)) % LOCAL_DIM;
      v[ci] = (v[ci] ?? 0) + 0.5;
    }
  }
  return l2norm(v);
}

interface GeminiEmbedResponse { embeddings?: { values?: number[] }[] }

//? batchEmbedContents accepts at most 100 requests per call — larger corpora (the 200+ chunk
//? product-knowledge index) 400 without slicing.
const GEMINI_BATCH_MAX = 100;

//? Batch-embed via the Gemini embeddings API (sliced to the API's batch limit). Returns null on
//? any failure so the caller can fall back to local embeddings rather than losing the whole index.
async function geminiEmbed(texts: string[], apiKey: string, model: string): Promise<number[][] | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;
  const [err, out] = await tryCatch(async () => {
    const all: number[][] = [];
    for (let start = 0; start < texts.length; start += GEMINI_BATCH_MAX) {
      const slice = texts.slice(start, start + GEMINI_BATCH_MAX);
      const body = {
        requests: slice.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t.slice(0, 8000) }] } })),
      };
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`gemini-embed ${String(res.status)}`);
      const json = (await res.json()) as GeminiEmbedResponse;
      all.push(...(json.embeddings ?? []).map((e) => l2norm(e.values ?? [])));
    }
    return all;
  });
  if (err || out?.length !== texts.length) return null;
  return out;
}

//? Fase 5.2 — the embedding half of `ai-connection-test`: one REAL 1-text embed proves the key +
//? model together. The local embedder has nothing to prove and always passes.
export async function pingEmbedding(providerId: string, apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  if (providerId === 'local-embedding') return { ok: true };
  if (providerId !== 'gemini-embedding') return { ok: false, error: 'ai.testUnsupported' };
  const key = apiKey.trim().length > 0 ? apiKey.trim() : geminiKey();
  if (key.length === 0) return { ok: false, error: 'ai.keyRequired' };
  const out = await geminiEmbed(['ping'], key, model.trim().length > 0 ? model.trim() : EMBED_MODEL);
  return out === null ? { ok: false, error: 'ai.testFailed' } : { ok: true };
}

//? Metering context for a batch: which workspace pays/sees the run. Embeddings previously ran
//? completely invisible (no SpendRecord, no Activity entry) — the gap-scan billing leak. Only the
//? METERED path (Gemini) records; the local embedder is free and stays silent.
export interface EmbedMeterCtx { workspaceId?: string; feature?: string }

function meterEmbedRun(texts: string[], meter: EmbedMeterCtx, model: string, startedAt: number): void {
  if (!meter.workspaceId) return;
  const workspaceId = meter.workspaceId;
  const feature = meter.feature ?? 'rag-embed';
  const inputChars = texts.reduce((sum, t) => sum + Math.min(t.length, 8000), 0);
  recordAiRun({ workspaceId, feature, prompt: `embed ${String(texts.length)} chunks (${String(inputChars)} chars)`, output: '', providerId: 'gemini', status: 'ok', startedAt });
  void tryCatch(() => recordTurnSpend(getPrismaClient(), { workspaceId, sessionKey: `embed:${feature}`, model, providerId: 'gemini', feature, inputChars, outputChars: 0 }));
}

//? Embed a batch of texts with the workspace's active embedder (Fase 5.2: resolved from
//? `meter.workspaceId`; Gemini if chosen/keyed, else local) AND report which tag actually produced
//? the vectors — a Gemini outage falls back to local mid-call, and stamping those rows 'gemini'
//? would poison the store. Writers persist `tag` per row; never throws.
export async function embedTextsTagged(texts: string[], meter: EmbedMeterCtx = {}): Promise<{ vectors: number[][]; tag: string }> {
  const embedder = await resolveEmbedder(meter.workspaceId);
  if (texts.length === 0) return { vectors: [], tag: embedder.tag };
  if (embedder.kind === 'gemini') {
    const startedAt = Date.now();
    const g = await geminiEmbed(texts, embedder.apiKey, embedder.model);
    if (g) {
      meterEmbedRun(texts, meter, embedder.model, startedAt);
      return { vectors: g, tag: embedder.tag };
    }
  }
  return { vectors: texts.map((t) => localEmbed(t)), tag: localTag() };
}

//? Vector-only variant for the QUERY side (the stored rows carry the authoritative tags).
export async function embedTexts(texts: string[], meter: EmbedMeterCtx = {}): Promise<number[][]> {
  const tagged = await embedTextsTagged(texts, meter);
  return tagged.vectors;
}

export async function embedOne(text: string, meter: EmbedMeterCtx = {}): Promise<number[]> {
  const vecs = await embedTexts([text], meter);
  return vecs[0] ?? [];
}

//? Cosine similarity of two same-embedder vectors. They are L2-normalised, so this is a dot product;
//? falls back to a safe formula if a stored vector was not normalised.
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi; na += ai * ai; nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
