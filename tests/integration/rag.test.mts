//? Integration test for the RAG store + retrieval (server/rag). Runs against real Mongo: proves
//? embeddings are deterministic, cosine behaves, and retrieval RANKS the right chunk on top (an auth
//? query returns auth.ts, a db query returns db.ts) over a fresh workspace's synthetic index.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { retrieve } = await import('../../server/rag/index');
const { embedOne, embedTexts, cosine } = await import('../../server/rag/embed');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rag-${String(stamp)}@youcomm.nl`, name: 'RAG Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'RAG WS');
  const ws = created.workspaceId;
  workspaceId = ws;

  //? embeddings
  const a = await embedOne('database connection pool sql');
  const a2 = await embedOne('database connection pool sql');
  assert(JSON.stringify(a) === JSON.stringify(a2), 'embeddings are deterministic');
  assert(Math.abs(cosine(a, a) - 1) < 1e-6, 'cosine(self) = 1');
  const bvec = await embedOne('react button component ui');
  assert(cosine(a, bvec) < 0.99, 'cosine(different) < 1');

  //? ranking over synthetic chunks
  const COMMIT = 'test-rank';
  const docs = [
    { filePath: 'db.ts', content: 'export function connectDatabase() { return new Pool({ host, port }); }' },
    { filePath: 'button.tsx', content: 'export function Button(props) { return <button>{props.label}</button>; }' },
    { filePath: 'auth.ts', content: 'export function verifyJwtToken(token) { return jwt.verify(token, secret); }' },
  ];
  const vecs = await embedTexts(docs.map((d) => `${d.filePath}\n${d.content}`));
  await prisma.ragEntry.createMany({ data: docs.map((d, i) => ({ workspaceId: ws, commitHash: COMMIT, filePath: d.filePath, chunkId: '0', content: d.content, embedding: vecs[i] ?? [] })) });

  const hitsAuth = await retrieve(prisma, ws, 'how does jwt authentication verify a token', 3, COMMIT);
  eq(hitsAuth[0]?.filePath, 'auth.ts', 'ranking: auth query returns auth.ts on top');
  const hitsDb = await retrieve(prisma, ws, 'connect to the sql database connection pool', 3, COMMIT);
  eq(hitsDb[0]?.filePath, 'db.ts', 'ranking: db query returns db.ts on top');

  await prisma.ragEntry.deleteMany({ where: { workspaceId: ws } });
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/rag.test.mts');
