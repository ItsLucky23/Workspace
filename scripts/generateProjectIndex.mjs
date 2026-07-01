// scripts/generateProjectIndex.mjs
//
// Regenerates docs/AI_PROJECT_INDEX.md — the AI's structural map of the
// CONSUMER's own project code. Distinct from AI_QUICK_INDEX.md (framework
// surfaces) and AI_CAPABILITIES.md (installed packages + flat exports):
// this index covers routes, pages, helpers, components AND the cross-
// references between them, so AI agents can answer "what calls this?" /
// "which routes touch this helper?" without re-walking src/ each session.
//
// Pure-Node ESM. No framework imports — runs in pre-commit context before
// any TS build step. Inline safe/safeSync helpers mirror the pattern from
// generateAiCapabilities.mjs / generateAiIndex.mjs.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateProjectIndex.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "AI_PROJECT_INDEX.md");

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};

const safeSync = (fn) => {
  try { return [null, fn()]; } catch (error) { return [error, null]; }
};

// ---------------------------------------------------------------------------
// Tiny IO helpers
// ---------------------------------------------------------------------------

const readTextFile = async (absPath) => {
  const [err, content] = await safe(fs.readFile(absPath, "utf8"));
  if (err) return null;
  return content;
};

const fileExists = async (absPath) => {
  const [err] = await safe(fs.access(absPath));
  return err === null;
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
      else if (entry.isFile() && predicate(entry.name, abs)) out.push(abs);
    }
  }
  return out.sort();
};

const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));
const relFromSrc = (abs) => toPosix(path.relative(SRC_DIR, abs));

// ---------------------------------------------------------------------------
// Lightweight extractors — regex-based, lossy by design (no TS compiler dep).
// Each tolerates parse failures and falls back to empty / null values so a
// single weird file never crashes the index.
// ---------------------------------------------------------------------------

const stripBlockComments = (src) => src.replaceAll(/\/\*[\s\S]*?\*\//g, "");

// Pull the very first top-of-file summary line. Recognises:
//   //? summary text
//   // summary text
//   /** summary text */  (single-line JSDoc)
//   /**\n * summary text  (multi-line JSDoc — first non-blank * line)
const extractFileSummary = (src) => {
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // JSDoc block
    if (raw.startsWith("/**")) {
      const single = raw.match(/^\/\*\*\s*(.+?)\s*\*\/$/);
      if (single) return single[1];
      // Walk forward looking for first non-empty * line that isn't a @tag
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        const inner = lines[j].trim().replace(/^\*\s?/, "").trim();
        if (!inner || inner.startsWith("@") || inner === "*/") {
          if (inner === "*/") break;
          continue;
        }
        return inner;
      }
      return null;
    }
    // `//?` framework convention
    if (raw.startsWith("//?")) return raw.replace(/^\/\/\?\s*/, "").trim();
    // Plain `//`
    if (raw.startsWith("//")) return raw.replace(/^\/\/+\s*/, "").trim();
    // First code line — no summary
    return null;
  }
  return null;
};

// Extracts JSDoc `@docs owner`, `@docs tags`, `@docs deprecated` from
// the FIRST `/** ... */` block in the file. Mirrors apiMeta.ts's tag set.
const extractDocsMeta = (src) => {
  const blockMatch = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!blockMatch) return { owner: null, tags: [], deprecated: null };
  const body = blockMatch[1];
  const ownerMatch = body.match(/@docs\s+owner\s+([^\n*]+)/);
  const tagsMatch = body.match(/@docs\s+tags\s+([^\n*]+)/);
  const deprecatedMatch = body.match(/@docs\s+deprecated(?:\s+([^\n*]+))?/);
  return {
    owner: ownerMatch ? ownerMatch[1].trim() : null,
    tags: tagsMatch ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean) : [],
    deprecated: deprecatedMatch ? (deprecatedMatch[1] ? deprecatedMatch[1].trim() : "yes") : null,
  };
};

// Match `export const NAME[: T] = VALUE`. Value-side is a best-effort capture
// that stops at `;` or end-of-line. Multi-line object literals are truncated;
// we re-stitch them via a brace-balance scan below for the `auth` case.
const extractStringExport = (src, name) => {
  const re = new RegExp(`^\\s*export\\s+const\\s+${name}\\s*(?::[^=\\n]+)?\\s*=\\s*(['"\\\`])([^'"\`\\n]+)\\1`, "m");
  const m = src.match(re);
  return m ? m[2] : null;
};

