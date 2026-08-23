//? F29 · F28 · F27 · F45 — four gaps that share one shape: state was STORED and faithfully round-tripped
//? to the UI, and then consumed by nothing. Each assertion below targets the consumption, because the
//? storage always worked — that is exactly why these survived so long.
//?
//?   F29 — `hooks`, `processes` and `visibleStageIds` were configurable per stage and read by no runtime
//?          path. Two of them rendered UI (hook toggles, terminal tabs) that did nothing.
//?   F28 — `Service.path` promised independently deployable monorepo units; every exec ran at the repo root.
//?   F27 — deploy history was recorded from day one and had no read surface.
//?   F45 — an approve was fire-and-forget: no pending state, no error, and a double-tap sent two answers.

import { readFileSync } from 'node:fs';

import { assert, eq, report } from '../_helpers.mts';
import { serviceWorkdir, workdirOrRoot } from '../../server/deploy/servicePath.ts';
import { renderStage } from '../../server/orchestrator/renderStage.ts';
import { HOOK_CATALOG } from '../../src/workspaces/_data/catalogs.ts';
import { STAGE_CONFIGS } from '../../src/workspaces/_data/seed.ts';
import type { PipelineStageCfg } from '../../src/workspaces/_data/types.ts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------ F28: Service.path */

eq(serviceWorkdir('apps/web').ok && serviceWorkdir('apps/web').dir, '/work/apps/web', 'a service path becomes a container workdir');
eq(workdirOrRoot('.'), '/work', 'the default path is the repo root, not an error');
eq(workdirOrRoot(null), '/work', 'and so is no path at all');
eq(workdirOrRoot(''), '/work', 'or an empty one');
eq(workdirOrRoot('apps\\web'), '/work/apps/web', 'backslashes are accepted as separators');
eq(workdirOrRoot('./apps//web/'), '/work/apps/web', 'redundant separators collapse');

//? The path is user input that becomes a container path — every escape must be refused, and refusal must
//? fall back to the repo root rather than to whatever the attacker aimed at.
for (const evil of ['../../etc', '/etc/passwd', 'C:/Windows', 'apps/../../root', 'apps/x:y']) {
  eq(serviceWorkdir(evil).ok, false, `'${evil}' is refused`);
  eq(workdirOrRoot(evil), '/work', `'${evil}' falls back to the repo root`);
}

//? The consumption site: the serve command must run in the SERVICE's directory, not at /work.
const environment = read('server/deploy/environment.ts');
assert(environment.includes('const serveDir = workdirOrRoot(service?.path)'), 'the deploy resolves a per-service workdir');
assert(environment.includes("'exec', '-d', '-w', serveDir,"), 'and the serve command actually uses it');
assert(environment.includes('prodCommand: true, path: true'), 'and path is selected — it was not even fetched before');

/* ------------------------------------------------------------ F29: hooks are honoured */

//? Build on a REAL seeded stage rather than a hand-rolled literal: renderStage reads a dozen fields, and a
//? partial fake would test the test's imagination instead of the engine.
const seededStage = STAGE_CONFIGS.find((stage) => stage.id === 'implement') ?? STAGE_CONFIGS[0];
if (!seededStage) throw new Error('no seeded stage to test against');
const baseCfg = (hooks: Record<string, boolean>): PipelineStageCfg => ({ ...seededStage, hooks });

const ctx = { ticketId: 'DEV-1', carryOver: null, contextDocs: [], retrieved: [] };

//? Default (nothing disabled): all three hooks the container can emit are present.
const allOn = renderStage(baseCfg({ PostToolUse: true, PreCompact: true, Stop: true }), ctx);
assert(allOn.settingsJson.includes('"Stop"'), 'the Stop hook is emitted');
assert(allOn.settingsJson.includes('"PostToolUse"'), 'the PostToolUse hook is emitted');
assert(allOn.settingsJson.includes('"PreCompact"'), 'the PreCompact hook is emitted');

//? Turning one OFF must actually remove it — this is the bit that did nothing before.
const toolUseOff = renderStage(baseCfg({ PostToolUse: false }), ctx);
assert(!toolUseOff.settingsJson.includes('"PostToolUse"'), 'disabling PostToolUse removes it from the container settings');
assert(toolUseOff.settingsJson.includes('"Stop"'), 'but Stop survives — the engine detects a finished turn through it');

const preCompactOff = renderStage(baseCfg({ PreCompact: false }), ctx);
assert(!preCompactOff.settingsJson.includes('"PreCompact"'), 'disabling PreCompact removes it');

