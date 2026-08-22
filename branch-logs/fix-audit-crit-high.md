# Branch log — `fix/audit-crit-high`

> Agent 1 (Fable) van de 3-agent fix-ronde 2026-08-22: de 3 critical + 25 high bevindingen uit
> `src/workspaces/_docs/UI_FUNCTIONAL_AUDIT_2026-08-22.md`, in 10 batches. Voortgangsadministratie
> (per finding checkbox + Result-regel): `src/workspaces/_docs/fix-round-2026-08-22/AGENT_1_FABLE.md`.

## 2026-08-22 22:30 — Alle 10 batches (28 crit/high) gefixt + gecommit

**User prompt:** lees `AGENT_1_FABLE.md` en voer het volledig uit: batches op volgorde, per finding
afvinken + Result-regel, commit per batch.

**Wat ik deed (10 code-commits, elk lint/build/unit-groen):**
1. `5f24af6` Team-management (F-003/F-024): role-pickers filteren op `key !== 'owner'` (niet `!locked`);
   items keyed op `r.key`; snapshot + changeRole-ack dragen de rauwe `roleKey` (optioneel op `Member`).
2. `eb051ed` Documents (F-002/F-021): `navigate('content/documents/<id>')` in lijst + ⌘K-palette.
3. `e263c28` AI-key split-brain (F-001/F-004): Gemini-rij uit content-settings Admin weg; `readiness.aiText`
   = claudeCli ‖ keyed api-key AiConnection ‖ `WS_<PROVIDER>_KEY`; 3 CTA's → workspace/aibehavior/backends;
   boot-migratie `migrateLegacyGeminiKeys()`.
4. `06f686c` Ticket Code-tab (F-006/F-014): files uit `ctx.mrByBranch` (Review-tab-data); Monaco-mode leest
   volledige worktree-content via `readWorktreeFile` (geen hunk-reconstructie meer opgeslagen); `ticketDiff.ts`.
5. `82188a9` Pipeline (F-009/F-008/F-010/F-007): dirty-set per stage + merge-on-refetch + 'elders gewijzigd'-
   banner; Hooks `?? true`; `resolveAiLayers` stage-picked skills; Network-tab eerlijkheidsnotice.
6. `6e4540f` Eén scheduler/één studio (F-019/F-005/F-020): cron uit AutomationPanel (count-rij → Schedules),
   `confirmDeleteTrigger` helper; `studio/kinds.ts` + `studio/BriefForm.tsx`, marketing hergebruikt studio's
   BrandPanel/previews/content; `marketing/kinds.ts` + `marketing/panels.tsx` verwijderd (1906 → 1369 regels).
7. `b15df91` Forge single owner (F-018/F-026/F-025): Git-tab = workspace-DEFAULT met resolved-state-rij van het
   actieve project + link naar Settings › Developer; `forgeBaseUrl` in snapshot (workspace + project), veld
   seedt uit stored URL; 'Forge API token' vs 'Clone token'.
8. `8fc0cc0` AI-routing (F-027/F-017): `<AiBehaviorTab key={activeWorkspace.id}/>`; PROVIDER_IDS uit de catalog;
   conductor weigert onbekende ids; opCatalog-enum uit de catalog.
9. `7d25613` Designer-library (F-011/F-012): delete via op 'delete' + deletedIds-ref; saves sturen persisted id,
   lokaal item adopteert het id; merge re-keyt same-named twin i.p.v. appenden.
10. `08a207a` Rest (F-013/F-015/F-016/F-022/F-023/F-028): interviewer-history; nieuwe op `unarchive` end-to-end
    (+ backlog 'Archived'-filter met Restore); TerminalPanel = één shell + ai-agent, gegate op container;
    mobile drawer: AI-toggle + Projects-sectie; settings-tabs gegate op `myPerms`, DangerTab verbergt
    transfer/delete zonder ownerActions.

**Tests toegevoegd/aangepast:** unit `textReadiness`, `ticketDiff`, `aiProviderAllowlist` (nieuw), `aiLayers`
(+3 cases); per-route `changeRole`, `snapshot` (+1), `saveAiProvider` (+1, happy path gebruikte een niet-catalog-id),
`designerLibrary` (+1), `unarchive` (nieuw, 2 cases); `tests/effectMatrix.mts` rij `unarchive`.

**Files touched:** 60 files (+1337/−916) over `src/workspaces/**`, `server/{read,ai,orchestrator,control,server.ts}`,
`src/_locales/*.json` (alleen append aan sectie-einden), `tests/**`.

**Notes:** overgeslagen/niet gedaan: reverse-link in `settings/page.tsx` (agent 3's file), echte egress-wiring
(F-007, alleen notice), services-beheer op mobiel (F-023, alleen projecten). Weeskeys in locales bewust laten
staan (rule 6). Live sweep (`npm run test`) + browser-check nog niet gedraaid — dev-runtimes zijn een user-actie.
Volledige lijst: "Out-of-scope observations" in `AGENT_1_FABLE.md`.
