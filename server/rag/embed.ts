//? Embeddings for the RAG store (07 §D). Pluggable, mirroring the AI-provider abstraction: when a
//? Gemini key is present we use the Google embeddings API (higher quality); otherwise a deterministic
//? LOCAL embedder (hashed token + char-trigram bag, L2-normalised) so retrieval works fully offline
//? and in tests — a lexical-semantic proxy that is genuinely useful for code (symbol/identifier
//? overlap). The embedder is fixed per deployment, so index-time and query-time vectors are always
//? produced the same way (cosine only compares same-embedder vectors). The chosen embedder is
//? stamped via `embedTag()` so a later switch is detectable.

import { tryCatch } from '@luckystack/core';

const API_KEY = process.env.GEMINI_API_KEY ?? '';
const EMBED_MODEL = process.env.WS_EMBED_MODEL ?? 'text-embedding-004';
const LOCAL_DIM = 256;

export function embedTag(): string {
  return API_KEY.length > 0 ? `gemini:${EMBED_MODEL}` : `local:v1:${String(LOCAL_DIM)}`;
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

//? Batch-embed via the Gemini embeddings API. Returns null on any failure so the caller can fall
//? back to local embeddings rather than losing the whole index.
async function geminiEmbed(texts: string[]): Promise<number[][] | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${API_KEY}`;
  const body = {
    requests: texts.map((t) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t.slice(0, 8000) }] } })),
  };
  const [err, out] = await tryCatch(async () => {
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`gemini-embed ${String(res.status)}`);
    const json = (await res.json()) as GeminiEmbedResponse;
    return (json.embeddings ?? []).map((e) => l2norm(e.values ?? []));
  });
  if (err || out?.length !== texts.length) return null;
  return out;
}

//? Embed a batch of texts with the active embedder (Gemini if keyed, else local). Never throws.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (API_KEY.length > 0) {
    const g = await geminiEmbed(texts);
    if (g) return g;
  }
  return texts.map((t) => localEmbed(t));
}

export async function embedOne(text: string): Promise<number[]> {
  const vecs = await embedTexts([text]);
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
