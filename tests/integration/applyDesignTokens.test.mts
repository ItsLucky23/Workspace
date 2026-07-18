//? A09 — design-token apply is surgical, project/service/branch-aware and revision-safe. Exercises the
//? pure managed-block patch, the REAL Conductor + Mongo, and the real per-project bare git store.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

//? Resolve the real DB before importing server modules that can reach the module-global Prisma client
//? (lesson 0010: otherwise the raw DATABASE_URL pointer can be captured too early).
const prisma = await db();

const {
  activeThemeTokens,
  designTokenCssPath,
  patchManagedThemeCss,
} = await import('../../server/designer/applyTokens');
const {
  commitFilesToBranch,
  initGreenfieldRepo,
  projectDataDir,
  readRepoBranchFile,
  workspaceDataDir,
} = await import('../../server/git/repoStore');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { dispatchControlSync } = await import('../../server/control/dispatchSync');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { saveDesignArtifact, setActiveDesignArtifact } = await import('../../server/designer/library');
const { runInTenant } = await import('../../server/tenant/tenantContext');

const ORIGINAL_CSS = [
  '@import "tailwindcss";',
  '',
  '/* keep-before: authored comment */',
  '@theme {',
  '  --color-primary: #111111; /* keep inline */',
  '  --color-background: #FAFAFA;',
  '  --spacing-card: 1rem;',
  '}',
  '',
  '.dark {',
  '  --color-primary: #EEEEEE;',
  '  --color-background: #050505;',
  '}',
  '',
  'body { margin: 0; }',
  '/* keep-after */',
  '',
].join('\n');

const SERVICE_CSS = ORIGINAL_CSS.replace('keep-before: authored comment', 'service stylesheet comment');
const TOKENS_A = { light: { primary: '#39FF14', secondary: '#5B8DEF' }, dark: { primary: '#22CC11', secondary: '#315EA8' } };
const TOKENS_B = { light: { primary: '#AA11CC' }, dark: { primary: '#DD99EE' } };
const TOKENS_C = { light: { primary: '#1177EE' }, dark: { primary: '#66AAFF' } };

function withoutColorDeclarations(css: string): string {
  return css.replaceAll(/^[ \t]*--color-[A-Za-z0-9_-]+[^\r\n]*(?:\r?\n|$)/gm, '');
}

function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
}

function isControlFailure(value: unknown): boolean {
  return field(value, 'ok') === false;
}

async function setTheme(workspaceId: string, name: string, tokens: { light: Record<string, string>; dark: Record<string, string> }): Promise<void> {
  const themeId = await runInTenant(workspaceId, () => saveDesignArtifact(prisma, workspaceId, {
    kind: 'theme', name, description: `${name} tokens`, content: tokens, source: 'ai',
  }));
  await runInTenant(workspaceId, () => setActiveDesignArtifact(prisma, workspaceId, themeId));
}

async function apply(workspaceId: string, userId: string, projectId: string, requestId: string, serviceId?: string) {
  return enqueueControlAction({
    workspaceId,
    op: 'apply-design-tokens',
    target: { projectId, ...(serviceId ? { serviceId } : {}) },
    payload: {},
    userId,
    clientRequestId: requestId,
  });
}

// ---- pure managed-block patch --------------------------------------------------------------
const pure = patchManagedThemeCss(ORIGINAL_CSS, TOKENS_A);
assert(pure.ok, 'existing Tailwind CSS with one managed theme/dark block is patchable');
if (pure.ok) {
  assert(pure.css.includes('--color-primary: #39FF14; /* keep inline */'), 'light token value changes without deleting its inline comment');
  assert(pure.css.includes('--color-primary: #22CC11;'), 'dark token value changes');
  assert(pure.css.includes('--color-secondary: #5B8DEF;') && pure.css.includes('--color-secondary: #315EA8;'), 'missing active tokens are added inside the managed blocks');
  eq(withoutColorDeclarations(pure.css), withoutColorDeclarations(ORIGINAL_CSS), 'every non-token byte/comment remains unchanged');
}
const nonTailwind = patchManagedThemeCss('body { color: red; }\n', TOKENS_A);
assert(!nonTailwind.ok && nonTailwind.error === 'design.tokensNotTailwind', 'non-Tailwind CSS fails with a typed error');
const missingManaged = patchManagedThemeCss('@import "tailwindcss";\nbody { color: red; }\n', TOKENS_A);
assert(!missingManaged.ok && missingManaged.error === 'design.tokensManagedBlockMissing', 'Tailwind CSS without a managed @theme block fails closed');
const unsafeServicePath = designTokenCssPath('../other-app');
assert(!unsafeServicePath.ok && unsafeServicePath.error === 'design.invalidServicePath', 'service-path traversal fails closed');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `adt-${String(stamp)}@youcomm.nl`, name: 'ADT' } });
let wsId = '';

