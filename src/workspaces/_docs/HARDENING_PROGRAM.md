# HARDENING PROGRAM — closing the verified-open gaps + the UI pass

> Created 2026-07-19. This is the durable tracker for one large run: everything the independent
> verification found still OPEN in `PRODUCT_GAP_SCAN_2026-07-18.md`, plus the UI/navbar work the owner
> asked for. Phases are ordered by blast radius; each is gated (typecheck · lint · ai:lint · build · tests)
> and committed before the next starts.

## Why this exists

The parallel pass reported all 55 F-items as fixed. Three independent code verifications found
**~22 fixed, 8 partial, 17 not fixed**. Two of those matter more than the rest:

- **F26** reads as fixed and is not: promotion gates on the tested commit, then `git reset --hard`s the
  target to branch **tip**. Gating on X and shipping tip is worse than the original gap.
- **F44** looks fixed because a push exists on a needs-input-adjacent path, but a NEW question writes
  `remindedAt: null` and the notifier requires `remindedAt !== null` — so the first push waits for the
  reminder sweep: **2 hours of silence** on the phone-first loop this product is built around.

## Owner decisions (2026-07-19)

1. **`/media` = signed expiring URLs.** Private by default (session + membership); the publish path mints a
   short-lived HMAC-signed URL so TikTok's `PULL_FROM_URL`, YouTube and a live page can still fetch. This is
   what lets F05 and F42 be closed together instead of against each other.
2. **Full scope** — the five subsystems ship complete, not minimal: backup/restore drill, migration+backfill
   runner, retention policy, portable export/import, workspace packs.
3. **CI: a real parallel DAG scheduler** with a concurrency cap (not just topological ordering).
4. **UI is in scope.** Every page must read for someone opening it for the FIRST time (KISS); more
   sub-pages is an acceptable trade. The navbar gets ~5 top-level entries with sub-categories, not 20 flat
   buttons. Browser verification with a real browser is part of this run.

## Phases

| # | Phase | Items | Status |
|---|---|---|---|
| 0 | Finish the parallel pass | F11 edge auth (was complete, uncommitted) | ✅ `e51733b` |
| 1 | Ship-what-you-tested + the silent loop | F26 promotion pin · F44 immediate push · F40 frozen publish payload · F41 channel default | ✅ `3a3fe13` |
| 2 | Media access + storage truth | F05/F42 signed URLs | ✅ `3a3fe13` (F06 quota, F48 blob GC still open) |
| 3 | Trust boundaries | F09 allowlist (report-first) · F17 tenant · F34 spend cap | ✅ `3a3fe13` (F20 tamper-evidence still open) |
| 4 | Durable work | F35 extraction job · F38 runs/retry/catch-up/dead-letter | ✅ `c643db7` (F45 write ACK still open) |
| 5 | Release integrity | F23 parallel DAG | ✅ `c643db7` (F27 compare, F28 `Service.path`, F29 hooks/processes still open) |
| 6 | Subsystems | F49/F50 · F51 · F54 · F55 · #19 | ✅ `12040c7` |
| 7 | UI: structure | 5 destinations + sub-navigation | ✅ `af0558e` |
| 8 | UI: first-open legibility | packs on onboarding; per-page KISS pass | 🔶 packs done, page-by-page pass open |
| 9 | Verification | Container E2E + browser pass | ✅ container E2E green; browser pass done for onboarding/nav/packs |

## Standing rules for this run

- Every fix carries a test that FAILS without it. A verification round already showed that green tests say
  nothing about reachability, so wiring/reachability gets asserted too.
- Security posture changes stay report-first (ADR 0278) unless the owner asked for enforcement.
- No new verbs; capability gaps close as ops (ADR 0278).
- Findings that contradict the plan get written down here rather than silently worked around.

## Findings log

**The browser pass earned its place.** Three bugs reached a green test suite and were only visible in a
real browser:

1. **`packId` never reached the server.** The create route ENQUEUES a Conductor op rather than creating the
   workspace itself. A fix written against the wrong shape silently did nothing — and the integration test
   passed because it called `createBlankWorkspace` directly, bypassing the route entirely. `presetKey`
   arrived (3 vs 7 stages) while the pack seeded nothing at all.
2. **The nav restructure made the collapsed rail WORSE** — 19 icons where there had been 15, because it
   rendered the group buttons and every sub-item.
3. **Pack tickets collided with the default starter tickets**, which restart numbering at DEV-1, so the
   pack's ticket vanished. Seeding now runs last and continues the numbering.

Two smaller ones: two pack icons rendered as "?" placeholders (not in the icon map), and packs were
initially added only to the in-app create form — not to Onboarding, which is the one screen where "what is
this workspace for?" actually matters.

**A `void` that ate its promise.** `void prisma.x.create(...)` was used to make a heterogeneous writer list
type-check in the import path. It discarded the promise, so rows appeared to import while still in flight.
Caught by the restore drill, not by typecheck.

**A unique index could not be built** until pre-existing duplicate rows were removed — which is precisely
the upgrade class F51 exists for, met while building F51.

## Still open (verified, not started)

F06 upload quota · F20 audit tamper-evidence · F27 deploy compare/history surface · F28 `Service.path`
respected by CI/preview/deploy/export · F29 stage hooks/processes/visibleStageIds consumed · F45 write ACK
for approvals · F48 blob GC + revocation of deleted media · the per-page KISS pass beyond onboarding/nav.