const extractNumberOrFalseExport = (src, name) => {
  const re = new RegExp(`^\\s*export\\s+const\\s+${name}\\s*(?::[^=\\n]+)?\\s*=\\s*(\\d+|false|true)\\s*[;\\n]`, "m");
  const m = src.match(re);
  return m ? m[1] : null;
};

const extractAuthShape = (src) => {
  // Find the start of the object literal after `export const auth ...= {`.
  const startRe = /^\s*export\s+const\s+auth\s*(?::\s*AuthProps)?\s*=\s*\{/m;
  const startMatch = startRe.exec(src);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length - 1; // position of `{`
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return null;
  const body = src.slice(startIdx + 1, endIdx);
  const loginMatch = body.match(/\blogin\s*:\s*(true|false)/);
  const additionalMatch = body.match(/\badditional\s*:\s*\[([^\]]*)\]/);
  const login = loginMatch ? loginMatch[1] === "true" : null;
  let additionalCount = 0;
  if (additionalMatch) {
    const inside = additionalMatch[1].trim();
    if (inside.length > 0) {
      //? Count comma-separated TOP-LEVEL array entries (depth-0 commas) rather
      //? than `{` chars: `additional:[isAdmin, isOwner]` (function refs, zero
      //? braces) previously collapsed to 1, under-reporting a security-relevant
      //? column; inline-object predicates over-counted. Track bracket depth so
      //? commas inside a nested `{}`/`[]`/`()` don't split an entry.
      let depth = 0;
      additionalCount = 1;
      for (const ch of inside) {
        if (ch === "{" || ch === "[" || ch === "(") depth++;
        else if (ch === "}" || ch === "]" || ch === ")") depth--;
        else if (ch === "," && depth === 0) additionalCount++;
      }
    }
  }
  return { login, additionalCount };
};

const formatAuth = (auth) => {
  if (!auth) return "n/a";
  const parts = [];
  if (auth.login === true) parts.push("login");
  else if (auth.login === false) parts.push("public");
  if (auth.additionalCount > 0) parts.push(`+${auth.additionalCount} predicate${auth.additionalCount === 1 ? "" : "s"}`);
  return parts.join(" ");
};

const extractExports = (src) => {
  const names = new Set();
  const patterns = [
    /^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+let\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/gm,
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(src)) !== null) names.add(m[1]);
  }
  if (/^\s*export\s+default\b/m.test(src)) names.add("default");
  return [...names].sort();
};

// `import { Foo, Bar } from '../../_functions/x';` -> { source: '.../_functions/x', names: ['Foo','Bar'] }
// Default imports + namespace imports are captured under a single synthetic name.
const extractImports = (src) => {
  const out = [];
  const re = /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z_$][\w$]*)|\*\s+as\s+([A-Za-z_$][\w$]*))?\s*(?:,\s*\{([^}]+)\})?\s*from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const namedA = m[1] ? m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
    const namedB = m[4] ? m[4].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
    const defaultName = m[2] ?? null;
    const namespace = m[3] ?? null;
    const source = m[5];
    out.push({ source, names: [...namedA, ...namedB], defaultName, namespace });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Section scanners
// ---------------------------------------------------------------------------

const API_FILE_RE = /^[A-Za-z0-9_-]+_v\d+\.ts$/;
const SYNC_SERVER_FILE_RE = /^[A-Za-z0-9_-]+_server_v\d+\.ts$/;
const SYNC_CLIENT_FILE_RE = /^[A-Za-z0-9_-]+_client_v\d+\.ts$/;

const isUnderSegment = (abs, segment) => toPosix(abs).includes(`/${segment}/`);

