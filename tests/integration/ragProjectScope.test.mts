//? R3-b RAG follow-up — code retrieval is scoped to the PROJECT. Two projects in one workspace each get
//? their own code index (distinct projectId + commitHash). `retrieve()` WITHOUT an explicit commit but WITH
//? a projectId must return THAT project's code, even when the OTHER project was indexed more recently (the
//? pre-fix "latest commit in the workspace" pick would have hijacked it → the coding agent for project A
//? would see project B's code). Real Mongo, deterministic embedder, no Docker.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { retrieve } = await import('../../server/rag/index');
const { embedTexts } = await import('../../server/rag/embed');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ragscope-${String(stamp)}@youcomm.nl`, name: 'RS' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'RAG Scope WS');
  workspaceId = created.workspaceId;
  const ws = created.workspaceId;

  const projA = await prisma.project.create({ data: { workspaceId: ws, name: 'Backend', gitlabPath: 'ws/be', stack: 'node' } });
  const projB = await prisma.project.create({ data: { workspaceId: ws, name: 'Frontend', gitlabPath: 'ws/fe', stack: 'node' } });

  //? Project A's code is about SQL/auth; project B's is about React UI. Distinct commits.
  const aDocs = [{ filePath: 'src/auth.ts', content: 'verify jwt token and check the sql database session' }];
  const bDocs = [{ filePath: 'src/Button.tsx', content: 'a react button ui component with tailwind styling' }];
  const aVecs = await embedTexts(aDocs.map((d) => `${d.filePath}\n${d.content}`));
  const bVecs = await embedTexts(bDocs.map((d) => `${d.filePath}\n${d.content}`));

  //? Index A FIRST, then B (B is newer → the pre-fix workspace-wide "latest commit" would pick B for both).
  await prisma.ragEntry.createMany({ data: aDocs.map((d, i) => ({ workspaceId: ws, projectId: projA.id, commitHash: 'commit-A', filePath: d.filePath, chunkId: '0', content: d.content, embedding: aVecs[i] ?? [] })) });
  await new Promise((r) => setTimeout(r, 20));
  await prisma.ragEntry.createMany({ data: bDocs.map((d, i) => ({ workspaceId: ws, projectId: projB.id, commitHash: 'commit-B', filePath: d.filePath, chunkId: '0', content: d.content, embedding: bVecs[i] ?? [] })) });

  //? retrieve for project A (no explicit commit) → gets A's code, NOT B's newer index.
  const forA = await retrieve(prisma, ws, 'how does jwt auth verify against the database', 3, undefined, projA.id);
  assert(forA.length > 0 && forA[0]?.filePath === 'src/auth.ts', 'project A retrieval returns A\'s code (auth.ts), not B\'s newer index');
  assert(!forA.some((h) => h.filePath === 'src/Button.tsx'), 'project A retrieval never leaks project B\'s files');

  //? retrieve for project B → gets B's code.
  const forB = await retrieve(prisma, ws, 'the react ui button component', 3, undefined, projB.id);
  assert(forB.length > 0 && forB[0]?.filePath === 'src/Button.tsx', 'project B retrieval returns B\'s code (Button.tsx)');
  assert(!forB.some((h) => h.filePath === 'src/auth.ts'), 'project B retrieval never leaks project A\'s files');

  //? Without a projectId, the workspace-wide fallback still works (chat/interviewer path) — picks the latest.
  const wide = await retrieve(prisma, ws, 'react ui', 3);
  eq(wide[0]?.filePath, 'src/Button.tsx', 'the projectless (workspace-wide) path still resolves the latest commit');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/ragProjectScope.test.mts');
