// scripts/generateAiCapabilities.mjs
//
// Regenerates docs/AI_CAPABILITIES.md — the AI's "before-you-reinvent" lookup.
// For every installed @luckystack/* package, every local helper in
// `src/_functions/`, every component in `src/_components/`, every server-
// function shim in `functions/`, every shared module in `shared/`, AND the
// generated `Functions` injection map, list what exists right now in the
// consumer's repo with regex-extracted callable signatures.
//
// AI sessions MUST re-run this script (`npm run ai:capabilities`) after
// adding a new export to any of those locations, otherwise the next session
// sees stale data and recreates work that already exists.
//
// Pure-Node ESM. No framework imports — this script runs during scaffolding
// and CI before any package build step. Inline safe/safeSync helpers keep
// the [err, result] tuple shape without pulling in @luckystack/core.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "AI_CAPABILITIES.md");
const GENERATED_TYPES_FILE = path.join(REPO_ROOT, "src", "_sockets", "apiTypes.generated.ts");

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};

const safeSync = (fn) => {
  try { return [null, fn()]; } catch (error) { return [error, null]; }
};

const readTextFile = async (absPath) => {
  const [err, content] = await safe(fs.readFile(absPath, "utf8"));
  if (err) return null;
  return content;
};

const readJsonFile = async (absPath) => {
  const content = await readTextFile(absPath);
  if (content === null) return null;
  const [parseErr, parsed] = safeSync(() => JSON.parse(content));
  if (parseErr) {
    console.warn(`[ai:capabilities] skip (invalid JSON): ${path.relative(REPO_ROOT, absPath)} — ${parseErr.message}`);
    return null;
  }
  return parsed;
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

// ---------------------------------------------------------------------------
// Signature extraction — regex-based, lossy by design (no TS compiler dep).
// Captures the shape between `(` and `)` plus the return-type annotation.
// Falls back to the export name alone when a pattern doesn't match cleanly.
// ---------------------------------------------------------------------------

const escapeRegex = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

const trimSig = (s) => s.replaceAll(/\s+/g, " ").trim();

//? Try patterns in priority order against the file source. Returns the
//? best-effort callable shape, or just the name if nothing matched.
const extractSignatureForName = (source, name) => {
  const escaped = escapeRegex(name);

  // Arrow function: `export const foo = (args): Ret => …`
  // or `export const foo = async (args): Promise<…> => …`
  // The non-greedy `[^)]*?` doesn't balance nested parens — generic
  // function args (`a: () => boolean`) get truncated. Acceptable.
  const arrow = new RegExp(
    `^\\s*export\\s+(?:const|let)\\s+${escaped}\\s*(?::[^=\\n]+)?\\s*=\\s*(async\\s+)?\\(([^)]*?)\\)\\s*(?::\\s*([^=\\n{]+?))?\\s*=>`,
    "m",
  );
  const arrowMatch = arrow.exec(source);
  if (arrowMatch) {
    const args = trimSig(arrowMatch[2]);
    const ret = arrowMatch[3] ? trimSig(arrowMatch[3]) : "";
    return `${name}(${args})${ret ? `: ${ret}` : ""}`;
  }

  // Function declaration: `export function foo(args): Ret {`
  const fn = new RegExp(
    `^\\s*export\\s+(?:async\\s+)?function\\s*\\*?\\s*${escaped}\\s*(?:<[^>]*>)?\\s*\\(([^)]*?)\\)\\s*(?::\\s*([^\\n{]+?))?\\s*\\{`,
    "m",
  );
  const fnMatch = fn.exec(source);
  if (fnMatch) {
    const args = trimSig(fnMatch[1]);
    const ret = fnMatch[2] ? trimSig(fnMatch[2]) : "";
    return `${name}(${args})${ret ? `: ${ret}` : ""}`;
  }

  // Type / interface / class / enum — render as their declaration kind.
  if (new RegExp(`^\\s*export\\s+type\\s+${escaped}\\b`, "m").test(source)) return `type ${name}`;
  if (new RegExp(`^\\s*export\\s+interface\\s+${escaped}\\b`, "m").test(source)) return `interface ${name}`;
  if (new RegExp(`^\\s*export\\s+class\\s+${escaped}\\b`, "m").test(source)) return `class ${name}`;
  if (new RegExp(`^\\s*export\\s+enum\\s+${escaped}\\b`, "m").test(source)) return `enum ${name}`;

  // `export const foo: SomeType = …`
  const annotated = new RegExp(
    `^\\s*export\\s+(?:const|let)\\s+${escaped}\\s*:\\s*([^=\\n]+?)\\s*=`,
    "m",
  );
  const annotatedMatch = annotated.exec(source);
  if (annotatedMatch) {
    return `${name}: ${trimSig(annotatedMatch[1])}`;
  }

  // `export const foo = { … }` or `[ … ]` — value-shape fallback.
  const lit = new RegExp(`^\\s*export\\s+(?:const|let)\\s+${escaped}\\s*=\\s*(\\{|\\[)`, "m");
  const litMatch = lit.exec(source);
  if (litMatch) return `${name}: ${litMatch[1] === "{" ? "object" : "array"}`;

  return name;
};

const extractDefaultReExportTarget = (source) => {
  // `export { default } from 'path'` — return the path.
  const re = /^\s*export\s+\{[^}]*\bdefault\b[^}]*\}\s+from\s+["']([^"']+)["']/m;
  const m = re.exec(source);
  return m ? m[1] : null;
};