//? Stop is not switchable, and the catalog says so rather than offering a switch that refuses.
const stopOff = renderStage(baseCfg({ Stop: false }), ctx);
assert(stopOff.settingsJson.includes('"Stop"'), 'Stop cannot be switched off — a stage without it would hang forever');

//? The catalog must describe only hooks that EXIST. It used to advertise nine, of which six had no
//? emitter anywhere: six toggles that silently did nothing.
const renderStageSource = read('server/orchestrator/renderStage.ts');
eq(HOOK_CATALOG.length, 3, 'the catalog lists exactly the hooks the container emits');
for (const hook of HOOK_CATALOG) {
  assert(renderStageSource.includes(`${hook.key}:`), `the catalog's '${hook.key}' has a real emitter`);
}
eq(HOOK_CATALOG.filter((h) => h.required === true).map((h) => h.key).join(','), 'Stop', 'Stop is the one marked required');

/* ------------------------------------------------------------ F29: processes + visibility are consumed */

const runner = read('server/orchestrator/stageRunner.ts');
assert(runner.includes('await startStageProcesses(container.name, cfg.processes)'), 'the stage actually starts its declared processes');
//? ADR 0317 — the one shared implementation lives in server/container/runtimeProcesses.ts (stage + project).
const runtimeProcesses = read('server/container/runtimeProcesses.ts');
assert(runtimeProcesses.includes("'exec', '-d'"), 'detached, so a dev server keeps running through the turn');
assert(runtimeProcesses.includes('quoteForShell'), 'and the cwd/env values are quoted rather than interpolated raw');

assert(runner.includes('cfg.visibleStageIds.filter((id) => id !== stageKey)'), 'visibleStageIds is read');
assert(runner.includes('toStageId: { in: visibleIds }'), 'and widens which stage outputs this stage can see');
assert(runner.includes('...visibleDocs,'), 'and those outputs reach the rendered context');

/* ------------------------------------------------------------ F27: deploy history has a read surface */

const snapshot = read('server/read/workspaceSnapshot.ts');
assert(snapshot.includes('deployHistoryRows'), 'the snapshot reads the deploy history');
assert(snapshot.includes('take: 120'), 'bounded, so a long-lived project cannot grow the snapshot without limit');
const types = read('src/workspaces/_data/types.ts');
assert(types.includes('deploys?: { id: string; commit: string'), 'the environment summary carries its deploys');
const settings = read('src/workspaces/settings/page.tsx');
assert(settings.includes('DeployHistoryFold'), 'and the UI renders them');
assert(settings.includes("'workspaces.deployHistory.current'"), 'naming which one is live — otherwise the list means nothing');

/* ------------------------------------------------------------ F45: the write ACK */

const provider = read('src/workspaces/_shell/WorkspacesProvider.tsx');
//? The id keys on the QUESTION, not just the ticket: keying on the ticket alone swallowed the NEXT
//? question's answer as a replay of the previous one (caught in the browser, see answerInbox.test.mts).
assert(provider.includes('const reqId = `answer:${key}:${shortHash(askedNow)}`'), 'the answer request id is derived from the question being answered, so a double-tap dedupes but a new question does not');
assert(!provider.includes('const reqId = nextReqId();\n        const send = () => { void syncRequest({ name: \'workspaces/answerInput\''), 'the old random-id fire-and-forget path is gone');
assert(provider.includes('setPendingAnswers'), 'a pending state exists');
assert(provider.includes('notify.error({ key: response.errorCode })'), 'and a refused answer is surfaced instead of vanishing');

//? The release must happen on the ticket DELTA, not on the socket reply: the Conductor accepting the op is
//? not the same as the answer having taken effect, and un-dimming early is what made this look broken.
const ackBlock = provider.slice(provider.indexOf("name: 'workspaces/answerInput'"), provider.indexOf("name: 'workspaces/answerInput'") + 900);
assert(ackBlock.includes('setPendingAnswers'), 'the pending flag clears when the updated ticket arrives');

const board = read('src/workspaces/develop/board/[ticketId]/page.tsx');
assert(board.includes('const pending = isAnswerPending(ticketKey)'), 'the banner knows whether its answer is in flight');
assert(board.includes("icon={pending ? 'spinner' : 'check'}"), 'approve shows a spinner while it waits');
assert(board.includes('disabled={pending}'), 'and cannot be clicked twice');
assert(board.includes('isAnswerPending(ticketKey, a.index)'), 'advisories track pending PER advisory — confirming one must not lock the others');

report('stageConfigAndService');
