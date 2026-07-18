//? DESIGN_DOCS_PROGRAM 3.4 through the REAL Conductor + Mongo + a real greenfield git repo: activating a
//? theme + `apply-design-tokens` commits the workspace's active tokens to the project's src/index.css as a
//? fast mechanical commit (no pipeline run). Also asserts the pure CSS generator.

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { saveDesignArtifact, setActiveDesignArtifact } = await import('../../server/designer/library');
const { buildIndexCss } = await import('../../server/designer/applyTokens');
const { isLinked, showRepoFile } = await import('../../server/git/repoStore');
const { runInTenant } = await import('../../server/tenant/tenantContext');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 15_000, stepMs = 150): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure: the CSS generator ----
const css = buildIndexCss({ background: '#0B1020', primary: '#5B8DEF' }, { background: '#000000' });
assert(css.includes('@theme {') && css.includes('--color-background: #0B1020;') && css.includes('--color-primary: #5B8DEF;'), 'buildIndexCss emits the @theme light tokens');
assert(css.includes('.dark {') && css.includes('--color-background: #000000;'), 'buildIndexCss emits the .dark overrides');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `adt-${String(stamp)}@youcomm.nl`, name: 'ADT' } });
let wsId = '';

try {
  wsId = (await createBlankWorkspace(prisma, owner.id, 'ApplyTokens WS')).workspaceId;

  //? A greenfield project → a real linked repo to commit into.
  await enqueueControlAction({ workspaceId: wsId, op: 'project-from-template', target: {}, payload: { name: 'Tokens App', template: 'react-vite' }, userId: owner.id, clientRequestId: `pft-${String(stamp)}` });
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, name: 'Tokens App' } }));
  assert(project !== null && isLinked(wsId, project.id), 'greenfield repo linked');

  //? Save + activate a theme.
  const themeId = await runInTenant(wsId, () => saveDesignArtifact(prisma, wsId, { kind: 'theme', name: 'Neon', description: 'bold neon', content: { light: { background: '#0B1020', primary: '#39FF14' }, dark: { background: '#000000', primary: '#39FF14' } }, source: 'ai' }));
  await runInTenant(wsId, () => setActiveDesignArtifact(prisma, wsId, themeId));

  //? Apply the active tokens to the project's src/index.css.
  await enqueueControlAction({ workspaceId: wsId, op: 'apply-design-tokens', target: {}, payload: { projectId: project?.id }, userId: owner.id, clientRequestId: `adt-${String(stamp)}` });

  const indexCss = await poll(async () => {
    const [, content] = await import('@luckystack/core').then((m) => m.tryCatch(() => showRepoFile(wsId, project?.id ?? '', 'HEAD', 'src/index.css')));
    return content && content.includes('--color-primary: #39FF14;') ? content : null;
  });
  assert(indexCss !== null, '3.4: apply-design-tokens committed src/index.css with the active tokens');
  assert((indexCss ?? '').includes('.dark {'), '3.4: the committed CSS carries the dark overrides too');
} finally {
  if (wsId) await prisma.designArtifact.deleteMany({ where: { workspaceId: wsId } });
  if (wsId) await prisma.ragEntry.deleteMany({ where: { workspaceId: wsId, commitHash: 'design-library' } });
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('applyDesignTokens');
