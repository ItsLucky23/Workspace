// scripts/lintInvariants.mjs
//
// Diff-time enforcement of the machine-checkable subset of the CLAUDE.md
// contract. Where the three indexes describe the project and the decision log
// records the why, this turns a handful of always-on RULES from prose into an
// actual check, so an AI session (or a human) can't silently ship an `as any`,
// an arbitrary hex color, an untranslated user-facing string, or an unsafe
// request wrapper.
//
// REPORT-ONLY by default (mirrors the audit-* skills — never auto-fixes). A
// project opts a rule into *blocking* via a committed luckystack.invariants.json
// (`{ "block": ["no-as-any"], "warn": ["i18n-jsx"] }`). Per-line escape hatch:
//   <code> // luckystack-allow <rule>: <reason>
// documents a conscious deviation (Rule 3b) instead of disabling the hook.
//
// Modes:
//   (default)            scan ADDED lines of the staged git diff — only flags
//                        what THIS change introduces, not pre-existing debt.
//   --paths <f> [<f>...] scan whole files (used by the audit skill + tests).
//
// Exit code: 1 only if a BLOCKING-severity finding exists; warnings exit 0.
//
// Pure-Node ESM, no framework imports. The per-line checks are exported so the
// fixture tests can assert them without a git context.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// lintInvariants.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CONFIG_FILE = path.join(REPO_ROOT, "luckystack.invariants.json");

// ---------------------------------------------------------------------------
// Rule definitions. Each rule: id, a one-line description, an `applies(relPath)`
// gate, and a `find(text)` that returns a violation message or null. Kept
// regex-based (no TS-AST dep) to match the pure-Node generator family; `as any`
// is ALSO caught by eslint at `npm run lint` — this surfaces it at diff-time.
// ---------------------------------------------------------------------------

const isTs = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts");
const isTsx = (p) => p.endsWith(".tsx");