const extractWildcardReExportTarget = (source) => {
  // `export * from 'path'` — return the path. Skipped if `export * as ns`.
  const re = /^\s*export\s+\*\s+from\s+["']([^"']+)["']/m;
  const m = re.exec(source);
  return m ? m[1] : null;
};

const EXPORT_NAME_PATTERNS = [
  /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+let\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/gm,
];

const DEFAULT_EXPORT_NAME_PATTERNS = [
  /^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)/m,
  /^\s*export\s+default\s+class\s+([A-Za-z_$][\w$]*)/m,
];

const extractExports = (source) => {
  const named = new Set();
  for (const pattern of EXPORT_NAME_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) named.add(match[1]);
  }
  //? `export { a, b as c }` — collect both forms (with or without
  //? `from 'module'`). Wildcard re-exports are skipped.
  const namedReExport = /^\s*export\s+\{([^}]+)\}(?:\s+from\s+["']([^"']+)["'])?/gm;
  let m;
  while ((m = namedReExport.exec(source)) !== null) {
    const specifiers = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const spec of specifiers) {
      const exportName = (spec.match(/\bas\s+([A-Za-z_$][\w$]*)/) ?? spec.match(/^([A-Za-z_$][\w$]*)/))?.[1];
      if (exportName && exportName !== "default") named.add(exportName);
    }
  }

  let defaultExport = null;
  for (const pattern of DEFAULT_EXPORT_NAME_PATTERNS) {
    const match = pattern.exec(source);
    if (match) { defaultExport = match[1]; break; }
  }
  if (defaultExport === null && /^\s*export\s+default\b/m.test(source)) {
    defaultExport = "(anonymous)";
  }

  const defaultReExportTarget = extractDefaultReExportTarget(source);
  const wildcardReExportTarget = extractWildcardReExportTarget(source);

  const namedWithSignatures = [...named].sort().map((n) => ({
    name: n,
    signature: extractSignatureForName(source, n),
  }));

  return { named: namedWithSignatures, defaultExport, defaultReExportTarget, wildcardReExportTarget };
};

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

const formatExports = ({ named, defaultExport, defaultReExportTarget, wildcardReExportTarget }) => {
  const parts = [];
  if (wildcardReExportTarget) {
    parts.push(`\`re-export * from ${wildcardReExportTarget}\``);
  }
  if (defaultReExportTarget) {
    parts.push(`\`default: re-export of ${defaultReExportTarget}\``);
  } else if (defaultExport) {
    parts.push(`\`default: ${defaultExport}\``);
  }
  if (named.length > 0) {
    parts.push(named.map(({ signature }) => `\`${signature}\``).join(", "));
  }
  return parts.length === 0 ? "_(no exports)_" : parts.join(" — ");
};

const buildLocalSection = async (relativeDir, title, fileFilter) => {
  const absoluteDir = path.join(REPO_ROOT, relativeDir);
  const files = await walkFiles(absoluteDir, fileFilter);
  if (files.length === 0) {
    return `### ${title}\n\nNone present (\`${relativeDir}/\` is empty or missing).\n`;
  }
  const lines = [`### ${title}`, ""];
  lines.push("| File | Exports |");
  lines.push("| --- | --- |");
  for (const abs of files) {
    const rel = path.relative(REPO_ROOT, abs).replaceAll("\\", "/");
    const source = await readTextFile(abs);
    if (source === null) {
      lines.push(`| \`${rel}\` | _(unreadable)_ |`);
      continue;
    }
    const exportsForFile = extractExports(source);
    lines.push(`| \`${rel}\` | ${formatExports(exportsForFile)} |`);
  }
  lines.push("");
  return lines.join("\n");
};

