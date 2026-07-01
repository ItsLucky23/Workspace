// eval/scoreEval.mjs
//
// The AI-context EVAL harness scorer (npm run ai:eval).
//
// Answers the question nothing else in this repo answers: do the committed
// AI-context artifacts actually make the AI's output better? It is the hard
// measurement ADR 0003 requires BEFORE any RAG rung is built — if the existing
// structured rungs (graph + indexes + decisions + lessons + examples) already
// score well on natural-language recall, RAG is not justified yet.
//
// Design: deterministic, no LLM in the loop. A scenario (eval/scenarios/*.json)
// declares a `prompt` and the MEASURABLE properties a good answer should have
// (`expects`). You run that prompt in Claude Code — once WITH the artifacts/MCP
// available and once WITHOUT — and capture what the agent did as a small
// "candidate" record (which MCP tools it called, whether it reused an existing
// helper, which ADR it cited, whether it stayed within the parity rules, whether
// it added a test). This scorer compares the candidate to `expects` and reports
// a score. Comparing the with/without scores is the artifact-value signal.
//
// Candidate record shape (JSON):
//   { "toolsUsed": ["get_capability"], "reusedHelper": true, "citedAdr": "0007",
//     "addedTest": true, "stayedInParity": true, "citedRoutes": ["api/.../v1"] }
//
// Pure-Node ESM. `--selftest` proves the scoring logic with inline fixtures.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(SCRIPT_DIR, "scenarios");

const safe = async (promise) => { try { return [null, await promise]; } catch (e) { return [e, null]; } };

// ---------------------------------------------------------------------------
// Checkers — each `expects` key maps to a predicate over the candidate record.
// Exported so the selftest (and tests) can assert them without files.
// ---------------------------------------------------------------------------

export const CHECKERS = {
  // Every listed tool must appear in candidate.toolsUsed.
  usesTools: (cand, want) => Array.isArray(want) && want.every((t) => (cand.toolsUsed ?? []).includes(t)),
  // At least one of the listed tools must appear.
  usesAnyTool: (cand, want) => Array.isArray(want) && want.some((t) => (cand.toolsUsed ?? []).includes(t)),
  reusedHelper: (cand, want) => Boolean(cand.reusedHelper) === Boolean(want),
  citedAdr: (cand, want) => String(cand.citedAdr ?? "").padStart(4, "0") === String(want).padStart(4, "0"),
  addedTest: (cand, want) => Boolean(cand.addedTest) === Boolean(want),
  stayedInParity: (cand, want) => Boolean(cand.stayedInParity) === Boolean(want),
  citedRoutesNonEmpty: (cand, want) => (Array.isArray(cand.citedRoutes) && cand.citedRoutes.length > 0) === Boolean(want),
};

// Score one candidate against one scenario's `expects`. Returns per-check
// results + an overall { passed, total, score }.
export const scoreCandidate = (scenario, candidate) => {
  const expects = scenario.expects ?? {};
  const results = [];
  for (const [key, want] of Object.entries(expects)) {
    const checker = CHECKERS[key];
    const ok = checker ? checker(candidate, want) : false;
    results.push({ check: key, want, ok, known: Boolean(checker) });
  }
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  return { id: scenario.id, results, passed, total, score: total === 0 ? 1 : passed / total };
};

// ---------------------------------------------------------------------------
// Scenario loading
// ---------------------------------------------------------------------------

const loadScenarios = async () => {
  const [err, files] = await safe(fs.readdir(SCENARIOS_DIR));
  if (err) return [];
  const out = [];
  for (const f of files.filter((n) => n.endsWith(".json")).sort()) {
    const [, raw] = await safe(fs.readFile(path.join(SCENARIOS_DIR, f), "utf8"));
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch { /* skip malformed scenario */ }
  }
  return out;
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const runSelfTest = () => {
  const scenario = {
    id: "selftest",
    expects: { usesAnyTool: ["get_capability", "get_example"], reusedHelper: true, citedAdr: "7", addedTest: true },
  };
  const good = scoreCandidate(scenario, { toolsUsed: ["get_capability"], reusedHelper: true, citedAdr: "0007", addedTest: true });
  const bad = scoreCandidate(scenario, { toolsUsed: [], reusedHelper: false, citedAdr: "0003", addedTest: false });
  const cases = [
    ["perfect candidate scores 1", good.score === 1],
    ["empty candidate scores 0", bad.score === 0],
    ["adr padding match", CHECKERS.citedAdr({ citedAdr: "7" }, "0007") === true],
    ["usesTools all-required", CHECKERS.usesTools({ toolsUsed: ["a"] }, ["a", "b"]) === false],
  ];
  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) { failed++; console.error(`[ai:eval] selftest FAIL: ${name}`); } }
  console.log(`[ai:eval] selftest: ${cases.length - failed}/${cases.length} passed`);
  if (failed > 0) process.exit(1);
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) { runSelfTest(); return; }

  const scenarios = await loadScenarios();
  const candIdx = argv.indexOf("--candidate");
  const scenIdx = argv.indexOf("--scenario");

  if (candIdx === -1) {
    // No candidate supplied — list the golden set so a runner knows what to drive.
    console.log(`[ai:eval] ${scenarios.length} scenario(s) in the golden set:\n`);
    for (const s of scenarios) {
      console.log(`  ${s.id}`);
      console.log(`    prompt:  ${s.prompt}`);
      console.log(`    expects: ${Object.keys(s.expects ?? {}).join(", ") || "(none)"}`);
    }
    console.log("\n  Run a scenario's prompt in Claude Code (with AND without the artifacts),");
    console.log("  capture a candidate record, then: npm run ai:eval -- --scenario <id> --candidate <file.json>");
    return;
  }

  const id = scenIdx !== -1 ? argv[scenIdx + 1] : null;
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) { console.error(`[ai:eval] no scenario "${id}". Run \`npm run ai:eval\` to list them.`); process.exit(1); }
  const [err, raw] = await safe(fs.readFile(argv[candIdx + 1], "utf8"));
  if (err) { console.error(`[ai:eval] cannot read candidate ${argv[candIdx + 1]}: ${err.message}`); process.exit(1); }
  let candidate;
  try { candidate = JSON.parse(raw); } catch (e) { console.error(`[ai:eval] candidate is not valid JSON: ${e.message}`); process.exit(1); }

  const result = scoreCandidate(scenario, candidate);
  console.log(`[ai:eval] scenario "${result.id}": ${result.passed}/${result.total} checks (score ${(result.score * 100).toFixed(0)}%)\n`);
  for (const r of result.results) {
    const tag = r.ok ? "PASS" : (r.known ? "FAIL" : "????");
    console.log(`  [${tag}] ${r.check} (want ${JSON.stringify(r.want)})`);
  }
};

const [runErr] = await safe(main());
if (runErr) { console.error(`[ai:eval] fatal: ${runErr.stack ?? runErr.message ?? runErr}`); process.exit(1); }
