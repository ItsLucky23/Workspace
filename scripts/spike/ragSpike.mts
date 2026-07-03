//? Spike — prove the RAG pipeline (07 §D) against real Mongo:
//?  1. embeddings are deterministic; cosine(self)=1; a different text is < 1.
//?  2. RANKING (the real value): given 3 stored chunks (db / button / auth), an auth query returns
//?     auth.ts on top and a db query returns db.ts on top — retrieval actually discriminates.
//?  3. indexWorkspace reads a linked repo, embeds + stores chunks; retrieve returns hits.
//? Run (needs the DB tunnel): npx tsx scripts/spike/ragSpike.mts

import { db } from '../../tests/_helpers.mts';

const prisma = await db();
const { indexWorkspace, retrieve } = await import('../../server/rag/index');
const { embedOne, embedTexts, cosine } = await import('../../server/rag/embed');

const ok = (label: string, cond: boolean): void => { console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); };
const WS = '6a46529cb23a6511a8afdb7a'; //? a workspace with a linked bare clone

//? 1. embeddings
const a = await embedOne('database connection pool sql');
const a2 = await embedOne('database connection pool sql');
ok('embed deterministic', JSON.stringify(a) === JSON.stringify(a2));
ok('cosine(self) = 1', Math.abs(cosine(a, a) - 1) < 1e-6);
const bvec = await embedOne('react button component ui');
ok('cosine(different) < 1', cosine(a, bvec) < 0.99);

//? 2. ranking over synthetic chunks
const COMMIT = 'spike-rank';
await prisma.ragEntry.deleteMany({ where: { workspaceId: WS, commitHash: COMMIT } });
const docs = [
  { filePath: 'db.ts', content: 'export function connectDatabase() { return new Pool({ host, port }); }' },
  { filePath: 'button.tsx', content: 'export function Button(props) { return <button>{props.label}</button>; }' },
  { filePath: 'auth.ts', content: 'export function verifyJwtToken(token) { return jwt.verify(token, secret); }' },
];
const vecs = await embedTexts(docs.map((d) => `${d.filePath}\n${d.content}`));
await prisma.ragEntry.createMany({ data: docs.map((d, i) => ({ workspaceId: WS, commitHash: COMMIT, filePath: d.filePath, chunkId: '0', content: d.content, embedding: vecs[i] ?? [] })) });
const hitsAuth = await retrieve(prisma, WS, 'how does jwt authentication verify a token', 3, COMMIT);
ok(`ranking: auth query → auth.ts on top (got ${hitsAuth[0]?.filePath ?? '-'})`, hitsAuth[0]?.filePath === 'auth.ts');
const hitsDb = await retrieve(prisma, WS, 'connect to the sql database connection pool', 3, COMMIT);
ok(`ranking: db query → db.ts on top (got ${hitsDb[0]?.filePath ?? '-'})`, hitsDb[0]?.filePath === 'db.ts');
await prisma.ragEntry.deleteMany({ where: { workspaceId: WS, commitHash: COMMIT } });

//? 3. real index + retrieve
const idx = await indexWorkspace(prisma, WS);
ok(`index real repo (files=${String(idx.files)} chunks=${String(idx.chunks)} embedder=${idx.embedder})`, idx.ok && idx.chunks > 0);
const hits = await retrieve(prisma, WS, 'readme project overview', 3);
ok(`retrieve from real index returns hits (${String(hits.length)})`, hits.length > 0);

console.log('done');
process.exit(0);