const RULES = [
  {
    id: "no-as-any",
    description: "No `as any` / `as unknown as T` casts (Rule 21 + strict-typing policy).",
    applies: (p) => isTs(p) && !p.endsWith(".generated.ts"),
    find: (text) => {
      if (/\bas\s+unknown\s+as\b/.test(text)) return "`as unknown as T` cast — fix the typing source or regenerate artifacts, never cast.";
      if (/\bas\s+any\b/.test(text)) {
        const wrapper = /\b(apiRequest|syncRequest|upsertSyncEventCallback)\b/.test(text);
        return wrapper
          ? "`as any` on a request call — do NOT wrap apiRequest/syncRequest with unsafe types; rely on generated route/version types (Rule 21)."
          : "`as any` cast — use the real type or regenerate the type maps (Rule 21).";
      }
      return null;
    },
  },
  {
    id: "no-arbitrary-color",
    description: "Tailwind colors only from the `@theme` tokens in src/index.css — no arbitrary hex (Rule 14).",
    applies: (p) => isTsx(p) || p.endsWith(".css"),
    find: (text) => {
      // Arbitrary color utility: bg-[#fff], text-[#123456], border-[rgb(...)]
      if (/\b(?:bg|text|border|ring|fill|stroke|outline|decoration|from|via|to|shadow|accent|caret|divide|ring-offset)-\[(?:#|rgb|hsl)/i.test(text)) {
        return "arbitrary Tailwind color value — use a token from the src/index.css `@theme` block instead (Rule 14).";
      }
      // Raw hex literal inside a className template.
      if (/className\s*=\s*[`'"][^`'"]*#[0-9a-fA-F]{3,8}\b/.test(text)) {
        return "hardcoded hex color in className — use a `@theme` token (Rule 14).";
      }
      return null;
    },
  },
  {
    id: "i18n-jsx",
    description: "User-facing JSX text must go through `useTranslator` (Rule 13).",
    applies: (p) => isTsx(p),
    find: (text) => {
      const t = text.trim();
      if (!t || t.startsWith("//") || t.startsWith("*")) return null;
      if (/useTranslator|translate\s*\(|i18nKey|aria-|data-/.test(t)) return null;
      // JSX text node: >Human readable text< with no embedded expression.
      const m = t.match(/>\s*([^<>{}]*?[A-Za-z]{2,}[^<>{}]*?)\s*</);
      if (!m) return null;
      const inner = m[1].trim();
      // Skip single short tokens / all-caps consts / pure punctuation+digits.
      if (inner.length < 4 && !inner.includes(" ")) return null;
      if (/^[A-Z0-9_ ]+$/.test(inner) && !inner.includes(" ")) return null;
      return `hardcoded user-facing text "${inner.slice(0, 40)}" — wrap it in useTranslator (Rule 13).`;
    },
  },
];

const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Doc-coverage extractors (shared with generateProjectIndex.mjs /
// generateProductOverview.mjs — kept inline here to preserve this script's
// zero-import, pure-Node contract). A NEW route/page that lands without its
// mandated doc lines (Rules 12 / 15a / 15b) is the silent-drift failure the
// auto-generated indexes render as "—" but never block on. The coverage gate
// turns that into a diff-time finding — but ONLY for files this change ADDS,
// so a pre-existing undocumented codebase is never retroactively blocked.
// ---------------------------------------------------------------------------

const extractFileSummary = (src) => {
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (raw.startsWith("/**")) {
      const single = raw.match(/^\/\*\*\s*(.+?)\s*\*\/$/);
      if (single) return single[1];
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
    if (raw.startsWith("//?")) return raw.replace(/^\/\/\?\s*/, "").trim();
    if (raw.startsWith("//")) return raw.replace(/^\/\/+\s*/, "").trim();
    return null;
  }
  return null;
};

const extractDocsOwner = (src) => {
  const block = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!block) return null;
  const m = block[1].match(/@docs\s+owner\s+([^\n*]+)/);
  return m ? m[1].trim() : null;
};

const extractIntent = (src) => {
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/^\s*\/\/\??\s*intent:\s*\S/i.test(lines[i])) return lines[i].replace(/^\s*\/\/\??\s*intent:\s*/i, "").trim();
  }
  return null;
};

const ROUTE_API_RE = /(^|\/)_api\/[^/]+_v\d+\.ts$/;
const ROUTE_SYNC_RE = /(^|\/)_sync\/[^/]+_(server|client)_v\d+\.ts$/;
const PAGE_RE = /(^|\/)page\.tsx$/;
const isRouteFile = (p) => (ROUTE_API_RE.test(p) || ROUTE_SYNC_RE.test(p)) && !p.endsWith(".tests.ts") && !p.endsWith(".generated.ts");

// ---------------------------------------------------------------------------
// Per-line scan (exported for tests). Honors an inline suppression:
//   ... // luckystack-allow <rule>: <reason>   (or `*` for all rules)
// ---------------------------------------------------------------------------

export const suppressedRules = (text) => {
  const out = new Set();
  const m = text.match(/\/\/\s*luckystack-allow\s+([A-Za-z0-9_,*-]+)/);
  if (!m) return out;
  for (const r of m[1].split(",")) out.add(r.trim());
  return out;
};

export const checkLine = (relPath, text) => {
  const suppressed = suppressedRules(text);
  const findings = [];
  for (const rule of RULES) {
    if (!rule.applies(relPath)) continue;
    if (suppressed.has(rule.id) || suppressed.has("*")) continue;
    const message = rule.find(text);
    if (message) findings.push({ rule: rule.id, message });
  }
  return findings;
};

// ---------------------------------------------------------------------------
// Config + severity
// ---------------------------------------------------------------------------

const loadConfig = async () => {
  const [err, raw] = await safe(fs.readFile(CONFIG_FILE, "utf8"));
  if (err) return { block: [], warn: [] };
  const [parseErr, parsed] = safeSync(() => JSON.parse(raw));
  if (parseErr || !parsed) return { block: [], warn: [] };
  return { block: Array.isArray(parsed.block) ? parsed.block : [], warn: Array.isArray(parsed.warn) ? parsed.warn : [] };
};

const safe = async (promise) => { try { return [null, await promise]; } catch (e) { return [e, null]; } };
const safeSync = (fn) => { try { return [null, fn()]; } catch (e) { return [e, null]; } };

// ---------------------------------------------------------------------------
// Input collection
// ---------------------------------------------------------------------------

// Added lines of the staged diff, as [{ file, line, text }]. Uses -U0 so only
// changed lines appear; tracks the +++ b/<path> header and the hunk @@ line
// numbers so each added line carries its real line number.
const stagedAddedLines = () => {
  let raw;
  try {
    raw = execFileSync("git", ["diff", "--cached", "--unified=0", "--no-color", "--diff-filter=ACM"], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch { return []; }
  const out = [];
  let file = null;
  let lineNo = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const m = line.match(/^\+\+\+ b\/(.*)$/);
      file = m ? m[1] : null;
      continue;
    }
    if (line.startsWith("@@")) {
      const m = line.match(/\+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (file && line.startsWith("+") && !line.startsWith("+++")) {
      out.push({ file, line: lineNo, text: line.slice(1) });
      lineNo++;
    }
  }
  return out;
};

const wholeFileLines = async (relPaths) => {
  const out = [];
  for (const rel of relPaths) {
    const abs = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
    const [err, content] = await safe(fs.readFile(abs, "utf8"));
    if (err || content === null) continue;
    const relPosix = path.relative(REPO_ROOT, abs).replaceAll("\\", "/");
    content.split(/\r?\n/).forEach((text, i) => out.push({ file: relPosix, line: i + 1, text }));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Doc-coverage gate (DD-doc-coverage)
//
// Asserts that a NEWLY-ADDED route/page carries the docs its CLAUDE.md rule
// mandates, so documentation can't silently drift to optional:
//   - _api/<name>_v<N>.ts / _sync/<name>_(server|client)_v<N>.ts
//       → a top-of-file summary line (Rule 12) AND an `@docs owner` tag (Rule 15b)
//   - page.tsx
//       → a `//? intent: …` line (Rule 15a)
// Diff-scoped to ADDED files (git --diff-filter=A) so existing undocumented
// code is never retroactively blocked. WARN by default; opt a project into
// blocking via luckystack.invariants.json. Escape hatch on the file's first
// line: `// luckystack-allow doc-coverage: <reason>`.
// ---------------------------------------------------------------------------

const stagedAddedFiles = () => {
  try {
    const raw = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=A", "--no-color"], { cwd: REPO_ROOT, encoding: "utf8" });
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

export const checkDocCoverageFile = (relPath, src) => {
  const findings = [];
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  if (suppressedRules(firstLine).has("doc-coverage") || suppressedRules(firstLine).has("*")) return findings;
  if (isRouteFile(relPath)) {
    if (extractFileSummary(src) === null) {
      findings.push({ file: relPath, line: 1, rule: "doc-coverage", message: "new route has no top-of-file summary — add a `//?` or `//` one-liner describing what it does (Rule 12)." });
    }
    if (extractDocsOwner(src) === null) {
      findings.push({ file: relPath, line: 1, rule: "doc-coverage", message: "new route has no `@docs owner <name>` JSDoc tag — record ownership from day one (Rule 15b)." });
    }
  } else if (PAGE_RE.test(relPath)) {
    if (extractIntent(src) === null) {
      findings.push({ file: relPath, line: 1, rule: "doc-coverage", message: "new page.tsx has no `//? intent: …` line — state in plain language what the page is FOR (Rule 15a)." });
    }
  }
  return findings;
};

export const checkDocCoverage = async () => {
  const added = stagedAddedFiles().filter((p) => isRouteFile(p) || PAGE_RE.test(p));
  const findings = [];
  for (const rel of added) {
    const [err, src] = await safe(fs.readFile(path.join(REPO_ROOT, rel), "utf8"));
    if (err || src === null) continue;
    findings.push(...checkDocCoverageFile(rel, src));
  }
  return findings;
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// Committed fixture assertions for the per-line checks (Rule 1a — the verifiable
// goal travels with the code). Run: `npm run ai:lint -- --selftest`.
const runSelfTest = () => {
  const cases = [
    ["as any flagged", checkLine("src/foo.ts", "const x = y as any;").some((f) => f.rule === "no-as-any")],
    ["as unknown as flagged", checkLine("src/foo.ts", "return z as unknown as Thing;").some((f) => f.rule === "no-as-any")],
    ["clean line ok", checkLine("src/foo.ts", "const total = a + b;").length === 0],
    ["suppression works", checkLine("src/foo.ts", "const x = y as any; // luckystack-allow no-as-any: legacy shim").length === 0],
    ["i18n jsx flagged", checkLine("src/p.tsx", "      <div>Welcome back to your dashboard</div>").some((f) => f.rule === "i18n-jsx")],
    ["translated jsx ok", checkLine("src/p.tsx", "      <div>{translate({ key: 'x' })}</div>").every((f) => f.rule !== "i18n-jsx")],
    ["arbitrary color flagged", checkLine("src/p.tsx", "className={`bg-[#ffffff] p-4`}").some((f) => f.rule === "no-arbitrary-color")],
    ["theme token ok", checkLine("src/p.tsx", "className={`bg-primary text-title p-4`}").every((f) => f.rule !== "no-arbitrary-color")],
    ["generated file skipped", checkLine("src/_sockets/apiTypes.generated.ts", "const x = y as any;").length === 0],
    ["request-wrapper message", checkLine("src/foo.ts", "apiRequest({ name: n as any });").some((f) => f.rule === "no-as-any" && /wrap/.test(f.message))],
    ["doc-coverage: api missing summary+owner", checkDocCoverageFile("src/x/_api/get_v1.ts", "export const main = () => {};").length === 2],
    ["doc-coverage: api complete ok", checkDocCoverageFile("src/x/_api/get_v1.ts", "//? Fetch a user.\n/** @docs owner alice */\nexport const main = () => {};").length === 0],
    ["doc-coverage: page missing intent", checkDocCoverageFile("src/x/page.tsx", "export default function Page() { return null; }").some((f) => f.rule === "doc-coverage")],
    ["doc-coverage: page with intent ok", checkDocCoverageFile("src/x/page.tsx", "//? intent: the user dashboard\nexport default function Page() {}").length === 0],
    ["doc-coverage: suppression works", checkDocCoverageFile("src/x/_api/get_v1.ts", "// luckystack-allow doc-coverage: scaffold stub\nexport const main = () => {};").length === 0],
    ["doc-coverage: non-route ignored", checkDocCoverageFile("src/x/_functions/foo.ts", "export const foo = 1;").length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) { failed++; console.error(`[ai:lint] selftest FAIL: ${name}`); } }
  console.log(`[ai:lint] selftest: ${cases.length - failed}/${cases.length} passed`);
  if (failed > 0) process.exit(1);
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) { runSelfTest(); return; }
  const pathsIdx = argv.indexOf("--paths");
  const config = await loadConfig();

  const inputLines = pathsIdx !== -1
    ? await wholeFileLines(argv.slice(pathsIdx + 1))
    : stagedAddedLines();

  const findings = [];
  for (const { file, line, text } of inputLines) {
    for (const f of checkLine(file, text)) {
      const severity = config.block.includes(f.rule) ? "block" : "warn";
      findings.push({ file, line, rule: f.rule, message: f.message, severity });
    }
  }

  // DD-doc-coverage: new route/page must carry its mandated doc lines. Diff-based
  // (added files), so only runs in the default staged-diff mode, not --paths.
  if (pathsIdx === -1) {
    const coverageFindings = await checkDocCoverage();
    for (const f of coverageFindings) {
      findings.push({ ...f, severity: config.block.includes(f.rule) ? "block" : "warn" });
    }
  }

  if (findings.length === 0) {
    console.log("[ai:lint] no invariant violations in scope.");
    console.log("[ai:lint] note: peer-dep-guard presence (configured-but-not-installed = hard boot crash) is a review-only invariant — not auto-checked here.");
    return;
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  const blocking = findings.filter((f) => f.severity === "block");
  console.log(`[ai:lint] ${findings.length} invariant finding(s) (${blocking.length} blocking, ${findings.length - blocking.length} warning):\n`);
  for (const f of findings) {
    const tag = f.severity === "block" ? "BLOCK" : "warn ";
    console.log(`  [${tag}] ${f.file}:${f.line}  ${f.rule}`);
    console.log(`          ${f.message}`);
  }
  console.log("\n  Suppress a conscious deviation with:  // luckystack-allow <rule>: <reason>");
  console.log("  Make a rule blocking in luckystack.invariants.json (\"block\": [\"<rule>\"]).");

  if (blocking.length > 0) process.exit(1);
};

// Only run when invoked directly (the tests import checkLine without side effects).
const isEntry = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isEntry) {
  const [runErr] = await safe(main());
  if (runErr) {
    safeSync(() => console.error(`[ai:lint] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
    process.exit(1);
  }
}