const findLuckystackPackages = async () => {
  const nodeModulesDir = path.join(REPO_ROOT, "node_modules", "@luckystack");
  const [readErr, entries] = await safe(fs.readdir(nodeModulesDir, { withFileTypes: true }));
  if (readErr) return [];
  return entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => e.name)
    .sort();
};

const buildPackagesSection = async () => {
  const names = await findLuckystackPackages();
  if (names.length === 0) {
    return `### Installed \`@luckystack/*\` packages\n\nNone detected in \`node_modules/@luckystack/\`. Either you are outside an installed project, or no framework packages are installed yet.\n`;
  }
  const lines = [`### Installed \`@luckystack/*\` packages`, ""];
  lines.push("Each row links to that package's CLAUDE.md (the canonical function INDEX) if it ships one. Consult the INDEX **before** writing any helper that touches that package's surface area.");
  lines.push("");
  lines.push("| Package | Version | One-liner | INDEX |");
  lines.push("| --- | --- | --- | --- |");
  for (const name of names) {
    const packageDir = path.join(REPO_ROOT, "node_modules", "@luckystack", name);
    const pkg = await readJsonFile(path.join(packageDir, "package.json"));
    const version = pkg?.version ?? "?";
    const description = (pkg?.description ?? "").replaceAll("|", "\\|").trim() || "_(no description)_";
    const aiIndexPath = path.join(packageDir, "CLAUDE.md");
    const indexLink = (await fileExists(aiIndexPath))
      ? `[CLAUDE.md](../node_modules/@luckystack/${name}/CLAUDE.md)`
      : "—";
    lines.push(`| \`@luckystack/${name}\` | ${version} | ${description} | ${indexLink} |`);
  }
  lines.push("");
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Functions injection map — parse src/_sockets/apiTypes.generated.ts
// ---------------------------------------------------------------------------

const parseFunctionsInterface = (source) => {
  const ifaceMatch = source.match(/export\s+interface\s+Functions\s*\{([\s\S]*?)\n\}/);
  if (!ifaceMatch) return [];
  const body = ifaceMatch[1];
  const entries = [];
  const pathStack = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line) continue;

    const blockStart = line.match(/^(\s*)([A-Za-z_$][\w$]*):\s*\{$/);
    if (blockStart) {
      const indent = blockStart[1].length;
      while (pathStack.length > 0 && pathStack.at(-1).indent >= indent) pathStack.pop();
      pathStack.push({ name: blockStart[2], indent });
      continue;
    }

    if (/^\s*\};\s*$/.test(line)) {
      pathStack.pop();
      continue;
    }

    const leaf = line.match(/^(\s*)([A-Za-z_$][\w$]*):\s*(.+);\s*$/);
    if (leaf) {
      const indent = leaf[1].length;
      while (pathStack.length > 0 && pathStack.at(-1).indent >= indent) pathStack.pop();
      const fullPath = [...pathStack.map((p) => p.name), leaf[2]];
      entries.push({ path: fullPath, signature: leaf[3] });
    }
  }
  return entries;
};

