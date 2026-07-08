// scripts/generateProductKnowledge.mjs
//
// Compiles the PRODUCT SELF-KNOWLEDGE corpus the in-app Workspace-AI retrieves from (Q-fase,
// AI_LIBRARIES_ACCOUNTS_PROGRAM.md). Two sources:
//   1. docs/product-knowledge/capabilities.md  — hand-curated "what can this product do + how" Q&A
//      (each `### Q:` block = one chunk). This is what makes "can we edit videos?" answerable.
//   2. docs/decisions/*.md                      — every ADR (title + Context/Decision summary = one chunk),
//      so the AI can explain WHY something is the way it is.
// Emits:
//   - docs/AI_PRODUCT_KNOWLEDGE.md   (human-readable digest)
//   - docs/AI_PRODUCT_KNOWLEDGE.json ({ hash, chunks: [{id, kind, title, text}] }) — the embedding input.
// The `hash` is a content digest so the runtime boot-ensure re-embeds only when the corpus changed
// (Q2 indexProductKnowledge). Pure-Node ESM, no framework imports (runs in the pre-commit context),
// deterministic (no timestamps) so a no-op run is byte-identical.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CAP_FILE = path.join(REPO_ROOT, "docs", "product-knowledge", "capabilities.md");
const DECISIONS_DIR = path.join(REPO_ROOT, "docs", "decisions");
const OUT_MD = path.join(REPO_ROOT, "docs", "AI_PRODUCT_KNOWLEDGE.md");
const OUT_JSON = path.join(REPO_ROOT, "docs", "AI_PRODUCT_KNOWLEDGE.json");

const MAX_CHUNK = 1500; // chars — keep each chunk embeddable + focused

async function safeRead(file) {
  try { return await fs.readFile(file, "utf8"); } catch { return null; }
}

// ---- capability Q&A → chunks ----------------------------------------------------------------------
function capabilityChunks(md) {
  if (!md) return [];
  const chunks = [];
  // Split on `### Q:` headings; each block is a Q + its answer.
  const parts = md.split(/\n(?=### Q:)/);
  let n = 0;
  for (const part of parts) {
    const m = /^### Q:\s*(.+)/.exec(part.trim());
    if (!m) continue;
    n += 1;
    const title = m[1].trim();
    const text = part.trim().replace(/^###\s*/, "").slice(0, MAX_CHUNK);
    chunks.push({ id: `cap-${String(n).padStart(3, "0")}`, kind: "capability", title, text });
  }
  return chunks;
}

// ---- ADRs → chunks --------------------------------------------------------------------------------
function frontmatterTitle(md) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!fm) return null;
  const t = /^title:\s*(.+)$/m.exec(fm[1]);
  return t ? t[1].trim() : null;
}
function sectionBody(md, heading) {
  const re = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  const m = re.exec(md);
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}
async function decisionChunks() {
  let files;
  try { files = await fs.readdir(DECISIONS_DIR); } catch { return []; }
  const chunks = [];
  for (const f of files.sort()) {
    if (!/^\d{4}-.+\.md$/.test(f) || f.startsWith("0000-")) continue;
    const md = await safeRead(path.join(DECISIONS_DIR, f));
    if (!md) continue;
    const id = f.slice(0, 4);
    const title = frontmatterTitle(md) ?? f.replace(/\.md$/, "");
    const context = sectionBody(md, "Context");
    const decision = sectionBody(md, "Decision");
    const text = `ADR ${id}: ${title}. ${context} Decision: ${decision}`.slice(0, MAX_CHUNK);
    chunks.push({ id: `adr-${id}`, kind: "decision", title, text });
  }
  return chunks;
}

async function main() {
  const cap = await safeRead(CAP_FILE);
  const chunks = [...capabilityChunks(cap), ...(await decisionChunks())];
  const hash = crypto.createHash("sha256").update(JSON.stringify(chunks)).digest("hex").slice(0, 16);

  const json = { hash, chunkCount: chunks.length, chunks };
  await fs.writeFile(OUT_JSON, JSON.stringify(json, null, 2) + "\n", "utf8");

  const capCount = chunks.filter((c) => c.kind === "capability").length;
  const adrCount = chunks.filter((c) => c.kind === "decision").length;
  const md = [
    "# AI Product Knowledge (auto-generated — do not edit)",
    "",
    "> The in-app Workspace-AI retrieves this corpus at chat-time (product self-knowledge). Source:",
    "> `docs/product-knowledge/capabilities.md` (hand Q&A) + `docs/decisions/*.md` (ADRs). Regenerate with",
    "> `npm run ai:product-knowledge`. Corpus hash: `" + hash + "` · " + capCount + " capabilities · " + adrCount + " decisions.",
    "",
    "## Capabilities (what the product can do)",
    "",
    ...chunks.filter((c) => c.kind === "capability").map((c) => `- **${c.title}**`),
    "",
    "## Decisions (why it is the way it is)",
    "",
    ...chunks.filter((c) => c.kind === "decision").map((c) => `- \`${c.id}\` ${c.title}`),
    "",
  ].join("\n");
  await fs.writeFile(OUT_MD, md, "utf8");

  console.log(`[ai:product-knowledge] generated ${path.relative(REPO_ROOT, OUT_JSON)} + ${path.relative(REPO_ROOT, OUT_MD)} (${chunks.length} chunks: ${capCount} capabilities + ${adrCount} decisions, hash ${hash})`);
}

main().catch((e) => { console.error("[ai:product-knowledge] failed:", e); process.exit(1); });
