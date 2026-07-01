// scripts/generateProductOverview.mjs
//
// Regenerates docs/AI_PRODUCT_OVERVIEW.md — the INTENT layer: what this app does
// in plain language and what each page is FOR, so an AI (and a future teammate)
// has the product "why we built this", not just the code structure. The other
// indexes answer "what exists"; this one answers "what is it for".
//
// Two sources, one aggregate:
//   - docs/PRODUCT.md        — app-level plain-language description (hand- /
//                              AI-maintained; the AI keeps it current + backfills
//                              it on an existing repo, like the decision log).
//   - `//? intent: <text>`   — a one-line plain-language purpose at the top of
//                              each src/<area>/page.tsx (co-located with the page).
//   -> docs/AI_PRODUCT_OVERVIEW.md (generated, read-only): the app description +
//      a per-area table of page intents.
//
// Folder-aware + sharding-toggle-aware (luckystack.ai.json `docs.sharding`):
// 'single' = one file; 'per-folder' = per-area files + a thin root overview;
// 'auto' (default) = single until a top-folder exceeds shardThreshold pages.
// The graph + MCP server are unaffected (queried, not read whole).
//
// Pure-Node ESM, deterministic (no timestamps).
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateProductOverview.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const ROOT_OUTPUT = path.join(DOCS_DIR, "AI_PRODUCT_OVERVIEW.md");
const SHARD_DIR = path.join(DOCS_DIR, "ai-product"); // per-area files when sharded

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};
const safeSync = (fn) => {
  try { return [null, fn()]; } catch (error) { return [error, null]; }
};

const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));
const relFromSrc = (abs) => toPosix(path.relative(SRC_DIR, abs));

const readTextFile = async (absPath) => {
  const [err, content] = await safe(fs.readFile(absPath, "utf8"));
  return err ? null : content;
};

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
      else if (entry.isFile() && predicate(entry.name)) out.push(abs);
    }
  }
  return out.sort();
};

// ---------------------------------------------------------------------------
// Config (shared sharding toggle)
// ---------------------------------------------------------------------------

const loadAiConfig = async () => {
  const text = await readTextFile(path.join(REPO_ROOT, "luckystack.ai.json"));
  const fallback = { sharding: "auto", shardThreshold: 150 };
  if (text === null) return fallback;
  const [err, parsed] = safeSync(() => JSON.parse(text));
  if (err || !parsed || typeof parsed.docs !== "object") return fallback;
  return {
    sharding: ["auto", "single", "per-folder"].includes(parsed.docs.sharding) ? parsed.docs.sharding : "auto",
    shardThreshold: Number.isInteger(parsed.docs.shardThreshold) ? parsed.docs.shardThreshold : 150,
  };
};

// ---------------------------------------------------------------------------
// Scan pages → { route, area, intent }
// ---------------------------------------------------------------------------

const extractIntent = (src) => {
  const lines = src.split(/\r?\n/).slice(0, 30);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\/\/\??\s*intent:\s*(.+?)\s*$/i);
    if (!m) continue;
    //? Greedily consume subsequent `//?`/`//` continuation lines so a wrapped
    //? multi-line `//? intent:` isn't truncated to its first line. Stop at the
    //? first line that isn't a comment or that starts a new `key:` directive.
    const parts = [m[1].trim()];
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j].match(/^\s*\/\/\??\s*(.+?)\s*$/);
      if (!cont) break;
      if (/^\s*[A-Za-z][\w-]*:\s/.test(cont[1])) break;
      parts.push(cont[1].trim());
    }
    return parts.join(" ").trim();
  }
  return null;
};

const areaOf = (folderRel) => {
  if (folderRel === ".") return "(root)";
  const seg = folderRel.split("/").find((s) => !s.startsWith("_"));
  return seg ?? "(root)";
};

