//? Setup-readiness + permission-aware "what's missing / how to fix it" UX (new-user UX pass).
//?
//? Context: many features silently do nothing until a precondition is met — no git repo → the whole Develop
//? module is dead; no media key → generation "succeeds" with placeholder assets; no AI provider → every AI
//? feature returns nothing. Before this pass the failure was a blank empty state. Now the snapshot ships a
//? `readiness` block + the caller's resolved `myPerms`, and a shared `SetupNotice` renders WHAT is missing,
//? WHY it's blocked and HOW to fix it — with a permission-aware CTA (fix it) vs "ask someone with <cap>".
//?
//? Pinned here: the readiness computation (the core logic), the client CAP mirror staying in lockstep with
//? the server RBAC enum (a drift silently mis-gates every fix button), and that the notice is actually wired
//? into the blocked states + translated in all four locales.

import { readFileSync } from 'node:fs';

import { assert, eq, report } from '../_helpers.mts';
import { buildReadiness, hostReadiness } from '../../server/read/readiness.ts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------ readiness: media from workspace keys + env */

//? The test harness blanks the provider ENV keys to force the stub world, so env-based signals are false by
//? default and the workspace-stored `__provider_key_<id>` set is the deterministic driver.
const base = { repoLinked: true, publishingConnected: false, providerKeys: new Set<string>() };

const none = await buildReadiness(1000, base);
assert(!none.media.fal && !none.media.elevenlabs && !none.media.suno, 'no stored key + blanked env ⇒ every media provider is unconfigured');
assert(none.repoLinked, 'repoLinked passes through');
assert(!none.publishing, 'publishing passes through (no connected account)');

const withEleven = await buildReadiness(1000, { ...base, providerKeys: new Set(['__provider_key_elevenlabs']) });
assert(withEleven.media.elevenlabs, 'a stored __provider_key_elevenlabs flips elevenlabs on');
assert(!withEleven.media.fal, 'and does NOT flip an unrelated provider on');

//? The env fallback each registry also honours must count as configured (else a host that configured keys via
//? env would get a false "key missing" notice).
process.env.FAL_KEY = 'test-fal';
const withEnvFal = await buildReadiness(1000, base);
assert(withEnvFal.media.fal, 'the FAL_KEY env fallback counts as configured');
process.env.FAL_KEY = '';

process.env.GEMINI_API_KEY = 'test-gemini';
const withGemini = await buildReadiness(1000, base);
assert(withGemini.aiText, 'a Gemini key makes AI text available even without the Claude CLI');
process.env.GEMINI_API_KEY = '';

/* ------------------------------------------------------------ host readiness is cached (no probe per call) */

const h1 = await hostReadiness(5000);
const h2 = await hostReadiness(5000 + 1000);   // within the 30s TTL
assert(h1 === h2, 'host readiness is memoised within its TTL — the docker probe does not run on every snapshot');
assert(typeof h1.docker === 'boolean' && typeof h1.push === 'boolean' && typeof h1.secretManager === 'boolean', 'host readiness reports plain booleans');

/* ------------------------------------------------------------ the client CAP mirror matches the server RBAC */

//? A drift between the client CAP indices and the server CAP enum silently mis-gates EVERY fix button (the
//? wrong `myPerms[cap]` is read). Extract both index maps and compare.
const serverRbac = read('server/control/rbac.ts');
const clientCaps = read('src/workspaces/_data/capabilities.ts');
const capNames = ['workTickets', 'editPipeline', 'workspaceSettings', 'manageMembers', 'manageSprints', 'promoteAdmin', 'demoteAdmin', 'ownerActions'] as const;
for (const [index, name] of capNames.entries()) {
  assert(serverRbac.includes(`${name}: ${index}`), `server rbac defines ${name} = ${index}`);
  assert(clientCaps.includes(`${name}: ${index}`), `client mirror defines ${name} = ${index}`);
}

