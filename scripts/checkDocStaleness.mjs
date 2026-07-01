// scripts/checkDocStaleness.mjs
//
// Report-only staleness check for HAND-WRITTEN docs (npm run ai:doc-staleness).
//
// The auto-generated indexes can never drift — the pre-commit hook regenerates
// them from code every commit. But a hand-written deep-dive (ARCHITECTURE_*.md,
// a per-package CLAUDE.md) can silently rot: the code it describes moves on and
// nothing signals it. graph_status already does mtime-staleness, but ONLY for
// docs/ai-graph.json vs src/. This generalises that idea to any prose doc.
//
// Mechanism: a doc OPTS IN by carrying a marker near the top —
//   <!-- @covers packages/sync/src, docs/ARCHITECTURE_SYNC.md -->
// (an HTML comment, invisible in rendered markdown). The check then asks git:
// "how many commits have touched the covered code paths SINCE this doc was last
// committed?" If that count crosses docs.stalenessThreshold (luckystack.ai.json),
// it reports the doc as STALE with the count.
//
// OPT-IN by design: a doc with no @covers marker is skipped, so this never
// fires on an existing codebase until someone wires a doc to its code. Always
// exits 0 — it is a NUDGE, not a gate (mirrors the report-only default of the
// ai:lint per-line rules). Pure-Node ESM, no framework imports.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// checkDocStaleness.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const AI_CONFIG = path.join(REPO_ROOT, "luckystack.ai.json");

const safe = async (promise) => { try { return [null, await promise]; } catch (e) { return [e, null]; } };
const safeSync = (fn) => { try { return [null, fn()]; } catch (e) { return [e, null]; } };
const toPosix = (p) => p.replaceAll("\\", "/");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const loadThreshold = async () => {
  const [err, raw] = await safe(fs.readFile(AI_CONFIG, "utf8"));
  if (err) return 5;
  const [, parsed] = safeSync(() => JSON.parse(raw));
  const t = parsed?.docs?.stalenessThreshold;
  return Number.isInteger(t) && t >= 0 ? t : 5;
};

// ---------------------------------------------------------------------------
// Git helpers (report-only; any failure degrades to "skip this doc")
// ---------------------------------------------------------------------------

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

// Last commit hash + unix-time that touched a given repo-relative path.
const lastCommit = (relPath) => {
  const out = git(["log", "-1", "--format=%H %ct", "--", relPath]);
  if (!out) return null;
  const [hash, ct] = out.split(/\s+/);
  return hash ? { hash, ct: Number(ct) } : null;
};

// Count commits touching `paths` in the range (sinceHash, HEAD].
const commitsSince = (sinceHash, paths) => {
  const out = git(["rev-list", "--count", `${sinceHash}..HEAD`, "--", ...paths]);
  return out === null ? null : Number(out);
};

// ---------------------------------------------------------------------------
// Doc discovery
// ---------------------------------------------------------------------------

const COVERS_RE = /<!--\s*@covers\s+([^>]+?)\s*-->/;

// Candidate hand-written docs: docs/**/*.md (excluding the AI_* generated ones
// and decisions/, which are governed separately) + packages/*/CLAUDE.md.
const collectDocs = async () => {
  const out = [];
  const walk = async (dir) => {
    const [, entries] = await safe(fs.readdir(dir, { withFileTypes: true }));
    if (!entries) return;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        await walk(full);
      } else if (e.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  await walk(path.join(REPO_ROOT, "docs"));
  // per-package CLAUDE.md
  const [, pkgs] = await safe(fs.readdir(path.join(REPO_ROOT, "packages"), { withFileTypes: true }));
  for (const p of pkgs ?? []) {
    if (p.isDirectory()) out.push(path.join(REPO_ROOT, "packages", p.name, "CLAUDE.md"));
  }
  return out;
};

// Parse the @covers marker (first 40 lines) → list of repo-relative path globs,
// with trailing /** or /* stripped to a directory/file pathspec git understands.
const parseCovers = (src) => {
  const head = src.split(/\r?\n/).slice(0, 40).join("\n");
  const m = head.match(COVERS_RE);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/\/\*+$/, "").replace(/\/+$/, ""))
    .filter(Boolean);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const threshold = await loadThreshold();
  const docs = await collectDocs();
  const reports = [];
  let wired = 0;

  for (const abs of docs) {
    const [, src] = await safe(fs.readFile(abs, "utf8"));
    if (!src) continue;
    const covers = parseCovers(src);
    if (!covers || covers.length === 0) continue;
    wired++;
    const rel = toPosix(path.relative(REPO_ROOT, abs));
    const docCommit = lastCommit(rel);
    if (!docCommit) continue; // uncommitted/new doc — can't be stale
    const behind = commitsSince(docCommit.hash, covers);
    if (behind === null) continue;
    if (behind >= threshold && behind > 0) {
      reports.push({ rel, behind, covers });
    }
  }

  if (wired === 0) {
    console.log("[ai:doc-staleness] no docs carry an `<!-- @covers … -->` marker yet — nothing to check.");
    console.log("[ai:doc-staleness] wire a hand-written doc to the code it describes to enable the nudge.");
    return;
  }
  if (reports.length === 0) {
    console.log(`[ai:doc-staleness] ${wired} wired doc(s) checked — all within ${threshold} commit(s) of their code.`);
    return;
  }

  reports.sort((a, b) => b.behind - a.behind);
  console.log(`[ai:doc-staleness] ${reports.length} of ${wired} wired doc(s) may be STALE (threshold ${threshold} commits):\n`);
  for (const r of reports) {
    console.log(`  [STALE] ${r.rel}`);
    console.log(`          ${r.behind} commit(s) to covered code since this doc was last updated`);
    console.log(`          covers: ${r.covers.join(", ")}`);
  }
  console.log("\n  Report-only — review whether the doc still matches the code, then update + commit it.");
  console.log("  Tune the threshold via `docs.stalenessThreshold` in luckystack.ai.json.");
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:doc-staleness] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  // Report-only: never fail the commit even on an internal error.
}
