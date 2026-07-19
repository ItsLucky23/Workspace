//? GAP_SCAN surfacing round — proves the five engine-only modules are now REACHABLE by a user, not just
//? implemented. This test exists because the previous round shipped correct, tested engines that nothing
//? called: a module with no caller is not a delivered feature, and only a wiring assertion catches that.
//?
//? Each check names the path a real user takes. Where a route/op is involved the op registration is
//? asserted too, so a half-wired op (UI button → op that no map knows) fails here rather than in someone's
//? face.

import { readFileSync, existsSync } from 'node:fs';

import { PROPOSE_CATALOG } from '../../server/ai/opCatalog.ts';
import { CHAT_ENABLED_OPS } from '../../src/workspaces/_data/chatOps.ts';
import { CHAT_DISPATCH } from '../../src/workspaces/_functions/chatDispatch.ts';
import { OP_CAPABILITY } from '../../server/control/rbac.ts';
import { parseCaptionStyle } from '../../server/content/captionStyle.ts';
import { assert, eq, report } from '../_helpers.mts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const locales = ['en', 'nl', 'de', 'fr'] as const;

//? Every user-facing string must exist in ALL four locales — a missing key renders as the raw key, which
//? is exactly the regression the last browser pass caught.
const hasKey = (path: string[]): boolean => locales.every((lang) => {
  const raw: unknown = JSON.parse(read(`src/_locales/${lang}.json`));
  let node: unknown = raw;
  for (const part of path) {
    if (node === null || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' && node.length > 0;
});

/* ------------------------------------------------------------ F2: caption styling reaches ffmpeg */

const assembly = read('server/content/assembly.ts');
assert(assembly.includes('parseCaptionStyle'), 'the render pipeline reads the piece\'s caption style');
assert(assembly.includes('buildWordCues'), 'and can build word-by-word cues');
assert(assembly.includes('style: captionStyleCfg'), 'the style is handed to the caption pass');
const renderSrc = read('server/content/render.ts');
assert(renderSrc.includes('buildStyledCaptionArgs'), 'applyCaptions can emit the STYLED ffmpeg args');
assert(renderSrc.includes("mode === 'burn' && opts.style"), 'styling only applies to a burn-in (a soft track is player-styled)');

const pieceUi = read('src/workspaces/content/[pieceId]/page.tsx');
assert(pieceUi.includes('payload.captionStyle'), 'the piece UI sends a caption style with the pipeline run');
assert(pieceUi.includes('ccWordByWord'), 'including the word-by-word toggle');
assert(hasKey(['workspaces', 'content', 'captionStyleTitle']), 'the caption-style panel is translated everywhere');

//? The stored blob is validated, so a hand-edited or stale value cannot reach ffmpeg as junk.
eq(parseCaptionStyle(null), null, 'no style stored → the plain ffmpeg default (pre-F2 behaviour)');
eq(parseCaptionStyle({ fontSize: 900 }), null, 'an out-of-range size is dropped, not clamped silently');
eq(parseCaptionStyle({ color: 'nothex' }), null, 'a malformed colour is dropped');
eq(parseCaptionStyle({ fontSize: 30, wordByWord: true })?.wordByWord, true, 'a valid style survives');
eq(parseCaptionStyle({ color: '#FFAA00' })?.color, 'FFAA00', 'a leading # is accepted and stripped');

/* ------------------------------------------------------------ F3: SEO panel */

assert(existsSync(new URL('../../src/workspaces/_api/seoSuggest_v1.ts', import.meta.url)), 'the SEO route exists');
const seoRoute = read('src/workspaces/_api/seoSuggest_v1.ts');
assert(seoRoute.includes('hasCapability'), 'the SEO route is capability-gated');
assert(seoRoute.includes('aiOk'), 'and reports whether the AI half worked, so the score still stands alone');
assert(pieceUi.includes("name: 'workspaces/seoSuggest'"), 'the piece UI calls it');
assert(hasKey(['workspaces', 'content', 'seoTitle']), 'the SEO panel is translated everywhere');
assert(hasKey(['workspaces', 'content', 'seo.noHook']), 'every issue code has a human sentence');

/* ------------------------------------------------------------ F5: reply from the inbox */

assert(existsSync(new URL('../../src/workspaces/_api/commentReplyDraft_v1.ts', import.meta.url)), 'the reply-draft route exists');
const inbox = read('src/workspaces/content/page.tsx');
assert(inbox.includes("name: 'workspaces/commentReplyDraft'"), 'the inbox can ask for an AI draft');
assert(inbox.includes('replyToComment('), 'and can send the approved reply');
//? The B-23 property: drafting and sending are SEPARATE, so an AI draft cannot reach an audience by itself.
assert(inbox.includes('sendReply') && inbox.includes('draftReplyFor'), 'drafting and sending are distinct actions');
assert(!inbox.includes('.then(() => { sendReply'), 'a draft never auto-sends');
eq(OP_CAPABILITY['content-reply-comment'] === undefined, false, 'the reply op is RBAC-mapped');
assert(hasKey(['workspaces', 'comments', 'reply']), 'the reply UI is translated everywhere');

/* ------------------------------------------------------------ G4: the shared asset picker */

assert(existsSync(new URL('../../src/workspaces/_components/AssetPicker.tsx', import.meta.url)), 'the shared picker exists');
const picker = read('src/workspaces/_components/AssetPicker.tsx');
assert(!picker.includes("from '../_shell/WorkspacesContext'"), 'the picker IMPORTS no workspace context, so it works inside a menuHandler overlay (lesson 0011)');
assert(picker.includes('backendUrl'), 'and resolves /media against the BACKEND origin');
const docUi = read('src/workspaces/content/documents/[docId]/page.tsx');
assert(docUi.includes('AssetPicker'), 'documents use the shared picker');
assert(docUi.includes('contentSnapshot.assetLibrary'), 'fed by the workspace-wide library, not a per-piece scrape');
assert(!docUi.includes('contentSnapshot.pieces'), 'the old ad-hoc derivation is gone');
assert(docUi.includes('setAssetStarred'), 'and the library can be curated from where it is used');
eq(OP_CAPABILITY['asset-star'] === undefined, false, 'the star op is RBAC-mapped');

/* ------------------------------------------------------------ G7: experiments in settings */

assert(existsSync(new URL('../../src/workspaces/_api/promptExperiments_v1.ts', import.meta.url)), 'the experiments route exists');
const settings = read('src/workspaces/settings/page.tsx');
assert(settings.includes('ExperimentsPanel'), 'settings render the experiments panel');
assert(settings.includes('savePromptExperiment'), 'a user can start an experiment');
assert(settings.includes('stopPromptExperiment'), 'and stop one');
assert(settings.includes('row.verdict'), 'the panel shows the VERDICT (including "not enough data")');
for (const op of ['prompt-experiment-save', 'prompt-experiment-stop'] as const) {
  eq(OP_CAPABILITY[op] === undefined, false, `${op} is RBAC-mapped`);
}
assert(hasKey(['workspaces', 'experiments', 'title']), 'the experiments panel is translated everywhere');

/* ------------------------------------------------------------ F1 + G3: the two ops that had no button */

assert(pieceUi.includes("'content-gen-thumbnail'"), 'the piece UI can compose a thumbnail');
assert(pieceUi.includes('confirmPaid'), 'and cost-confirms the paid (AI-background) variant');
assert(hasKey(['workspaces', 'content', 'thumbTitle']), 'the thumbnail panel is translated everywhere');

const studio = read('src/workspaces/content/studio/page.tsx');
assert(studio.includes("'studio-publish-site'"), 'studio can publish a page live');
assert(studio.includes("a.kind === 'landing' && a.status === 'ready'"), 'only a READY landing page offers it');
assert(hasKey(['workspaces', 'studio', 'publishLive']), 'the publish button is translated everywhere');

/* ------------------------------------------------------------ Workspace-AI reachability */

//? The other half of "a user can reach it": the ASSISTANT. Every op this program added is either
//? chat-proposable (catalog `enabled` + client twin + a dispatcher) or excluded for a stated invariant
//? reason. A `later` op would mean "silently unreachable from chat", which is what this pins down.
const CHAT_REACHABLE = [
  'env-rollback', 'document-archive', 'document-unarchive', 'content-gen-thumbnail',
  'content-reply-comment', 'studio-publish-site', 'studio-unpublish-site', 'asset-star',
  'prompt-experiment-save', 'prompt-experiment-stop', 'ai-skill-save', 'ai-skill-toggle', 'ai-skill-reset',
] as const;

const dispatchable = new Set(Object.keys(CHAT_DISPATCH));
for (const op of CHAT_REACHABLE) {
  eq(PROPOSE_CATALOG[op].mode, 'enabled', `${op} is proposable by the Workspace-AI`);
  assert((CHAT_ENABLED_OPS as readonly string[]).includes(op), `${op} is in the client twin`);
  assert(dispatchable.has(op), `${op} has a client dispatcher (an enabled op with no dispatcher is a dead accept)`);
  assert((PROPOSE_CATALOG[op].hint ?? '').length > 0, `${op} tells the model how to call it`);
}

//? Two ops stay OUT of chat on purpose, and the reason is an invariant rather than taste:
//?   • platform credentials are secrets — invariant: secret-bearing ops never flow through the LLM;
//?   • cloning creates a SECOND workspace — invariant #4: the Assistant is scoped to ITS workspace.
eq(PROPOSE_CATALOG['save-platform-credentials'].mode, 'excluded', 'secret-bearing ops never reach the chat surface');
eq(PROPOSE_CATALOG['clone-workspace'].mode, 'excluded', 'cross-workspace creation stays out of a workspace-scoped assistant');

//? Posting publicly / taking a page offline carry the extra accept-confirm.
for (const op of ['content-reply-comment', 'studio-unpublish-site'] as const) {
  eq(PROPOSE_CATALOG[op].destructive, true, `${op} requires an explicit confirm on accept`);
}

report('surfaceReachability');
