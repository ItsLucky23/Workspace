// scripts/generateContextBudget.mjs
//
// Regenerates docs/AI_CONTEXT_BUDGET.md — the machine-measured "what to load
// when" map for a session. CLAUDE.md Rule 28 lists ~10 docs to read at session
// start regardless of the task; a typo fix and a security audit need different
// context. This generator (a) MEASURES the actual token cost of every committed
// AI artifact, and (b) emits per-task retrieval PROFILES that say "load these,
// query the rest via the @luckystack/mcp tools" — making the MCP-first strategy
// explicit instead of prose.
//
// Profiles are built-in defaults, overridable via luckystack.ai.json
// `context.profiles`. Token estimate = bytes / 4 (a deliberate, stable proxy —
// good enough to rank artifacts and budget a session; not a tokenizer).
//
// Pure-Node ESM. Deterministic (sizes are content-derived, no timestamps).
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateContextBudget.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const AI_CONFIG = path.join(REPO_ROOT, "luckystack.ai.json");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "AI_CONTEXT_BUDGET.md");

const safe = async (promise) => { try { return [null, await promise]; } catch (e) { return [e, null]; } };
const safeSync = (fn) => { try { return [null, fn()]; } catch (e) { return [e, null]; } };
const toPosix = (p) => p.replaceAll("\\", "/");

// Artifacts an agent might load whole. Each has a stable id used by profiles.
const ARTIFACTS = [
  { id: "contract", path: "CLAUDE.md", note: "Always-on rules (read every session)." },
  { id: "quick-index", path: "docs/AI_QUICK_INDEX.md", note: "Framework surfaces + package map." },
  { id: "capabilities", path: "docs/AI_CAPABILITIES.md", note: "Existing helpers/exports — check before authoring." },
  { id: "project-index", path: "docs/AI_PROJECT_INDEX.md", note: "Routes/pages/helpers/components + test coverage." },
  { id: "decisions", path: "docs/AI_DECISIONS_INDEX.md", note: "Why-it-is-this-way (ADRs)." },
  { id: "lessons", path: "docs/AI_LESSONS_INDEX.md", note: "Known pitfalls (what failed)." },
  { id: "runbooks", path: "docs/AI_RUNBOOKS.md", note: "Task-shaped golden paths." },
  { id: "examples", path: "docs/AI_EXAMPLES_INDEX.md", note: "Canonical example corpus index." },
  { id: "product", path: "docs/AI_PRODUCT_OVERVIEW.md", note: "What the app + each page is FOR." },
  { id: "graph", path: "docs/ai-graph.json", note: "Dependency graph — prefer the MCP tools over reading whole." },
];

// Built-in per-task profiles. Each: which artifact ids to LOAD, and which MCP
// tools to QUERY for the rest instead of reading a whole index.
const DEFAULT_PROFILES = {
  "new-route": {
    load: ["contract", "capabilities", "examples", "runbooks"],
    query: ["find_route", "get_capability", "get_example('auth-api-route')", "blast_radius"],
    note: "Adding an API/sync route: reuse before authoring, copy the canonical shape.",
  },
  "new-page": {
    load: ["contract", "project-index", "examples", "product"],
    query: ["get_example('page-protected')", "get_capability", "find_route"],
    note: "Adding a page: match an existing template/component + state the intent.",
  },
  "security-audit": {
    load: ["contract", "decisions", "project-index"],
    query: ["god_nodes", "blast_radius", "get_decision", "list_decisions('security')"],
    note: "Auditing: lean on the why-record + risky hubs, not every page intent.",
  },
  "debug": {
    load: ["contract", "lessons"],
    query: ["find_lesson", "who_calls", "who_imports", "blast_radius"],
    note: "Chasing a bug: check known pitfalls first, then trace impact via the graph.",
  },
  "doc-fix": {
    load: ["contract"],
    query: ["get_runbook", "graph_status"],
    note: "Doc-only change: minimal context; the indexes regenerate themselves.",
  },
};

