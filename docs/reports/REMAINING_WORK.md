# Workspaces `/goal` — opvolgacties (alle 14 items zijn af)

> Vervolg op `GOAL_RUN_REPORT.md`. Alle 14 `/goal`-items zijn gebouwd, getest en gecommit. Wat rest zijn **operator-/input-gated live-stappen** — geen bouwwerk, maar dingen die Docker, een token, of jouw keuze nodig hebben.

## 1. Docker-gated smoke-tests (zodra Docker draait)
Eén smoke-test per item; de logica is al headless bewezen.
- **#11** pty-agent live-relay · **#4** live handoff `/clear`-reset in de container · **#9** echte merge in de bare repo · **#12** container-capacity-admission · **#14** editor-profiel tar-in/out tegen een live container.

## 2. Input-gated
- **#10 forge-e2e** — geef me een test-GitHub/GitLab-org + PAT → dan draai ik een echte MR/PR-round-trip.
- **#10 built-in git-server** — aparte infra-service (git-http-backend + auth); wil je 'm, dan is dat een nieuw bouwblok bovenop de forge-abstractie.
- **#7 echte install** — kies een doel-host (schone VM / pi5 / lokaal Docker) → `cd deploy && ./bootstrap.sh`. Verstoort de dev-setup, dus met go-ahead.
- **#14 Monaco-i18n** — coördineren met de andere editor-AI (raakt z'n Monaco-files).
- **#14 Dockerfile-commit-in-repo** — kleine git-flow-toevoeging; Docker/git nodig om te verifiëren.

## 3. Beslissing nodig
- **Framework-bug #13** (notificatie-pref-save, `@luckystack/core` union-recursie): fix-in-framework / consumer-workaround / laten liggen?

> Zeg maar welke je eerst wil zodra je terug bent; ik kan #1 (Docker-smokes) en #10-forge direct oppakken als de randvoorwaarden er zijn.
