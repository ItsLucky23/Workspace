// scripts/generateLessonsIndex.mjs
//
// Regenerates docs/AI_LESSONS_INDEX.md — the project-wide, committed record of
// "what we tried, what FAILED, and why" (the pitfalls layer).
//
// Distinct from the other memory surfaces — keep them separate:
//   - docs/decisions/  = WHY it is this way / why-not-Y (durable choice).
//   - branch-logs/      = WHAT happened, per prompt (the firehose).
//   - docs/lessons/     = what FAILED and the takeaway (this file's source).
// Branch-logs are per-branch; the per-developer ~/.claude memory is private and
// uncommitted; neither is a shared, searchable, project-wide pitfalls layer —
// so the same dead-ends get rediscovered. This is that missing layer.
//
// Source of truth: docs/lessons/NNNN-slug.md (one lesson per file, frontmatter +
// narrative). The template seed (0000-template.md) is skipped. The MCP tools
// `list_lessons` / `find_lesson` / `get_lesson` query the result.
//
// Pure-Node ESM. Deterministic (no timestamps) — a no-op commit leaves the
// output byte-identical. Mirrors generateDecisionsIndex.mjs exactly.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateLessonsIndex.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LESSONS_DIR = path.join(REPO_ROOT, "docs", "lessons");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "AI_LESSONS_INDEX.md");

const safe = async (promise) => { try { return [null, await promise]; } catch (error) { return [error, null]; } };
const safeSync = (fn) => { try { return [null, fn()]; } catch (error) { return [error, null]; } };
const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const parseInlineArray = (raw) => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return null;
  const inner = trimmed.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
};

const parseFrontmatter = (src) => {
  const match = src.match(FRONTMATTER_RE);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const asArray = parseInlineArray(m[2].trim());
    out[m[1]] = asArray !== null ? asArray : m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
};

const extractSection = (src, heading) => {
  const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\r\\n]))`, "mi");
  const m = src.match(re);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;
  const paragraph = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) { if (paragraph.length > 0) break; else continue; }
    paragraph.push(t.replace(/^[-*]\s*/, ""));
  }
  return paragraph.length > 0 ? paragraph.join(" ") : null;
};

const LESSON_FILE_RE = /^(\d{4})-([A-Za-z0-9][A-Za-z0-9-]*)\.md$/;

const scanLessons = async () => {
  const [readErr, entries] = await safe(fs.readdir(LESSONS_DIR, { withFileTypes: true }));
  if (readErr) return [];
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fm = entry.name.match(LESSON_FILE_RE);
    if (!fm) continue;
    if (fm[1] === "0000") continue; // template seed
    const abs = path.join(LESSONS_DIR, entry.name);
    const [err, src] = await safe(fs.readFile(abs, "utf8"));
    if (err || src === null) continue;
    const front = parseFrontmatter(src) ?? {};
    rows.push({
      number: fm[1],
      slug: fm[2],
      file: relFromRepo(abs),
      title: typeof front.title === "string" ? front.title : fm[2].replaceAll("-", " "),
      severity: typeof front.severity === "string" ? front.severity : "medium",
      area: typeof front.area === "string" ? front.area : "",
      date: typeof front.date === "string" ? front.date : "",
      tags: Array.isArray(front.tags) ? front.tags : [],
      // The takeaway: prefer "How to avoid", fall back to "Lesson" / "Takeaway".
      takeaway: extractSection(src, "How to avoid") ?? extractSection(src, "Lesson") ?? extractSection(src, "Takeaway"),
    });
  }
  return rows.sort((a, b) => a.number.localeCompare(b.number));
};

const escapeCell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ").trim();

const SEVERITY_BADGE = {
  low: "🟢 low",
  medium: "🟡 medium",
  high: "🟠 high",
  critical: "🔴 critical",
};

const renderTable = (header, rows) => {
  if (rows.length === 0) return "_(none)_";
  const out = [];
  out.push(`| ${header.join(" | ")} |`);
  out.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) out.push(`| ${row.map(escapeCell).join(" | ")} |`);
  return out.join("\n");
};

const buildDocument = (rows) => {
  const parts = [];
  parts.push("# Lessons Index");
  parts.push("");
  parts.push("> Auto-generated by `scripts/generateLessonsIndex.mjs` — regenerate via `npm run ai:lessons`.");
  parts.push("> Hand edits will be overwritten — edit the lesson files in `docs/lessons/` instead.");
  parts.push(">");
  parts.push("> The committed, project-wide record of **what failed and why** — so the same dead-end isn't");
  parts.push("> rediscovered every few sessions. Read this before retrying something that smells hard.");
  parts.push("> Distinct from `docs/decisions/` (why-a-choice), `branch-logs/` (what-happened-per-prompt),");
  parts.push("> and the private per-dev `~/.claude` memory. The AI records these automatically — see");
  parts.push("> `docs/LESSONS_PROTOCOL.md`.");
  parts.push("");
  parts.push(`## Lessons (${rows.length})`);
  parts.push("");
  if (rows.length === 0) {
    parts.push("_(none yet — the AI records a lesson when a non-obvious dead-end or pitfall is hit. See `docs/lessons/0000-template.md` + `docs/LESSONS_PROTOCOL.md`. On an existing project with hard-won history, the AI offers to backfill this from git + a short interview.)_");
    parts.push("");
    return parts.join("\n");
  }
  parts.push(
    renderTable(
      ["#", "Lesson", "Severity", "Area", "Tags", "File"],
      rows.map((r) => [
        r.number,
        r.title,
        SEVERITY_BADGE[r.severity] ?? r.severity,
        r.area || "—",
        r.tags.length ? r.tags.join(", ") : "—",
        `\`${r.file}\``,
      ]),
    ),
  );
  parts.push("");
  parts.push("## Takeaways");
  parts.push("");
  for (const r of rows) {
    const meta = [`**${r.number}**`, r.severity, r.area || null, r.tags.length ? `tags: ${r.tags.join(", ")}` : null, r.date || null].filter(Boolean).join(" · ");
    parts.push(`### ${r.number} — ${r.title}`);
    parts.push("");
    parts.push(meta);
    parts.push("");
    parts.push(r.takeaway ? r.takeaway : "_(no How-to-avoid / Lesson section found — fill it in)_");
    parts.push("");
    parts.push(`→ \`${r.file}\``);
    parts.push("");
  }
  return parts.join("\n");
};

const main = async () => {
  const rows = await scanLessons();
  const document = buildDocument(rows);
  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) { console.error(`[ai:lessons] failed to ensure docs directory: ${mkErr.message}`); process.exit(1); }
  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, document, "utf8"));
  if (writeErr) { console.error(`[ai:lessons] failed to write ${OUTPUT_FILE}: ${writeErr.message}`); process.exit(1); }
  console.log(`[ai:lessons] generated ${relFromRepo(OUTPUT_FILE)} (${rows.length} lesson${rows.length === 1 ? "" : "s"})`);
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:lessons] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
