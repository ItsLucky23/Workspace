# Branch log — `main`

## 2026-07-01 14:00 — Workspaces bootstrap (stap 0.1, deels)

**User prompt:** Ga over de `workspace-handoff` folder; check of de repo-bootstrap gedaan is; leg belangrijke system-design-choices vast in de main repo; complete alle stappen van 0.1.

**What I did:**
- Vastgesteld dat stap 0.1 nog niet gedaan was (alleen de kale `@luckystack/*`-install stond er).
- `workspaces-handoff/src/workspaces/` (140 files incl. `_docs/`) gekopieerd naar `src/workspaces/` — het portable prototype + de volledige design-corpus (die de latere verwijdering van `workspaces-handoff/` overleeft).
- `workspaces-handoff/server/hooks/workspacesTerminal.ts` → `server/hooks/`, en `registerWorkspacesTerminalHooks()` geregistreerd in de `luckystack/server/`-overlay (naast `registerNotificationHooks`). Dev-only, self-gated tot non-productie.
- De 9 Workspaces-invarianten + read-order + de 4 build-lanes in root `CLAUDE.md` § User Project Rules gegraft (i.p.v. `REPO_CLAUDE.template.md` puur over te schrijven — zo behoud je de framework-tooling én win je de load-bearing product-regels).

**Files touched:** `src/workspaces/**` (nieuw, 140), `server/hooks/workspacesTerminal.ts` (nieuw), `luckystack/server/index.ts` (+2 regels), `CLAUDE.md` (§ User Project Rules), `workspaces-handoff/BUILD_LOG.md`.

**Notes / bewuste keuzes:**
- `useWorkspaceData()`-seam NIET aangelegd in 0.1 (afwijking van het letterlijke recept). Reden: `MIGRATION.md §4` markeert dit als Lane B's grootste refactor (15 files) die pas zin heeft mét Prisma/socket-backing; het prototype voldoet al aan de 0.1-acceptatie ("draait op dummy-data") via directe `_data/seed`-imports. Doorgeschoven naar Lane B / stap 0.2+.
- **Geblokkeerd op developer-acties:** build valt op ontbrekende deps `motion`, `@xterm/xterm`, `@xterm/addon-fit` (client) + `node-pty` (server, native — Windows buildtools). Daarna server-start om UI op `/workspaces` te verifiëren.
- `workspaces-handoff/` is tijdelijk en moet weg na de bouw — `BUILD_PROGRAM.md` + `BUILD_LOG.md` moeten eerst de repo in.