/* ------------------------------------------------------------ myPerms semantics (owner all, member limited) */

//? The snapshot resolves the caller's raw role → WorkspaceRole.perms. The default matrix is the invariant the
//? "fix it vs ask owner" split depends on: an owner may do workspace settings, a plain member may not.
const seed = read('src/workspaces/_data/seed.ts');
assert(seed.includes("perms: RBAC_CAPABILITIES.map(() => true)"), 'the owner role is all-allowed');
assert(seed.includes('const MEMBER_PERMS = [true, false, false, false, false, false, false, false]'), 'a plain member lacks workspaceSettings (index 2 = false) — so they get "ask the owner", not a dead button');

//? The snapshot actually ships the three foundation fields.
const snapshot = read('server/read/workspaceSnapshot.ts');
for (const field of ['readiness', 'myPerms', 'myRoleKey']) assert(snapshot.includes(`${field}`), `the snapshot exposes ${field}`);
assert(snapshot.includes('roleRows.find((r) => r.key === myRoleKey)?.perms ?? []'), 'myPerms resolves the RAW role key (custom roles included), mirroring the server hasCapability');

/* ------------------------------------------------------------ the notice is WIRED into the blocked states */

const wired: [string, string][] = [
  ['src/workspaces/develop/code/page.tsx', 'no repo → Code'],
  ['src/workspaces/develop/terminals/page.tsx', 'docker/repo → Terminals'],
  ['src/workspaces/content/[pieceId]/page.tsx', 'media/publishing → content piece'],
  ['src/workspaces/content/studio/page.tsx', 'AI → Studio'],
  ['src/workspaces/develop/designer/page.tsx', 'media → Designer'],
  ['src/workspaces/_shell/Shell.tsx', 'AI → the Workspace-AI panel'],
];
for (const [path, label] of wired) assert(read(path).includes('SetupNotice'), `SetupNotice is wired into ${label}`);

//? The deep-link (fix button lands on the exact tab, not the page default) is consumed by the settings pages.
//? ADR 0312 — the tab IS the URL trail (`useTrailSegment`); the old `settingsFocus` side-channel is gone.
for (const path of ['src/workspaces/workspace/page.tsx', 'src/workspaces/settings/page.tsx', 'src/workspaces/content/settings/page.tsx']) {
  assert(read(path).includes('useTrailSegment'), `${path} consumes the settings deep-link`);
}

/* ------------------------------------------------------------ all four locales carry the setup copy */

const KEYS = ['askCapability'];
const SUBS: Record<string, string[]> = {
  cap: ['workTickets', 'editPipeline', 'workspaceSettings', 'manageMembers', 'manageSprints', 'promoteAdmin', 'demoteAdmin', 'ownerActions'],
  repo: ['title', 'why', 'cta'],
  docker: ['title', 'why', 'hint'],
  media: ['title', 'why', 'cta'],
  ai: ['title', 'why', 'cta', 'hint'],
  publishing: ['title', 'why', 'cta'],
};
for (const lang of ['en', 'nl', 'de', 'fr']) {
  const locale = JSON.parse(read(`src/_locales/${lang}.json`)) as { workspaces: { setup: Record<string, unknown> } };
  const setup = locale.workspaces.setup;
  for (const k of KEYS) assert(typeof setup[k] === 'string' && (setup[k] as string).length > 0, `${lang}: workspaces.setup.${k} is translated`);
  for (const [group, subKeys] of Object.entries(SUBS)) {
    const obj = setup[group] as Record<string, string> | undefined;
    for (const sk of subKeys) assert((obj?.[sk] ?? '').length > 0, `${lang}: workspaces.setup.${group}.${sk} is translated`);
  }
  //? The "ask someone with X" line interpolates the capability name — a single brace renders literally.
  assert((setup.askCapability as string).includes('{{cap}}'), `${lang}: askCapability uses a {{double-brace}} placeholder`);
}

report('setupReadiness');
