// scripts/generateRunbooks.mjs
//
// Regenerates docs/AI_RUNBOOKS.md — task-shaped "golden path" walkthroughs that
// give a fresh AI session (or a new developer) a ramp INTO this specific
// project, instead of a flat inventory. Where AI_PROJECT_INDEX.md answers
// "what exists", the runbooks answer "to do task T here, copy THIS real file,
// create these files, run this command, verify like this".
//
// Each runbook is grounded in the project's ACTUAL code: the generator scans
// src/ for a representative example of each kind (an authenticated API route, a
// page, a sync pair, a helper, a component) and cites the real file to copy
// from. When the project has no example of a kind yet, it falls back to the
// generic file shape with a clear "(none yet)" note — never a dangling path.
//
// Pure-Node ESM. No framework imports. Deterministic (no timestamps; picks the
// first example in sorted order) so a no-op commit leaves the output identical.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateRunbooks.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "AI_RUNBOOKS.md");

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};
const safeSync = (fn) => {
  try { return [null, fn()]; } catch (error) { return [error, null]; }
};

const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));
const relFromSrc = (abs) => toPosix(path.relative(SRC_DIR, abs));

const walkFiles = async (rootDir, predicate) => {
  const out = [];
  const [statErr, stat] = await safe(fs.stat(rootDir));
  if (statErr || !stat.isDirectory()) return out;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const [readErr, entries] = await safe(fs.readdir(current, { withFileTypes: true }));
    if (readErr) continue;
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile() && predicate(entry.name, abs)) out.push(abs);
    }
  }
  return out.sort();
};

const readTextFile = async (absPath) => {
  const [err, content] = await safe(fs.readFile(absPath, "utf8"));
  return err ? null : content;
};

const isUnderSegment = (abs, segment) => toPosix(abs).includes(`/${segment}/`);

const API_FILE_RE = /^[A-Za-z0-9_-]+_v\d+\.ts$/;
const SYNC_SERVER_FILE_RE = /^[A-Za-z0-9_-]+_server_v\d+\.ts$/;

// ---------------------------------------------------------------------------
// Find one representative real example per task. Deterministic: sorted scan,
// first match wins. Auth-required API is preferred over public for the "add an
// authenticated API" runbook because that's the harder, more instructive path.
// ---------------------------------------------------------------------------

