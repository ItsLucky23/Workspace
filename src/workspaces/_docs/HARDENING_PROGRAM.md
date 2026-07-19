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
| 1 | Ship-what-you-tested + the silent loop | F26 promotion pin · F44 immediate push · F40 frozen publish payload · F41 channel default · F43 | |
| 2 | Media access + storage truth | F05/F42 signed URLs · F06 quota · F48 blob GC + revocation | |
| 3 | Trust boundaries | F09 run-command allowlist (report-first) · F17 commentInbox tenant · F20 audit integrity · F34 atomic spend | |
| 4 | Durable work | F35 document extraction job · F38 cron attempts/retry/catch-up/dead-letter · F45 write ACK | |
| 5 | Release integrity | F23 parallel DAG · F27 history/compare surface · F28 `Service.path` · F29 hooks/processes/visibility | |
| 6 | Subsystems | F49/F50 backup+restore drill · F51 migration runner · F54 export/import · F55 retention · #19 packs | |
| 7 | UI: structure | Navbar → ~5 groups + sub-navigation, module-aware | |
| 8 | UI: first-open legibility | KISS pass per page; split where a page does too much | |
| 9 | Verification | Container E2E + browser pass over the real UI | |

## Standing rules for this run

- Every fix carries a test that FAILS without it. A verification round already showed that green tests say
  nothing about reachability, so wiring/reachability gets asserted too.
- Security posture changes stay report-first (ADR 0278) unless the owner asked for enforcement.
- No new verbs; capability gaps close as ops (ADR 0278).
- Findings that contradict the plan get written down here rather than silently worked around.

## Findings log

_(appended as the run progresses — the place where "this turned out differently" goes)_
