# Handover — `feat/ai-libraries-accounts` merged into main (2026-07-09)

> For the next AI working in `C:\code\Workspace` on `main`. This branch (Q→L→M→A: self-aware AIs · design/
> media reference libraries · social-account management) was fast-forwarded into `main` at commit `079f6c8`.
> It also **merged your concurrent main work in** first, so nothing of yours was lost.

## ⚠️ DO THIS FIRST (the schema changed)

Your `node_modules/.prisma` client is now stale. In `C:\code\Workspace`:

```
npm install            # workspace symlinks (ai:capabilities scans node_modules/@luckystack/*)
npm run prisma:generate
npm run generateArtifacts
```

New/changed Prisma models: `StylePreset.previewAssetUrl/previewKind`, **`ReferenceExample`** (new model),
`PublishJob.accountId`, `ContentProject.styleKey`. Until you regenerate, TS + runtime will mismatch.

## Merge resolution you must know about (F1 × A3)

Your **F1 token-refresh** and my **A3 per-account publish routing** were **combined**, not one-or-the-other:

- `server/content/publishOAuth.ts` — `getValidConnection(prisma, ws, platform, opts)` now takes
  `opts.accountId`; it fetches + refreshes + re-saves the token under the **per-account** key. `getConnection`/
  `saveConnection` gained an optional `accountId` (default = the legacy `__publish_<platform>` key; set =
  `__publish_<platform>_<accountId>`).
- `server/content/publish.ts` — `performUpload`/`publishAsset` thread `accountId`; the scheduled-fire path
  passes both `accountId` and `{ ...opts, now }` (your refresh).
- `server/orchestrator/conductor.ts` — `content-request-publish` + the accept path combine **my `accountId`**
  and **your C1 `scheduledAt`** in the publish suggestion patch.
- `server/ai/workspaceChat.ts` — kept BOTH new system-prompt lines (my product-capabilities + your
  time-travel-preview).

Verified after merge: `publishOAuth` 27/27, `publishRouting` 11/11, `scheduledPublish` 9/9 — F1 + A3 work
together. Full unit suite: 0 failures. My integration suite: 75/75. lint 0 · build green · ai:lint 0 blocking.

## What landed (ADRs 0250–0264; full per-commit log: `branch-logs/feat-ai-libraries-accounts.md`)

- **Q — self-aware AIs**: a global product-knowledge RAG corpus (`docs/AI_PRODUCT_KNOWLEDGE.json` from
  `scripts/generateProductKnowledge.mjs` + `docs/product-knowledge/capabilities.md`); `server/rag/
  productKnowledge.ts`; boot-indexed leader-gated in `server/server.ts`; `workspaceChat` injects it; capability
  starter-chips in `_shell/Shell.tsx`.
- **L — design reference library**: `src/workspaces/designer/premades.ts` (8 looks) + `sections/Gallery.tsx`
  (live looping previews + import/copy) + `persisted.ts` (round-trip) — the gallery is the default Designer tab.
- **M — media/video styles**: the KEY fix — `styleKey` now threads through the **video** path
  (`sceneDecompose.ts`); `content-run-pipeline` is reachable via the piece page's **"Generate full video"**
  action + a **Length** picker (`planBeatCount` long-form planner); style preview assets (`StylePreset.
  previewAssetUrl`); piece remembers its style (`ContentProject.styleKey`).
- **A — social accounts**: multi-account re-key (above) + **new ops** `channel-create|edit|delete`,
  `account-disconnect`, `reference-add|delete` (all in `OP_CAPABILITY` + the `contentControl` whitelist +
  `controlApi.ts`); channel-manager + inspiration-library UI in `content/settings/page.tsx`.
- **Grounding (ADR 0264)**: the coding agent's `design-system` context-doc now carries a **named-looks
  catalog** (built-in premades from `docs/AI_DESIGN_PREMADES.json` via `npm run ai:design-premades`, + the
  workspace's saved looks), so "build the dropdown in the Apple style" grounds on the real Apple tokens. Seeded
  on workspace-create + refreshed on every design save/delete. `generateScript` also injects the
  best-practices playbook (`server/rag/contentPlaybook.ts`) + the workspace's inspiration references.

## New commands

- `npm run ai:design-premades` — regenerates `docs/AI_DESIGN_PREMADES.json` from the client premades (run it
  when you change `designer/premades.ts`/`themes.ts`/`styles.ts`).

## Still open (deliberately deferred — user decision)

- **2nd-account OAuth CONNECT flow.** The re-key STORES N accounts per platform and publish ROUTES to a chosen
  one, but the OAuth connect flow still writes only the default key (you can't connect a 2nd account yet).
  Deferred until real OAuth apps are configured (none are; publish is fixtures-only per the user).

## Lessons added

- `docs/lessons/0012-*` (from your side) + note: `prisma:generate` EPERM in a worktree = a lingering node
  process holds `query_engine-windows.dll.node`; kill node procs whose command-line matches the worktree, retry.