const findExamples = async () => {
  const apiFiles = await walkFiles(SRC_DIR, (name, abs) => isUnderSegment(abs, "_api") && API_FILE_RE.test(name));
  let authedApi = null;
  let anyApi = null;
  for (const abs of apiFiles) {
    if (anyApi === null) anyApi = abs;
    const src = await readTextFile(abs);
    if (src && /export\s+const\s+auth\b[\s\S]*?login\s*:\s*true/.test(src)) { authedApi = abs; break; }
  }
  const pageFiles = await walkFiles(SRC_DIR, (name) => name === "page.tsx");
  const syncFiles = await walkFiles(SRC_DIR, (name, abs) => isUnderSegment(abs, "_sync") && SYNC_SERVER_FILE_RE.test(name));
  const helperFiles = await walkFiles(path.join(SRC_DIR, "_functions"), (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts"));
  const componentFiles = await walkFiles(path.join(SRC_DIR, "_components"), (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"));

  return {
    api: authedApi ?? anyApi,
    apiIsAuthed: authedApi !== null,
    page: pageFiles[0] ?? null,
    sync: syncFiles[0] ?? null,
    helper: helperFiles[0] ?? null,
    component: componentFiles[0] ?? null,
  };
};

// Cite a real example file, or a generic note when the project has none yet.
const cite = (abs, genericShape) =>
  abs ? `copy the existing \`${relFromSrc(abs)}\` as your starting point` : `_(no example in this project yet)_ — create ${genericShape}`;

// ---------------------------------------------------------------------------
// Runbook content. Static task structure (the LuckyStack conventions) grounded
// with the project's real example files.
// ---------------------------------------------------------------------------

const buildDocument = (ex) => {
  const p = [];
  p.push("# Runbooks");
  p.push("");
  p.push("> Auto-generated by `scripts/generateRunbooks.mjs` — regenerate via `npm run ai:runbooks`.");
  p.push("> Hand edits will be overwritten — change the generator instead.");
  p.push(">");
  p.push("> Task-shaped golden paths for THIS project, grounded in its real files. A fresh AI session");
  p.push("> reads this to know *how to do a task here*, not just what exists (that's `docs/AI_PROJECT_INDEX.md`).");
  p.push("> Conventions come from `CLAUDE.md` + the `docs/ARCHITECTURE_*.md` (consumer: `docs/luckystack/`) specs.");
  p.push("");
  p.push("---");
  p.push("");

  // 1. Authenticated API route
  p.push("## Add an API route");
  p.push("");
  p.push(`**Goal:** a new endpoint at \`api/{page}/{name}/v{N}\`, ${ex.apiIsAuthed ? "auth-gated" : "with the auth shape you need"}.`);
  p.push("");
  p.push(`1. ${cite(ex.api, "`src/{page}/_api/{name}_v1.ts`")}.`);
  p.push("2. Create `src/{page}/_api/{name}_v1.ts` exporting `httpMethod`, `rateLimit`, `auth`, `ApiParams`, and `main`.");
  p.push("   - Auth: `export const auth: AuthProps = { login: true, additional: [] };` (or `login: false` for public).");
  p.push("   - In `main`, prefer the injected `functions.tryCatch.tryCatch(...)` over raw try/catch (Rule 21).");
  p.push("3. Regenerate types: `npm run generateArtifacts` (emits the route into `apiTypes.generated.ts`).");
  p.push("4. Scaffold a test: `npm run scaffold:test {page}/{name}/v1`, then fill at least one happy-path case.");
  p.push("5. **Verify:** `npm run lint && npm run build`, then `npm run test`. Call it from the client with");
  p.push("   `apiRequest({ name: '{page}/{name}', version: 'v1', data: {...} })` — typing must resolve with no casts.");
  p.push("");
  p.push("Full spec: `docs/ARCHITECTURE_API.md`. Browse existing routes: `docs/AI_PROJECT_INDEX.md`.");
  p.push("");

  // 2. Page
  p.push("## Add a page");
  p.push("");
  p.push("**Goal:** a new route `/{page}` rendered by `src/{page}/page.tsx`.");
  p.push("");
  p.push(`1. ${cite(ex.page, "`src/{page}/page.tsx`")}.`);
  p.push("2. Create `src/{page}/page.tsx` with a default export component and `export const template = 'plain' | 'dashboard'`.");
  p.push("3. User-facing text MUST go through `useTranslator` (Rule 13) — no hardcoded strings.");
  p.push("4. Colors/classes only from the `@theme` tokens in `src/index.css` (Rule 14) — never arbitrary hex.");
  p.push("5. Reuse `src/_components/` primitives (Dropdown, MenuHandler, Avatar, …) — check the component table in `CLAUDE.md` before building a new one.");
  p.push("6. **Verify:** `npm run lint && npm run build`; load `/{page}` in the dev server.");
  p.push("");
  p.push("Routing rules: `docs/ARCHITECTURE_ROUTING.md`.");
  p.push("");

  // 3. Sync event
  p.push("## Add a real-time sync event");
  p.push("");
  p.push("**Goal:** a room-based realtime event `sync/{page}/{name}/v{N}`.");
  p.push("");
  p.push(`1. ${cite(ex.sync, "`src/{page}/_sync/{name}_server_v1.ts`")}.`);
  p.push("2. Create `_sync/{name}_server_v1.ts` (runs ONCE on the server for validation).");
  p.push("3. Only add `_client_v1.ts` if per-client logic is needed (filtering, per-client auth, custom `clientOutput`). If it would only return `{ status: 'success' }`, do NOT create it.");
  p.push("4. `_client` files receive `token`, not `user` — call `functions.session.getSession(token)` only if needed.");
  p.push("5. `npm run generateArtifacts`, then scaffold + fill a test.");
  p.push("6. **Verify:** client sends `syncRequest({ name, data, receiver: roomCode })` and receives via `upsertSyncEventCallback`.");
  p.push("");
  p.push("Full spec: `docs/ARCHITECTURE_SYNC.md`.");
  p.push("");

  // 4. Helper / component
  p.push("## Add a reusable helper or component");
  p.push("");
  p.push("**Goal:** shared logic in `src/_functions/` or a UI primitive in `src/_components/`.");
  p.push("");
  p.push("1. FIRST check `docs/AI_CAPABILITIES.md` — the helper/component may already exist (Rule 12). Extend it rather than rolling a parallel one.");
  p.push(`2. Helper: ${cite(ex.helper, "`src/_functions/{name}.ts`")}. Component: ${cite(ex.component, "`src/_components/{Name}.tsx`")}.`);
  p.push("3. After adding any new export, run `npm run ai:capabilities` (autonomous) so the snapshot sees it.");
  p.push("4. **Verify:** `npm run lint && npm run build`; the new export shows up in `docs/AI_CAPABILITIES.md`.");
  p.push("");

  // 5. Verify a change
  p.push("## Verify a change before declaring done");
  p.push("");
  p.push("**Goal:** the change is actually correct, per CLAUDE.md Rule 1a (transform the task into a verifiable goal).");
  p.push("");
  p.push("1. `npm run lint && npm run build` — zero warnings, zero errors (Rule 11).");
  p.push("2. `npm run test` — the auto-sweep + your per-route cases. For a bug fix, a regression test must exist and pass.");
  p.push("3. Server-start is a developer action — ask the user to run `npm run server` + `npm run client` for any browser check.");
  p.push("4. Refresh snapshots in-session after structural changes: `npm run ai:project-index` / `npm run ai:capabilities`.");
  p.push("");

  // 6. Record a decision
  p.push("## Record a decision");
  p.push("");
  p.push("**Goal:** capture a durable architecture/policy choice so the whole team + future AI sessions inherit the *why*.");
  p.push("");
  p.push("1. Made a choice with a real rejected alternative? The AI writes a committed ADR in `docs/decisions/NNNN-slug.md` automatically (no command) and regenerates `docs/AI_DECISIONS_INDEX.md` — same habit as a branch-log entry.");
  p.push("2. Keep it distinct from a branch-log entry (what happened) and a CLAUDE.md rule (always-on imperative). Spec: `docs/DECISION_MEMORY_PROTOCOL.md`.");
  p.push("");

  return p.join("\n");
};

const main = async () => {
  const ex = await findExamples();
  const document = buildDocument(ex);

  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) { console.error(`[ai:runbooks] failed to ensure docs directory: ${mkErr.message}`); process.exit(1); }
  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, document, "utf8"));
  if (writeErr) { console.error(`[ai:runbooks] failed to write ${OUTPUT_FILE}: ${writeErr.message}`); process.exit(1); }

  const grounded = ["api", "page", "sync", "helper", "component"].filter((k) => ex[k]).length;
  console.log(`[ai:runbooks] generated ${relFromRepo(OUTPUT_FILE)} (${grounded}/5 runbooks grounded in real examples)`);
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:runbooks] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
