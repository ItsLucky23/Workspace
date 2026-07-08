//? Q1 — the product self-knowledge corpus generator. Verifies the generated shard's shape + that the
//? key capability (video editing) + the ADR corpus are present, and that re-running the generator is
//? DETERMINISTIC (same hash) so a no-op commit stays byte-identical. No DB, no providers.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { assert, eq, report } from '../_helpers.mts';

interface Chunk { id: string; kind: string; title: string; text: string }
interface Corpus { hash: string; chunkCount: number; chunks: Chunk[] }

const read = (): Corpus => JSON.parse(readFileSync('docs/AI_PRODUCT_KNOWLEDGE.json', 'utf8')) as Corpus;

//? Re-run the generator (idempotent) then read the corpus.
execFileSync('node', ['scripts/generateProductKnowledge.mjs'], { stdio: 'ignore' });
const first = read();

//? Shape.
assert(typeof first.hash === 'string' && first.hash.length >= 8, 'corpus has a content hash');
eq(first.chunkCount, first.chunks.length, 'chunkCount matches the chunk array');
assert(first.chunks.length > 50, `corpus has many chunks (${String(first.chunks.length)})`);

//? Both kinds present.
const kinds = new Set(first.chunks.map((c) => c.kind));
assert(kinds.has('capability') && kinds.has('decision'), 'corpus has capability + decision chunks');

//? The load-bearing capability: "can I edit videos?" is a retrievable chunk that names the media module.
const videos = first.chunks.find((c) => c.kind === 'capability' && /edit videos/i.test(c.title));
assert(videos !== undefined, 'the video-editing capability chunk exists');
assert(/media|timeline editor/i.test(videos?.text ?? ''), 'the video chunk points at the media module / timeline editor');

//? Every ADR becomes a chunk (id adr-NNNN), and each carries its title + a summary.
const adrs = first.chunks.filter((c) => c.kind === 'decision');
assert(adrs.length > 20, `all ADRs are chunked (${String(adrs.length)})`);
assert(adrs.every((c) => /^adr-\d{4}$/.test(c.id) && c.text.length > 20), 'each ADR chunk has an adr-NNNN id + a summary');

//? Determinism: a second run produces the SAME hash (no timestamps / ordering drift).
execFileSync('node', ['scripts/generateProductKnowledge.mjs'], { stdio: 'ignore' });
const second = read();
eq(second.hash, first.hash, 'the generator is deterministic (stable hash across runs)');

report('tests/unit/productKnowledge.test.mts');