const scanApiRoutes = async () => {
  const files = await walkFiles(SRC_DIR, (name, abs) => isUnderSegment(abs, "_api") && API_FILE_RE.test(name));
  const rows = [];
  for (const abs of files) {
    const src = await readTextFile(abs);
    if (src === null) continue;
    const noBlock = stripBlockComments(src);
    const rel = relFromSrc(abs);
    // path: <pageSegments>/<routeName>/<version>
    const m = rel.match(/^(.*)\/_api\/([A-Za-z0-9_-]+)_v(\d+)\.ts$/);
    if (!m) continue;
    const [, page, routeName, version] = m;
    const meta = extractDocsMeta(src);
    rows.push({
      route: `${page}/${routeName}/v${version}`,
      file: rel,
      abs,
      method: extractStringExport(noBlock, "httpMethod") ?? "POST",
      rateLimit: extractNumberOrFalseExport(noBlock, "rateLimit") ?? "default",
      auth: formatAuth(extractAuthShape(noBlock)),
      owner: meta.owner,
      tags: meta.tags,
      deprecated: meta.deprecated,
      tested: await fileExists(abs.replace(/\.ts$/, ".tests.ts")),
      summary: extractFileSummary(src),
      imports: extractImports(src),
    });
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
};

const scanSyncRoutes = async () => {
  const files = await walkFiles(SRC_DIR, (name, abs) =>
    isUnderSegment(abs, "_sync") && (SYNC_SERVER_FILE_RE.test(name) || SYNC_CLIENT_FILE_RE.test(name)),
  );
  const byRoute = new Map();
  for (const abs of files) {
    const src = await readTextFile(abs);
    if (src === null) continue;
    const noBlock = stripBlockComments(src);
    const rel = relFromSrc(abs);
    const m = rel.match(/^(.*)\/_sync\/([A-Za-z0-9_-]+)_(server|client)_v(\d+)\.ts$/);
    if (!m) continue;
    const [, page, syncName, kind, version] = m;
    const key = `${page}/${syncName}/v${version}`;
    if (!byRoute.has(key)) {
      byRoute.set(key, {
        route: key,
        serverFile: null,
        clientFile: null,
        auth: "n/a",
        owner: null,
        tags: [],
        deprecated: null,
        tested: false,
        summary: null,
        imports: [],
      });
    }
    const row = byRoute.get(key);
    if (kind === "server") {
      row.serverFile = rel;
      row.auth = formatAuth(extractAuthShape(noBlock));
      const meta = extractDocsMeta(src);
      row.owner = meta.owner;
      row.tags = meta.tags;
      row.deprecated = meta.deprecated;
      row.tested = await fileExists(abs.replace(/\.ts$/, ".tests.ts"));
      row.summary = extractFileSummary(src);
    } else {
      row.clientFile = rel;
    }
    row.imports.push(...extractImports(src));
  }
  return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
};

const scanPages = async () => {
  const files = await walkFiles(SRC_DIR, (name) => name === "page.tsx");
  const rows = [];
  for (const abs of files) {
    const src = await readTextFile(abs);
    if (src === null) continue;
    const noBlock = stripBlockComments(src);
    const rel = relFromSrc(abs);
    // route: derived from folder, with `_<folder>` folders contributing no segment.
    const folder = path.dirname(rel);
    const segments = folder === "." ? [] : folder.split("/").filter((s) => !s.startsWith("_"));
    const route = segments.length === 0 ? "/" : `/${segments.join("/")}`;
    // Skip pages under a folder that begins with `_` and has no non-underscore parent
    // (invalid placement is handled by audit skills; we still show the file).
    const inReservedOnly = folder !== "." && folder.split("/").every((s) => s.startsWith("_"));
    rows.push({
      route,
      file: rel,
      template: extractStringExport(noBlock, "template") ?? "plain",
      hasMiddleware: /^\s*export\s+const\s+middleware\b/m.test(noBlock),
      reservedFolder: inReservedOnly,
      summary: extractFileSummary(src),
    });
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
};

const scanHelpersOrComponents = async (subDir, ext) => {
  const root = path.join(SRC_DIR, subDir);
  if (!(await fileExists(root))) return [];
  const files = await walkFiles(root, (name) => name.endsWith(ext) && !name.endsWith(".test" + ext) && !name.endsWith(".d.ts"));
  const rows = [];
  for (const abs of files) {
    const src = await readTextFile(abs);
    if (src === null) continue;
    const rel = relFromSrc(abs);
    const exports = extractExports(src);
    if (exports.length === 0) continue;
    rows.push({
      file: rel,
      abs,
      exports,
      summary: extractFileSummary(src),
    });
  }
  return rows;
};

// ---------------------------------------------------------------------------
// Cross-reference computation
// ---------------------------------------------------------------------------

const buildExportLookup = (entries, marker) => {
  // Map: "<marker>/<basename-without-ext>" -> array of { file, exportName }
  const lookup = new Map();
  for (const entry of entries) {
    const baseNoExt = entry.file.replace(/\.(tsx?|jsx?|mjs)$/, "");
    if (!baseNoExt.startsWith(`${marker}/`)) continue;
    for (const exp of entry.exports) {
      const key = `${baseNoExt}::${exp}`;
      if (!lookup.has(key)) lookup.set(key, { file: entry.file, exportName: exp, callers: [] });
    }
  }
  return lookup;
};

const resolveImportTarget = (importer, importSource) => {
  // Resolve a relative import path against the importer's directory.
  // Returns the path relative to SRC_DIR (without extension), or null if
  // it's a package import / not under src/.
  if (!importSource.startsWith(".")) return null;
  const importerDir = path.dirname(path.join(SRC_DIR, importer));
  const resolvedAbs = path.normalize(path.join(importerDir, importSource));
  const relSrc = toPosix(path.relative(SRC_DIR, resolvedAbs));
  if (relSrc.startsWith("..")) return null;
  // Strip extension if present, leave for lookup-key matching
  return relSrc.replace(/\.(tsx?|jsx?|mjs)$/, "");
};

const recordCallers = (callers, helperLookup, componentLookup) => {
  // callers = [{ importerLabel, imports }]
  for (const { importerLabel, importerRel, imports } of callers) {
    for (const imp of imports) {
      const target = resolveImportTarget(importerRel, imp.source);
      if (!target) continue;
      const namesToCheck = [...imp.names];
      if (imp.defaultName) namesToCheck.push("default");
      if (imp.namespace) namesToCheck.push("*");
      for (const exportName of namesToCheck) {
        const helperKey = `${target}::${exportName}`;
        const compKey = `${target}::${exportName}`;
        if (helperLookup.has(helperKey)) helperLookup.get(helperKey).callers.push(importerLabel);
        else if (componentLookup.has(compKey)) componentLookup.get(compKey).callers.push(importerLabel);
        else if (imp.namespace) {
          // Namespace import — check if ANY export from that target is in our lookups
          for (const [key, entry] of helperLookup) {
            if (entry.file.replace(/\.(tsx?|jsx?|mjs)$/, "") === target) entry.callers.push(importerLabel);
          }
          for (const [key, entry] of componentLookup) {
            if (entry.file.replace(/\.(tsx?|jsx?|mjs)$/, "") === target) entry.callers.push(importerLabel);
          }
        }
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

const escapeCell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ").trim();

const renderTable = (header, rows) => {
  if (rows.length === 0) return "_(none)_";
  const out = [];
  out.push(`| ${header.join(" | ")} |`);
  out.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) out.push(`| ${row.map(escapeCell).join(" | ")} |`);
  return out.join("\n");
};

const renderApiRoutes = (rows) =>
  renderTable(
    ["Path", "Method", "Auth", "Rate limit", "Owner", "Tested", "Tags", "Summary"],
    rows.map((r) => [
      `\`api/${r.route}\``,
      r.method,
      r.auth,
      r.rateLimit,
      r.owner ?? "—",
      r.tested ? "yes" : "**no**",
      r.tags.length ? r.tags.join(", ") : "—",
      (r.deprecated ? "**deprecated** — " : "") + (r.summary ?? "—"),
    ]),
  );

const renderSyncRoutes = (rows) =>
  renderTable(
    ["Path", "Server", "Client", "Auth", "Owner", "Tested", "Tags", "Summary"],
    rows.map((r) => [
      `\`sync/${r.route}\``,
      r.serverFile ? "yes" : "—",
      r.clientFile ? "yes" : "—",
      r.auth,
      r.owner ?? "—",
      r.tested ? "yes" : "**no**",
      r.tags.length ? r.tags.join(", ") : "—",
      (r.deprecated ? "**deprecated** — " : "") + (r.summary ?? "—"),
    ]),
  );

const renderPages = (rows) =>
  renderTable(
    ["Route", "Template", "Per-page middleware", "File", "Summary"],
    rows.map((r) => [
      `\`${r.route}\``,
      r.template,
      r.hasMiddleware ? "yes" : "—",
      `\`${r.file}\``,
      (r.reservedFolder ? "_(reserved-folder placement — see audit-invalid-page-locations)_ " : "") + (r.summary ?? "—"),
    ]),
  );

const renderInventory = (rows, label) =>
  renderTable(
    [label, "Path", "Exports", "Summary"],
    rows.map((r) => [
      `\`${path.basename(r.file)}\``,
      `\`${r.file}\``,
      r.exports.length > 4 ? `${r.exports.slice(0, 4).join(", ")}, +${r.exports.length - 4}` : r.exports.join(", "),
      r.summary ?? "—",
    ]),
  );

const renderUsageCounts = (lookup, label) => {
  const used = [...lookup.values()].filter((e) => e.callers.length > 0);
  used.sort((a, b) => b.callers.length - a.callers.length || a.file.localeCompare(b.file));
  if (used.length === 0) return "_(no cross-references detected)_";
  const rows = used.map((e) => [
    `\`${e.exportName}\` _(in ${e.file})_`,
    String(e.callers.length),
    [...new Set(e.callers)].slice(0, 3).join(", ") + (new Set(e.callers).size > 3 ? ", ..." : ""),
  ]);
  return renderTable([label, "Used by N callers", "Sample callers"], rows);
};

const renderUnused = (lookup, label) => {
  const unused = [...lookup.values()].filter((e) => e.callers.length === 0);
  if (unused.length === 0) return "_(every export has at least one in-project caller)_";
  unused.sort((a, b) => a.file.localeCompare(b.file) || a.exportName.localeCompare(b.exportName));
  const rows = unused.map((e) => [`\`${e.exportName}\``, `\`${e.file}\``]);
  return renderTable([label, "Path"], rows);
};

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

// Ownership (from @docs owner tags) + test-coverage summary over all routes.
// Git authorship is intentionally NOT shelled-out here (one `git log` per file
// is slow + noisy in pre-commit); @docs owner is the primary, AI-maintained
// signal (CLAUDE.md Rule 15b). The "Owner" column already shows per-route owner.
const renderOwnershipAndCoverage = (routes) => {
  // `method` exists on API rows, `serverFile` on sync rows — use it to label kind.
  const kindOf = (r) => ("serverFile" in r ? "sync" : "api");
  const out = [];

  // Ownership: count routes per @docs owner.
  const counts = new Map();
  for (const r of routes) {
    const owner = r.owner ?? "(unowned)";
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const ownerRows = [...counts.entries()]
    .sort((a, b) => (a[0] === "(unowned)" ? 1 : b[0] === "(unowned)" ? -1 : a[0].localeCompare(b[0])))
    .map(([owner, n]) => [owner === "(unowned)" ? "_(unowned)_" : `\`${owner}\``, String(n)]);
  out.push("**By owner** (from `@docs owner` tags — set them from day one, Rule 15b):");
  out.push("");
  out.push(renderTable(["Owner", "Routes"], ownerRows));
  out.push("");

  // Coverage: routes with a sibling per-route `.tests.ts`.
  const untested = routes.filter((r) => !r.tested);
  const total = routes.length;
  out.push(`**Test coverage**: ${total - untested.length}/${total} routes have a per-route \`.tests.ts\`.`);
  if (untested.length > 0) {
    out.push("");
    out.push("_Untested routes — flag these to the user (Prioritize-tests rule), don't bulk-add unasked:_");
    out.push("");
    for (const r of untested.slice(0, 50)) out.push(`- \`${kindOf(r)}/${r.route}\``);
    if (untested.length > 50) out.push(`- … +${untested.length - 50} more`);
  }
  return out.join("\n");
};

const buildDocument = (data) => {
  const parts = [];
  parts.push("# Project Index");
  parts.push("");
  parts.push("> Auto-generated by `scripts/generateProjectIndex.mjs` — regenerate via `npm run ai:project-index`.");
  parts.push("> Hand edits will be overwritten — change the generator instead.");
  parts.push(">");
  parts.push("> Covers **this project's own code** (routes, pages, helpers, components, cross-refs). For framework surfaces see `docs/AI_QUICK_INDEX.md` and per-package `node_modules/@luckystack/*/CLAUDE.md`. For a flat list of every installed export see `docs/AI_CAPABILITIES.md`.");
  parts.push(">");
  parts.push("> Cross-reference detection uses static `import` statements. Dynamic imports (`await import(...)`) and string-key access are NOT counted — so the \"unused\" list may include exports that are actually used dynamically.");
  parts.push("");
  parts.push(`## API routes (${data.apiRoutes.length})`);
  parts.push("");
  parts.push(renderApiRoutes(data.apiRoutes));
  parts.push("");
  parts.push(`## Sync routes (${data.syncRoutes.length})`);
  parts.push("");
  parts.push(renderSyncRoutes(data.syncRoutes));
  parts.push("");
  parts.push("## Ownership & coverage");
  parts.push("");
  parts.push(renderOwnershipAndCoverage([...data.apiRoutes, ...data.syncRoutes]));
  parts.push("");
  parts.push(`## Pages (${data.pages.length})`);
  parts.push("");
  parts.push(renderPages(data.pages));
  parts.push("");
  parts.push(`## Helpers — \`src/_functions/\` (${data.helpers.reduce((n, h) => n + h.exports.length, 0)} exports across ${data.helpers.length} files)`);
  parts.push("");
  parts.push(renderInventory(data.helpers, "File"));
  parts.push("");
  parts.push(`## Components — \`src/_components/\` (${data.components.reduce((n, c) => n + c.exports.length, 0)} exports across ${data.components.length} files)`);
  parts.push("");
  parts.push(renderInventory(data.components, "File"));
  parts.push("");
  parts.push("## Cross-references");
  parts.push("");
  parts.push("### Helpers by in-project usage");
  parts.push("");
  parts.push(renderUsageCounts(data.helperLookup, "Helper"));
  parts.push("");
  parts.push("### Components by in-project usage");
  parts.push("");
  parts.push(renderUsageCounts(data.componentLookup, "Component"));
  parts.push("");
  parts.push("### Unused helper exports");
  parts.push("");
  parts.push(renderUnused(data.helperLookup, "Helper"));
  parts.push("");
  parts.push("### Unused component exports");
  parts.push("");
  parts.push(renderUnused(data.componentLookup, "Component"));
  parts.push("");
  return parts.join("\n");
};

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const main = async () => {
  const [apiRoutes, syncRoutes, pages, helpers, components] = await Promise.all([
    scanApiRoutes(),
    scanSyncRoutes(),
    scanPages(),
    scanHelpersOrComponents("_functions", ".ts"),
    scanHelpersOrComponents("_components", ".tsx"),
  ]);

  const helperLookup = buildExportLookup(helpers, "_functions");
  const componentLookup = buildExportLookup(components, "_components");

  const callers = [];
  for (const r of apiRoutes) callers.push({ importerLabel: `api/${r.route}`, importerRel: r.file, imports: r.imports });
  for (const r of syncRoutes) {
    const label = `sync/${r.route}`;
    callers.push({ importerLabel: label, importerRel: r.serverFile ?? r.clientFile, imports: r.imports });
  }
  for (const p of pages) {
    const src = await readTextFile(path.join(SRC_DIR, p.file));
    if (src !== null) {
      callers.push({ importerLabel: `page ${p.route}`, importerRel: p.file, imports: extractImports(src) });
    }
  }
  recordCallers(callers, helperLookup, componentLookup);

  const document = buildDocument({ apiRoutes, syncRoutes, pages, helpers, components, helperLookup, componentLookup });

  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) {
    console.error(`[ai:project-index] failed to ensure docs directory: ${mkErr.message}`);
    process.exit(1);
  }

  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, document, "utf8"));
  if (writeErr) {
    console.error(`[ai:project-index] failed to write ${OUTPUT_FILE}: ${writeErr.message}`);
    process.exit(1);
  }

  console.log(
    `[ai:project-index] generated ${relFromRepo(OUTPUT_FILE)} (${apiRoutes.length} API, ${syncRoutes.length} sync, ${pages.length} pages, ${helpers.length} helper files, ${components.length} component files)`,
  );
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:project-index] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