const scanPages = async () => {
  const files = await walkFiles(SRC_DIR, (name) => name === "page.tsx");
  const rows = [];
  for (const abs of files) {
    const src = await readTextFile(abs);
    if (src === null) continue;
    const rel = relFromSrc(abs);
    const folder = path.posix.dirname(toPosix(rel));
    const segments = folder === "." ? [] : folder.split("/").filter((s) => !s.startsWith("_"));
    rows.push({
      route: segments.length === 0 ? "/" : `/${segments.join("/")}`,
      area: areaOf(folder),
      file: rel,
      intent: extractIntent(src),
    });
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const escapeCell = (v) => String(v ?? "").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ").trim();

const pagesTable = (rows) => {
  if (rows.length === 0) return "_(no pages yet)_";
  const out = ["| Route | Purpose (plain language) | File |", "| --- | --- | --- |"];
  for (const r of rows) {
    out.push(`| \`${escapeCell(r.route)}\` | ${r.intent ? escapeCell(r.intent) : "_(no intent set — add a `//? intent: …` line atop page.tsx)_"} | \`${escapeCell(r.file)}\` |`);
  }
  return out.join("\n");
};

const header = (extra) => [
  "# Product Overview",
  "",
  "> Auto-generated by `scripts/generateProductOverview.mjs` — regenerate via `npm run ai:product`.",
  "> Hand edits will be overwritten. App-level text comes from `docs/PRODUCT.md`; each page's purpose",
  "> comes from a `//? intent: …` line at the top of its `page.tsx`. This is the INTENT layer — *what",
  "> the app is for*, in plain language — distinct from the structural indexes (*what exists*).",
  ...(extra ? ["", extra] : []),
  "",
].join("\n");

const appSection = (productMd) => {
  if (productMd === null) {
    return [
      "## What this app is",
      "",
      "_(no `docs/PRODUCT.md` yet — the AI maintains it: a plain-language description of what this app",
      "does, for whom, and its key features. On an existing repo the AI offers to backfill it. See CLAUDE.md.)_",
    ].join("\n");
  }
  // Strip a leading H1 + the maintainer blockquote note so only the product
  // content nests in.
  const lines = productMd.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i].trim() === "" || /^#\s+/.test(lines[i]) || lines[i].trimStart().startsWith(">"))) i++;
  const body = lines.slice(i).join("\n").trim();
  return `## What this app is\n\n${body}`;
};

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const writeFileSafe = async (absPath, content) => {
  const [mkErr] = await safe(fs.mkdir(path.dirname(absPath), { recursive: true }));
  if (mkErr) { console.error(`[ai:product] mkdir failed: ${mkErr.message}`); process.exit(1); }
  const [wErr] = await safe(fs.writeFile(absPath, content, "utf8"));
  if (wErr) { console.error(`[ai:product] write failed for ${absPath}: ${wErr.message}`); process.exit(1); }
};

const main = async () => {
  const config = await loadAiConfig();
  const productMd = await readTextFile(path.join(DOCS_DIR, "PRODUCT.md"));
  const pages = await scanPages();

  const byArea = new Map();
  for (const p of pages) {
    if (!byArea.has(p.area)) byArea.set(p.area, []);
    byArea.get(p.area).push(p);
  }
  const areas = [...byArea.keys()].sort();
  const maxAreaSize = areas.reduce((m, a) => Math.max(m, byArea.get(a).length), 0);
  const perFolder = config.sharding === "per-folder" || (config.sharding === "auto" && maxAreaSize > config.shardThreshold);

  if (!perFolder) {
    const parts = [header(null), appSection(productMd), "", `## Pages by area (${pages.length})`, ""];
    for (const area of areas) {
      parts.push(`### ${area}`, "", pagesTable(byArea.get(area)), "");
    }
    if (areas.length === 0) parts.push(pagesTable([]), "");
    await writeFileSafe(ROOT_OUTPUT, parts.join("\n"));
    // Remove any stale shard dir from a previous per-folder run.
    await safe(fs.rm(SHARD_DIR, { recursive: true, force: true }));
    console.log(`[ai:product] generated ${relFromRepo(ROOT_OUTPUT)} (single file, ${pages.length} pages across ${areas.length} areas)`);
    return;
  }

  // Sharded: one file per area + a thin root overview linking them.
  //? Clear the shard dir first so a renamed/deleted area's shard from a
  //? previous run doesn't linger forever (the single-file branch already
  //? does this on its own exit path).
  await safe(fs.rm(SHARD_DIR, { recursive: true, force: true }));
  for (const area of areas) {
    const slug = area.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
    const body = [
      `# Product Overview — ${area}`,
      "",
      "> Auto-generated shard of `docs/AI_PRODUCT_OVERVIEW.md` (per-area; `docs.sharding`).",
      "",
      pagesTable(byArea.get(area)),
      "",
    ].join("\n");
    await writeFileSafe(path.join(SHARD_DIR, `${slug}.md`), body);
  }
  const rootParts = [
    header("> Sharded per area (`docs.sharding`): per-area page intents live in `docs/ai-product/<area>.md`."),
    appSection(productMd),
    "",
    `## Areas (${areas.length})`,
    "",
    "| Area | Pages | Detail |",
    "| --- | --- | --- |",
  ];
  for (const area of areas) {
    const slug = area.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
    rootParts.push(`| ${escapeCell(area)} | ${byArea.get(area).length} | \`docs/ai-product/${slug}.md\` |`);
  }
  rootParts.push("");
  await writeFileSafe(ROOT_OUTPUT, rootParts.join("\n"));
  console.log(`[ai:product] generated ${relFromRepo(ROOT_OUTPUT)} + ${areas.length} per-area shard(s) in docs/ai-product/ (${pages.length} pages)`);
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:product] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