const buildFunctionsMapSection = async () => {
  const source = await readTextFile(GENERATED_TYPES_FILE);
  if (source === null) {
    return `### Server-injected \`functions.*\` map\n\nNo \`src/_sockets/apiTypes.generated.ts\` found. Run \`npm run generateArtifacts\` first, then regenerate this snapshot.\n`;
  }
  const entries = parseFunctionsInterface(source);
  if (entries.length === 0) {
    return `### Server-injected \`functions.*\` map\n\nThe generated \`Functions\` interface is empty.\n`;
  }
  const lines = [`### Server-injected \`functions.*\` map`, ""];
  lines.push("Every entry below is callable inside an API or sync handler's `main({ data, user, functions })` parameter. Sourced from the `Functions` interface in `src/_sockets/apiTypes.generated.ts` — regenerate it via `npm run generateArtifacts` whenever you add or rename a function in `functions/` or `shared/`.");
  lines.push("");
  lines.push("| Access path | Signature |");
  lines.push("| --- | --- |");
  for (const entry of entries) {
    const accessPath = `functions.${entry.path.join(".")}`;
    const sig = entry.signature.replaceAll("|", "\\|");
    lines.push(`| \`${accessPath}\` | \`${sig}\` |`);
  }
  lines.push("");
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// API + Sync route maps — parse _ProjectApiTypeMap / _ProjectSyncTypeMap
// ---------------------------------------------------------------------------

//? Walks `type _ProjectXTypeMap = { <page>: { <name>: { <version>: { …meta… } } } };`
//? and returns `[{ page, name, version, leafBody }]` rows. The leaf body is
//? the raw block content between `{` and `};` so the caller can grep for
//? individual fields (method, rateLimit, stream, etc.) without re-parsing.
const parseRouteMap = (source, typeAliasName) => {
  const reTypeAlias = new RegExp(`type\\s+${typeAliasName}\\s*=\\s*\\{`);
  const aliasMatch = reTypeAlias.exec(source);
  if (!aliasMatch) return [];
  let depth = 1;
  let i = aliasMatch.index + aliasMatch[0].length;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth === 0) break;
    i += 1;
  }
  const body = source.slice(start, i);

  const rows = [];
  const lines = body.split("\n");
  let page = null;
  let name = null;
  let version = null;
  let leafBuffer = [];
  let inLeaf = false;
  let leafBraceDepth = 0;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (inLeaf) {
      leafBuffer.push(line);
      for (const ch of line) {
        if (ch === "{") leafBraceDepth += 1;
        else if (ch === "}") leafBraceDepth -= 1;
      }
      if (leafBraceDepth === 0) {
        rows.push({ page, name, version, body: leafBuffer.join("\n") });
        leafBuffer = [];
        inLeaf = false;
        version = null;
      }
      continue;
    }
    //? Keys may be bare identifiers OR quoted strings (e.g. `"reset-password"`
    //? when the page path contains a dash). Capture either form.
    const pageMatch = line.match(/^  (?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*\{$/);
    if (pageMatch) { page = pageMatch[1] ?? pageMatch[2]; continue; }
    const nameMatch = line.match(/^    (?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*\{$/);
    if (nameMatch) { name = nameMatch[1] ?? nameMatch[2]; continue; }
    const versionMatch = line.match(/^      (?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*\{$/);
    if (versionMatch) {
      version = versionMatch[1] ?? versionMatch[2];
      inLeaf = true;
      leafBraceDepth = 1;
      leafBuffer = [];
      continue;
    }
  }
  return rows;
};

const extractField = (body, fieldName) => {
  //? Match `<fieldName>: <value>;` at any indent within the leaf body.
  //? Value is captured up to the first `;` not nested inside braces.
  const re = new RegExp(`^\\s*${fieldName}:\\s*(.+?);\\s*$`, "m");
  const m = re.exec(body);
  return m ? m[1].trim() : null;
};

//? Stream slots come in two shapes: `stream: never;` (single-line) and
//? `stream: { … multi-line … };`. The single-line `extractField` above
//? catches only the first. This helper returns `true` when the slot is a
//? typed stream block (multi-line), `false` for `never` or absent.
const hasTypedStreamField = (body, fieldName) => {
  const re = new RegExp(`^\\s*${fieldName}:\\s*\\{`, "m");
  return re.test(body);
};

// KEEP IN SYNC with scripts/generateAiCapabilities.mjs at the repo root.
// Any change to hasTestFile, buildApiRoutesSection, or buildSyncRoutesSection
// must be mirrored there, and vice versa.

//? Detect whether a per-route business-logic test stub exists alongside
//? the route source. Looks for `<name>_v<N>.tests.ts` in `_api/` and
//? `<name>_server_v<N>.tests.ts` in `_sync/`. Path-aware so nested pages
//? like `admin/users/_api/...` resolve correctly.
const hasTestFile = async (kind, page, name, version) => {
  const subdir = kind === "api" ? "_api" : "_sync";
  const filename = kind === "api" ? `${name}_${version}.tests.ts` : `${name}_server_${version}.tests.ts`;
  const candidate = path.join(REPO_ROOT, "src", page, subdir, filename);
  return await fileExists(candidate);
};

const buildApiRoutesSection = async (source) => {
  const rows = parseRouteMap(source, "_ProjectApiTypeMap");
  if (rows.length === 0) {
    return `### API routes (\`_api/\`)\n\nNo project API routes detected in the generated type map.\n`;
  }
  const lines = [`### API routes (\`_api/\`)`, ""];
  lines.push("Every typed API route in this project. Sourced from `_ProjectApiTypeMap` in `src/_sockets/apiTypes.generated.ts`. Files live at `src/<page>/_api/<name>_v<version>.ts`. Check here **before** authoring a new endpoint — the route might already exist. The `Tests` column shows whether a per-route business-logic test stub exists (`npm run scaffold:test <route>` to create one).");
  lines.push("");
  lines.push("| Route | Method | Rate limit | Has stream | Tests |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const method = (extractField(row.body, "method") ?? "?").replaceAll('"', "");
    const rateLimit = extractField(row.body, "rateLimit") ?? "?";
    const hasStream = hasTypedStreamField(row.body, "stream") ? "yes" : "—";
    const tests = (await hasTestFile("api", row.page, row.name, row.version)) ? "✓" : "—";
    lines.push(`| \`${row.page}/${row.name}/${row.version}\` | ${method} | ${rateLimit} | ${hasStream} | ${tests} |`);
  }
  lines.push("");
  return lines.join("\n");
};

const buildSyncRoutesSection = async (source) => {
  const rows = parseRouteMap(source, "_ProjectSyncTypeMap");
  if (rows.length === 0) {
    return `### Sync routes (\`_sync/\`)\n\nNo project sync routes detected in the generated type map.\n`;
  }
  const lines = [`### Sync routes (\`_sync/\`)`, ""];
  lines.push("Every typed sync route in this project. Sourced from `_ProjectSyncTypeMap` in `src/_sockets/apiTypes.generated.ts`. Files live at `src/<page>/_sync/<name>_server_v<version>.ts` (+ optional `_client_v<version>.ts`). The `Tests` column shows whether a per-route business-logic test stub exists.");
  lines.push("");
  lines.push("| Route | Server stream | Client stream | Tests |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of rows) {
    const ss = hasTypedStreamField(row.body, "serverStream") ? "yes" : "—";
    const cs = hasTypedStreamField(row.body, "clientStream") ? "yes" : "—";
    const tests = (await hasTestFile("sync", row.page, row.name, row.version)) ? "✓" : "—";
    lines.push(`| \`${row.page}/${row.name}/${row.version}\` | ${ss} | ${cs} | ${tests} |`);
  }
  lines.push("");
  return lines.join("\n");
};

const buildRoutesSection = async () => {
  const source = await readTextFile(GENERATED_TYPES_FILE);
  if (source === null) {
    return `### Routes\n\nNo \`src/_sockets/apiTypes.generated.ts\` found. Run \`npm run generateArtifacts\` first, then regenerate this snapshot.\n`;
  }
  return `${await buildApiRoutesSection(source)}\n${await buildSyncRoutesSection(source)}`;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const buildDocument = async () => {
  const packagesSection = await buildPackagesSection();
  const routesSection = await buildRoutesSection();
  const functionsInjectionSection = await buildFunctionsMapSection();
  const rootFunctionsSection = await buildLocalSection(
    "functions",
    "Server-function shims in `functions/` (source for the injection map)",
    (name) => name.endsWith(".ts") && !name.endsWith(".d.ts"),
  );
  const sharedSection = await buildLocalSection(
    "shared",
    "Shared modules in `shared/` (also fed into the injection map)",
    (name) => name.endsWith(".ts") && !name.endsWith(".d.ts"),
  );
  const localFunctionsSection = await buildLocalSection(
    "src/_functions",
    "Client helpers in `src/_functions/`",
    (name) => name.endsWith(".ts") && !name.endsWith(".d.ts"),
  );
  const componentsSection = await buildLocalSection(
    "src/_components",
    "Local components in `src/_components/`",
    (name) => name.endsWith(".tsx"),
  );

  return [
    "# AI Capability Snapshot",
    "",
    "> Auto-generated by `scripts/generateAiCapabilities.mjs` — regenerate via `npm run ai:capabilities`. **Do NOT edit this file by hand** — change the generator instead.",
    "",
    "> AI sessions: consult this file **before** authoring any new helper, util, component, cross-cutting module, OR API/sync endpoint. If a capability already exists here, use it. If it would exist in a not-yet-installed `@luckystack/*` package (see `docs/PACKAGE_OVERVIEW.md`), propose the install instead of reimplementing.",
    "",
    "> Regenerate after adding any export to `functions/`, `shared/`, `src/_functions/`, or `src/_components/`, adding/renaming an API or sync route, installing/upgrading a `@luckystack/*` package, or after running `npm run generateArtifacts` (the `functions.*` map and route tables mirror the generated `apiTypes.generated.ts`).",
    "",
    "## Lookup",
    "",
    packagesSection,
    routesSection,
    functionsInjectionSection,
    rootFunctionsSection,
    sharedSection,
    localFunctionsSection,
    componentsSection,
  ].join("\n");
};

const main = async () => {
  const document = await buildDocument();
  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, document, "utf8"));
  if (writeErr) {
    console.error(`[ai:capabilities] FAILED to write ${OUTPUT_FILE}: ${writeErr.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[ai:capabilities] generated docs/AI_CAPABILITIES.md`);
};

await main();
