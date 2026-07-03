# Workspaces `/goal` — resterend werk (4 items)

> Vervolg op `GOAL_RUN_REPORT.md`. De laatste 4 items uit de `/goal`-run, in volgorde, met wat ze inhouden, wat er al staat, en wat ik nog van jou nodig heb. Volgorde bewust: #7 als laatste omdat een échte from-scratch install de dev-setup kan verstoren.

---

## #10 — Forge-uitbreiding

**Wat:** de git-forge-integratie uitbreiden voorbij de huidige GitLab-ingest:
- **GitHub-forge** — MR/PR aanmaken, reviewen, mergen tegen GitHub (naast het bestaande GitLab-pad).
- **Built-in git-server** — een self-hosted git-remote zodat een workspace geen externe forge nódig heeft.
- **GitLab-webhook continu-ingest** — nu is de ingest poll-based; webhooks maken 't realtime.

**Wat er al staat:** GitLab-ingest (ADR 0014), de built-in MR-review (ADR 0018) + echte merge (#9, ADR 0021), push-on-approval. De forge-abstractie bestaat dus al; dit is 'm generiek maken + GitHub + een eigen remote.

**Wat ik van jou nodig heb:**
- Welke sub-scope eerst? (GitHub-forge lijkt de grootste waarde; de built-in git-server is de meeste bouw.)
- Een **test-GitHub-org/-repo + PAT** (en/of GitLab-instantie) die ik mag gebruiken voor een echte e2e-forge-test. Zonder token blijft het bij mock/integration-niveau.

**Aanpak:** forge-provider-abstractie (net als de AI-provider-abstractie) → `GithubForge`/`GitlabForge`/`BuiltinForge` achter één interface; webhook-endpoint via `registerCustomRoute` (origin-exempt, zoals de bestaande webhook-seam). Getest per provider + een echte round-trip als er een token is.

---

## #14 — Editor: losse eindjes

**Wat:** de code-editor (openvscode-server in-container + Monaco-lite, ADR-editor-plan) afmaken:
- **open-vsx extensions** — extensies installeerbaar maken in de editor-container.
- **Dockerfile in de repo committen** — de editor/base-image reproduceerbaar vanuit de repo.
- **Monaco i18n** — de lichte editor lokaliseren.
- **Editor-profiel encryptie-at-rest** — editor-instellingen/secrets versleuteld opslaan (zoals de env-var-encryptie die al gebouwd is, commit `8976092`).

**Wat er al staat:** het editor-plan + de hybride aanpak (`src/workspaces/_docs/CODE_EDITOR_BUILD_PLAN.md`), env-var encryptie-at-rest als patroon om te hergebruiken.

**Wat ik van jou nodig heb:**
- **Let op:** dit raakt de editor-files waar de *andere AI* aan werkt. Ik moet coördineren / wachten tot z'n editor-WIP gecommit is, anders botsen we. Wil je dat ik dit vóór of ná zijn werk oppak?
- Docker up (voor de editor-container-tests).

**Aanpak:** per los eindje een kleine, geïsoleerde change + test. De encryptie-at-rest hergebruikt het bestaande secret-encryptie-patroon.

---

## #15 — Multi-instance Deel B

**Wat:** de multi-instance-veiligheid (leader-lease + per-workspace write-lock + cross-instance dedup, ADR 0015) **écht verifiëren** door **N instances tegelijk te draaien** en te bewijzen dat: precies één leader de background-loops draait, workspace-writes serieel blijven, en cross-instance fan-out (Redis-adapter) werkt.

**Wat er al staat:** Deel A is gebouwd + gebruikt door alle items deze run — `server/orchestrator/cluster.ts` (`isLeader`, `withWorkspaceLease`, `claimActionOnce`), leader-gated loops (watchdog #1, cron #2, gitlab-poller). De code is multi-instance-*safe*; wat mist is de **live N-instance verificatie**.

**Wat ik van jou nodig heb:**
- Akkoord om lokaal **2-3 backend-instances tegelijk** te starten (poort 80/81/82) tegen dezelfde Redis/Mongo — dat kan de huidige single-backend-dev-flow tijdelijk verstoren.
- Bevestiging dat de gedeelde Redis/Mongo (via de pi5-tunnel) daarvoor gebruikt mag worden.

**Aanpak:** een test-harness die N instances start, een leader-election observeert, gelijktijdige writes op één workspace afvuurt en bewijst dat ze serieel + één-keer verwerkt worden (geen dubbele fire). Grotendeels een test/verificatie-item, weinig nieuwe productiecode.

---

## #7 — Self-host installer + DR (als laatste)

**Wat:** de volledige self-host-story:
- **docker-compose-stack** — alle diensten (app, Mongo, Redis, reverse-proxy) in één compose.
- **bootstrap.sh** — een from-scratch install-script.
- **DR-runbook** — backup/restore/disaster-recovery-procedure.
- **ÉCHT een from-scratch install draaien + testen** — niet alleen schrijven, maar uitvoeren.

**Wat er al staat:** `docs/HOSTING.md`, de hosting-memory (workspace.keetlerop.nl + wildcard-subdomains, pluggable reverse-proxy Caddy/nginx).

**Wat ik van jou nodig heb:**
- **De doel-omgeving**: waar moet de from-scratch install draaien? (een schone VM / de pi5 / lokaal in Docker?) Een echte install-test **kan de huidige dev-setup verstoren** — daarom expliciet als laatste + met jouw go-ahead.
- Reverse-proxy-keuze bevestigen (memory zegt: nginx nu / Caddy modern).
- Eventuele domein-/DNS-/secrets-info voor een realistische install.

**Aanpak:** compose + bootstrap schrijven, dan in een geïsoleerde omgeving (bij voorkeur niet je actieve dev-machine) een volledige install draaien en de DR-runbook stap-voor-stap uitvoeren + verifiëren.

---

## Samenvatting: wat blokkeert wat

| Item | Kan ik nu doen? | Blokkade |
|------|-----------------|----------|
| #10 forge | Deels (abstractie + GitHub-code + tests) | Echte e2e wacht op **forge-token/-instantie** |
| #14 editor | Deels | **Coördinatie met andere AI** (editor-files) + Docker |
| #15 multi-instance | Ja (grotendeels test) | Akkoord voor **N-instance lokaal draaien** |
| #7 installer + DR | Schrijven ja, échte install nee | **Doel-omgeving + go-ahead** (verstoort dev-setup) |

> Ik kan met #10 en #15 door zonder op jou te wachten (tot het punt van een echte forge-token resp. multi-instance-run). #14 en #7 hebben jouw input/coördinatie eerder nodig. Zeg maar welke volgorde je wil, of ik pak ze in de `/goal`-volgorde (#10 → #14 → #15 → #7).
