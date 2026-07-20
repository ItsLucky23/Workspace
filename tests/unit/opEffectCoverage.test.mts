//? Op-EFFECT coverage guard (owner decision 2026-07-20, companion to tests/unit/opCatalogParity.test.mts
//? which only checks param/RBAC shape). Locks tests/effectMatrix.mts to ENABLED_OPS 1:1 and spot-checks
//? that 'covered' rows actually cite real, existing evidence — so the matrix cannot silently drift stale
//? or a newly-enabled op cannot silently ship with no classification at all. Since the 2026-07-20 fill
//? wave closed every assertable gap, this also GATES on zero remaining 'gap' rows — from here on, 'gap'
//? is a temporary in-session state to be resolved (filled or reclassified to 'excluded:bug'), never a
//? committed one.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assert, eq, report } from '../_helpers.mts';
import { ENABLED_OPS } from '../../server/ai/opCatalog';
import { EFFECT_MATRIX, type EffectRow } from '../effectMatrix.mts';

//? Extracts every candidate proving-file path cited in a free-text `ref`/`reason` string. Covers both
//? test-file layouts used across the repo (tests/integration|unit/*.test.mts and the per-route
//? src/workspaces/_sync|_api/*.tests.ts convention).
const FILE_RE = /(?:tests\/(?:integration|unit)\/[\w.-]+\.test\.mts|src\/workspaces\/(?:_sync|_api)\/[\w.-]+\.tests\.ts)/g;
//? Extracts quoted 'case name'-shaped substrings (>=15 chars so it doesn't just match the op's own name
//? in quotes, e.g. "op 'ai-skill-delete'") to cross-check against the cited file's real content. The
//? quote must open right after whitespace/`(`/`:`/start-of-string and close right before whitespace or
//? sentence punctuation — this excludes possessive apostrophes (Conductor's, the route's) from being
//? misread as quote delimiters, which would otherwise stitch together an unrelated "quote" spanning from
//? one possessive to the next real quoted word.
const QUOTE_RE = /(?<=^|[\s(:])'([^']{15,})'(?=$|[\s.,;:)])/g;

try {
  // ---- (a) the matrix's keyset is EXACTLY ENABLED_OPS — no more, no less ----
  const enabledSet = new Set(ENABLED_OPS);
  const matrixOps = Object.keys(EFFECT_MATRIX);
  const matrixSet = new Set(matrixOps);

  eq(matrixOps.length, new Set(matrixOps).size, 'the matrix has no duplicate op keys (object literal — structurally guaranteed, asserted anyway)');

  const missingFromMatrix = ENABLED_OPS.filter((op) => !matrixSet.has(op));
  eq(missingFromMatrix, [], 'every ENABLED_OPS op has a matrix row (a newly-enabled, unclassified op fails HERE)');

  const staleInMatrix = matrixOps.filter((op) => !enabledSet.has(op));
  eq(staleInMatrix, [], 'the matrix has no row for an op that is not (or no longer) in ENABLED_OPS');

  eq(matrixOps.length, ENABLED_OPS.length, `matrix row count matches ENABLED_OPS count (${String(ENABLED_OPS.length)})`);

  // ---- (b) every 'covered' ref points to an existing file containing the cited case name ----
  let coveredChecked = 0;
  for (const [op, row] of Object.entries(EFFECT_MATRIX)) {
    if (row.status !== 'covered') continue;
    coveredChecked += 1;
    const ref = row.ref ?? '';
    assert(ref.trim().length > 0, `${op}: a 'covered' row carries a non-empty ref`);

    const files = [...new Set([...ref.matchAll(FILE_RE)].map((m) => m[0]))];
    assert(files.length > 0, `${op}: the ref cites at least one recognizable test file path`);

    const existingContents: string[] = [];
    for (const file of files) {
      const full = resolve(file);
      assert(existsSync(full), `${op}: cited file exists — ${file}`);
      if (existsSync(full)) existingContents.push(readFileSync(full, 'utf8'));
    }
    if (existingContents.length === 0) continue;
    const combined = existingContents.join('\n');

    //? Cross-check quoted case-name substrings (drop the op's own name in case it's quoted as itself,
    //? e.g. "case asserting op 'ai-skill-delete'" — that quote names the OP, not a test case).
    const quotedCaseNames = [...new Set([...ref.matchAll(QUOTE_RE)].map((m) => m[1]))].filter((q) => q !== op);
    for (const caseName of quotedCaseNames) {
      assert(combined.includes(caseName), `${op}: cited file contains the quoted case name "${caseName}"`);
    }
  }
  assert(coveredChecked > 0, 'at least one covered row was actually checked (sanity — a broken loop would silently pass 0 checks)');

  // ---- (c) every non-covered row (excluded:* or gap) carries a reason ----
  const missingReason: string[] = [];
  for (const [op, row] of Object.entries(EFFECT_MATRIX)) {
    if (row.status === 'covered') continue;
    if (!row.reason || row.reason.trim().length === 0) missingReason.push(op);
  }
  eq(missingReason, [], 'every excluded/gap row carries a non-empty reason');

  // ---- tally + report ----
  const byStatus: Record<string, string[]> = {};
  for (const [op, row] of Object.entries(EFFECT_MATRIX)) {
    (byStatus[row.status] ??= []).push(op);
  }
  const gapOps = (byStatus.gap ?? []).sort();
  console.log(`\nop-effect tally (${String(ENABLED_OPS.length)} enabled ops):`);
  for (const status of Object.keys(byStatus).sort()) {
    console.log(`  ${status}: ${String(byStatus[status]?.length ?? 0)}`);
  }

  //? 'gap' is NOT a legal steady state (owner decision 2026-07-20, post fill-wave): every enabled op must
  //? end up either 'covered' or explicitly excluded (infra/external/ai-cost/bug) with a reason. A newly-
  //? enabled, not-yet-classified op must be reclassified before merge, not parked here — this is now a
  //? GATE, not just a drift/honesty GUARD.
  eq(gapOps, [], "zero 'gap' rows remain — every enabled op is 'covered' or explicitly excluded with a reason");

  // ---- excluded rows use one of the recognized sub-taxonomies (no ad-hoc new bucket unnoticed) ----
  const KNOWN_STATUSES = new Set<EffectRow['status']>(['covered', 'gap', 'excluded:infra', 'excluded:external', 'excluded:ai-cost', 'excluded:bug']);
  const unknownStatus = Object.entries(EFFECT_MATRIX).filter(([, row]) => !KNOWN_STATUSES.has(row.status));
  eq(unknownStatus.map(([op]) => op), [], 'every row uses a recognized taxonomy status');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/opEffectCoverage.test.mts');
