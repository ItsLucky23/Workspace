# Programs index — every build program, its status, and where it lives

> One row per `/goal`-style build program. Completed programs are moved to `archive/` (2026-08-23 docs
> cleanup); active/current ones stay in this folder. The one-off scans/audits a program consumed
> (GAP_SCAN_*, UI_*_AUDIT_*, COMPLETENESS_SCAN, fix-round-2026-08-22/, …) were **deleted** in the same
> cleanup once their findings were acted on — their provenance lives in `branch-logs/main.md` and the
> ADRs each program row names.

## Active / current

| Program | Status | What it is |
|---|---|---|
| [CODING_AGENT_PROGRAM.md](./CODING_AGENT_PROGRAM.md) | ✅ COMPLETE 2026-08-23 (fases 1-6, ADR 0322) — kept here while recent | Claude Code + pi-agent behind one adapter seam; Codex (ChatGPT) seat; live container e2e |
| [AI_PROVIDER_EXPANSION_PLAN.md](./AI_PROVIDER_EXPANSION_PLAN.md) | Fase 1+2 ✅ (fix-round pakket 4) · Fase 3 ✅ via ADR 0322 · Fase 4 vervalt · Fase 5 open | Any AI feature on any backend; the provider catalog roadmap |
| [LOOP_AND_GRAPH_PROGRAM.md](./LOOP_AND_GRAPH_PROGRAM.md) | 📋 CAPTURED, deliberately not built (2026-08-18) | Loop/graph ideas parked for a future decision |
| [BUILD_PROGRAM.md](./BUILD_PROGRAM.md) + [BUILD_LOG.md](./BUILD_LOG.md) | 🏛 HISTORICAL (V1 build done; moved from the deleted `workspaces-handoff/` scaffold) | The original phased V1 build program + its living log |

## Completed (archived under `archive/`)

| Program | Completed | Provenance |
|---|---|---|
| [archive/CONTENT_PLATFORM_PROGRAM.md](./archive/CONTENT_PLATFORM_PROGRAM.md) | 2026-07-06 | Dev-tool → all-in-1 AI content platform pivot |
| [archive/DEPTH_PROGRAM.md](./archive/DEPTH_PROGRAM.md) | 2026-07-06 | 16 items, ADRs 0073–0088 |
| [archive/EXPANSION_PROGRAM.md](./archive/EXPANSION_PROGRAM.md) | 2026-07-06 | 14 items, ADRs 0035–0048 |
| [archive/IDEA_TO_OUTCOME_PROGRAM.md](./archive/IDEA_TO_OUTCOME_PROGRAM.md) | 2026-07-08 | Fases V/B/L2/L3/D/G, ADRs 0155–0160, live media-proof |
| [archive/ADOPTION_PROGRAM.md](./archive/ADOPTION_PROGRAM.md) | 2026-07-08 | 11 fasen / 40 items (non-blocking vragen, ultrasync, governance, …) |
| [archive/AI_LIBRARIES_ACCOUNTS_PROGRAM.md](./archive/AI_LIBRARIES_ACCOUNTS_PROGRAM.md) | 2026-07-08 | Zelf-bewuste AIs · galerijen · accounts, ADRs 0250–0261 |
| [archive/UNIVERSAL_TOOL_PROGRAM.md](./archive/UNIVERSAL_TOOL_PROGRAM.md) | 2026-07 | Consumed SCAN_UNIVERSAL_TOOL_2026-07-09 (deleted) |
| [archive/FREEDOM_PROGRAM.md](./archive/FREEDOM_PROGRAM.md) | 2026-07 | Customization/vrijheid-gaps + image/video/audio-editors |
| [archive/DOCUMENTS_AND_SKILLS_PROGRAM.md](./archive/DOCUMENTS_AND_SKILLS_PROGRAM.md) | 2026-07-17 | 8 fasen SK→VO, ADRs 0270–0275 |
| [archive/DESIGN_DOCS_PROGRAM.md](./archive/DESIGN_DOCS_PROGRAM.md) | 2026-07-18 | Design UI-vanaf-0 + Document PDF→technisch ontwerp |
| [archive/GAP_SCAN_PROGRAM.md](./archive/GAP_SCAN_PROGRAM.md) | 2026-07-18 | Consumed GAP_SCAN_2026-07-17 (deleted) |
| [archive/HARDENING_PROGRAM.md](./archive/HARDENING_PROGRAM.md) | 2026-07-19 | Consumed PRODUCT_GAP_SCAN_2026-07-18 (deleted), 9/9 ✅ |

## Deleted programs

| Program | Why |
|---|---|
| `COMPLETION_PROGRAM.md` | Its 162-row status table said 0 ✅ while nearly everything had shipped — actively misleading. The verified state lives in the memory/branch-logs of the completion-gaps-v3 run (2026-07): golfs 47-49 done; the real leftovers were product decisions (keys, nieuw-op choices), not build work. |