try {
  wsId = (await createBlankWorkspace(prisma, owner.id, 'ApplyTokens WS')).workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId }, orderBy: { createdAt: 'asc' } });
  const projectId = project?.id ?? '';
  assert(projectId.length > 0, 'blank workspace has a target project');

  await initGreenfieldRepo(wsId, projectId, [
    { path: 'src/index.css', content: ORIGINAL_CSS },
    { path: 'apps/web/src/index.css', content: SERVICE_CSS },
    { path: 'README.md', content: 'initial\n' },
  ]);
  await setTheme(wsId, 'Neon', TOKENS_A);

  // ---- default main + project targeting ---------------------------------------------------
  const mainApply = await apply(wsId, owner.id, projectId, `adt-main-${String(stamp)}`);
  assert(!isControlFailure(mainApply.result), 'Conductor reports a successful ACK for the main-branch patch');
  eq(field(mainApply.result, 'branch'), 'main', 'default git config targets main');
  eq(field(mainApply.result, 'path'), 'src/index.css', 'project-root apply targets the project repo root');
  const mainCss = await readRepoBranchFile(wsId, projectId, 'main', 'src/index.css');
  assert(mainCss.ok && mainCss.content.includes('--color-primary: #39FF14;'), 'main receives the active light token');
  assert(mainCss.ok && withoutColorDeclarations(mainCss.content) === withoutColorDeclarations(ORIGINAL_CSS), 'main retains all authored CSS outside token declarations');

  const unchangedApply = await apply(wsId, owner.id, projectId, `adt-unchanged-${String(stamp)}`);
  assert(!isControlFailure(unchangedApply.result) && field(unchangedApply.result, 'changed') === false, 're-applying the same revision is an honest successful no-op');

  const bare = path.join(projectDataDir(wsId, projectId), 'repo.git');
  execFileSync('git', ['--git-dir', bare, 'branch', 'master', 'main']);
  await prisma.workspace.update({ where: { id: wsId }, data: { gitConfig: { targetBranch: 'master' } } });
  await setTheme(wsId, 'Purple', TOKENS_B);
  const masterApply = await apply(wsId, owner.id, projectId, `adt-master-${String(stamp)}`);
  assert(!isControlFailure(masterApply.result) && field(masterApply.result, 'branch') === 'master', 'configured master branch is used without a hardcoded main');
  const masterCss = await readRepoBranchFile(wsId, projectId, 'master', 'src/index.css');
  const mainAfterMaster = await readRepoBranchFile(wsId, projectId, 'main', 'src/index.css');
  assert(masterCss.ok && masterCss.content.includes('#AA11CC'), 'master receives its token revision');
  assert(mainAfterMaster.ok && mainAfterMaster.content.includes('#39FF14') && !mainAfterMaster.content.includes('#AA11CC'), 'main is untouched when master is configured');

  // ---- arbitrary configured branch + monorepo service path --------------------------------
  execFileSync('git', ['--git-dir', bare, 'branch', 'release/design', 'master']);
  await prisma.workspace.update({ where: { id: wsId }, data: { gitConfig: { targetBranch: 'release/design' } } });
  await setTheme(wsId, 'Blue', TOKENS_C);
  const service = await prisma.service.create({ data: { workspaceId: wsId, projectId, name: 'web', path: 'apps/web' } });
  const rootBeforeService = await readRepoBranchFile(wsId, projectId, 'release/design', 'src/index.css');
  const serviceApply = await apply(wsId, owner.id, projectId, `adt-service-${String(stamp)}`, service.id);
  assert(!isControlFailure(serviceApply.result), 'service-scoped token apply succeeds');
  eq(field(serviceApply.result, 'branch'), 'release/design', 'an arbitrary configured target branch is honored');
  eq(field(serviceApply.result, 'path'), 'apps/web/src/index.css', 'monorepo service.path resolves the target stylesheet');
  const serviceCss = await readRepoBranchFile(wsId, projectId, 'release/design', 'apps/web/src/index.css');
  const rootAfterService = await readRepoBranchFile(wsId, projectId, 'release/design', 'src/index.css');
  assert(serviceCss.ok && serviceCss.content.includes('#1177EE'), 'only the selected service stylesheet receives the configured tokens');
  assert(rootBeforeService.ok && rootAfterService.ok && rootAfterService.content === rootBeforeService.content, 'service apply does not mutate the project-root stylesheet');

  // ---- stale expected HEAD / CAS race ------------------------------------------------------
  const stale = await readRepoBranchFile(wsId, projectId, 'release/design', 'apps/web/src/index.css');
  assert(stale.ok, 'race test captured an expected branch HEAD');
  if (stale.ok) {
    const stalePatch = patchManagedThemeCss(stale.content, TOKENS_B);
    assert(stalePatch.ok, 'race candidate patch is valid');
    const concurrent = await commitFilesToBranch({
      workspaceId: wsId,
      projectId,
      branch: 'release/design',
      expectedHead: stale.head,
      files: [{ path: 'README.md', content: 'concurrent edit survives\n' }],
      message: 'test: concurrent edit',
    });
    assert(concurrent.ok && concurrent.status === 'committed', 'a concurrent branch edit advances HEAD');
    if (stalePatch.ok) {
      const raced = await commitFilesToBranch({
        workspaceId: wsId,
        projectId,
        branch: 'release/design',
        expectedHead: stale.head,
        files: [{ path: 'apps/web/src/index.css', content: stalePatch.css }],
        message: 'test: stale token patch',
      });
      assert(!raced.ok && raced.error === 'repo.headChanged', 'stale expected HEAD fails with the typed CAS race result');
    }
    const afterRaceCss = await readRepoBranchFile(wsId, projectId, 'release/design', 'apps/web/src/index.css');
    const afterRaceReadme = await readRepoBranchFile(wsId, projectId, 'release/design', 'README.md');
    assert(afterRaceCss.ok && afterRaceCss.content === stale.content, 'the stale token patch never overwrites concurrent HEAD');
    assert(afterRaceReadme.ok && afterRaceReadme.content === 'concurrent edit survives\n', 'the concurrent edit is preserved byte-for-byte');
  }

  // ---- typed fail-closed outcomes + honest current control failure propagation --------------
  await prisma.workspace.update({ where: { id: wsId }, data: { gitConfig: { targetBranch: 'main' } } });
  const missingProject = await prisma.project.create({ data: { workspaceId: wsId, name: 'Missing block', gitlabPath: '' } });
  await initGreenfieldRepo(wsId, missingProject.id, [{ path: 'src/index.css', content: '@import "tailwindcss";\nbody { color: red; }\n' }]);
  const missingApply = await apply(wsId, owner.id, missingProject.id, `adt-missing-${String(stamp)}`);
  assert(isControlFailure(missingApply.result), 'missing managed block is a semantic control failure, never a success ACK');
  eq(field(missingApply.result, 'error'), 'design.tokensManagedBlockMissing', 'Conductor retains the typed missing-block failure');

  const nonTailwindProject = await prisma.project.create({ data: { workspaceId: wsId, name: 'Not Tailwind', gitlabPath: '' } });
  await initGreenfieldRepo(wsId, nonTailwindProject.id, [{ path: 'src/index.css', content: 'body { color: red; }\n' }]);
  const nonTailwindApply = await apply(wsId, owner.id, nonTailwindProject.id, `adt-notw-${String(stamp)}`);
  assert(isControlFailure(nonTailwindApply.result), 'non-Tailwind target is a semantic control failure');
  eq(field(nonTailwindApply.result, 'error'), 'design.tokensNotTailwind', 'Conductor retains the typed non-Tailwind failure');

  const syncAck = await dispatchControlSync({
    op: 'apply-design-tokens',
    roomCode: wsId,
    userId: owner.id,
    prisma,
    target: { projectId: missingProject.id },
    payload: {},
    clientRequestId: `adt-sync-fail-${String(stamp)}`,
  });
  assert(!syncAck.ok && syncAck.errorCode === 'sync.invalidRequest', 'current control failure propagation returns an error ACK to the sync/UI caller');

  const active = await activeThemeTokens(prisma, wsId);
  assert(active.ok && active.tokens.light.primary === '#1177EE', 'active theme resolver returns validated token data, not a replacement stylesheet');
} finally {
  if (wsId) {
    await cleanupWorkspace(prisma, wsId, [owner.id]);
    rmSync(workspaceDataDir(wsId), { recursive: true, force: true });
  } else {
    await prisma.user.delete({ where: { id: owner.id } });
  }
}

report('applyDesignTokens');