const loadProfiles = async () => {
  const [err, raw] = await safe(fs.readFile(AI_CONFIG, "utf8"));
  if (err) return DEFAULT_PROFILES;
  const [, parsed] = safeSync(() => JSON.parse(raw));
  const override = parsed?.context?.profiles;
  return override && typeof override === "object" ? override : DEFAULT_PROFILES;
};

const estTokens = (bytes) => Math.round(bytes / 4);
const fmt = (n) => n.toLocaleString("en-US");

const measure = async () => {
  const rows = [];
  for (const a of ARTIFACTS) {
    const [, stat] = await safe(fs.stat(path.join(REPO_ROOT, a.path)));
    rows.push({ ...a, bytes: stat ? stat.size : null });
  }
  return rows;
};

const renderTable = (header, rows) => {
  const out = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of rows) out.push(`| ${row.join(" | ")} |`);
  return out.join("\n");
};

const buildDocument = (sizes, profiles) => {
  const byId = new Map(sizes.map((s) => [s.id, s]));
  const total = sizes.reduce((n, s) => n + (s.bytes ?? 0), 0);
  const parts = [];
  parts.push("# Context Budget");
  parts.push("");
  parts.push("> Auto-generated by `scripts/generateContextBudget.mjs` — regenerate via `npm run ai:context-budget`.");
  parts.push("> Token estimate = bytes / 4 (a stable proxy to RANK + budget, not a tokenizer).");
  parts.push(">");
  parts.push("> Don't read every index every session. Pick the profile matching your task, LOAD only its");
  parts.push("> artifacts, and QUERY the rest via the `@luckystack/mcp` tools instead of reading whole files.");
  parts.push("");
  parts.push(`## Artifact sizes (total ≈ ${fmt(estTokens(total))} tokens if all loaded)`);
  parts.push("");
  parts.push(renderTable(
    ["Artifact", "Est. tokens", "Bytes", "Purpose"],
    sizes.map((s) => [
      `\`${s.id}\` — \`${s.path}\``,
      s.bytes === null ? "_(absent)_" : fmt(estTokens(s.bytes)),
      s.bytes === null ? "—" : fmt(s.bytes),
      s.note,
    ]),
  ));
  parts.push("");
  parts.push("## Retrieval profiles");
  parts.push("");
  parts.push("Per task type: the minimal artifact set to load + the MCP tools to query for everything else.");
  parts.push("");
  for (const [task, prof] of Object.entries(profiles)) {
    const load = Array.isArray(prof.load) ? prof.load : [];
    const query = Array.isArray(prof.query) ? prof.query : [];
    const loadTokens = load.reduce((n, id) => n + estTokens(byId.get(id)?.bytes ?? 0), 0);
    parts.push(`### \`${task}\``);
    parts.push("");
    if (prof.note) { parts.push(`_${prof.note}_`); parts.push(""); }
    parts.push(`- **Load** (≈ ${fmt(loadTokens)} tokens): ${load.length ? load.map((id) => `\`${id}\``).join(", ") : "_(none)_"}`);
    parts.push(`- **Query via MCP** (don't read whole): ${query.length ? query.map((q) => `\`${q}\``).join(", ") : "_(none)_"}`);
    parts.push("");
  }
  return parts.join("\n");
};

const main = async () => {
  const [sizes, profiles] = [await measure(), await loadProfiles()];
  const document = buildDocument(sizes, profiles);
  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) { console.error(`[ai:context-budget] failed to ensure docs directory: ${mkErr.message}`); process.exit(1); }
  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, document, "utf8"));
  if (writeErr) { console.error(`[ai:context-budget] failed to write ${OUTPUT_FILE}: ${writeErr.message}`); process.exit(1); }
  console.log(`[ai:context-budget] generated ${toPosix(path.relative(REPO_ROOT, OUTPUT_FILE))} (${sizes.length} artifacts, ${Object.keys(profiles).length} profiles)`);
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:context-budget] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
