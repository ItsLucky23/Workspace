# Testing Playbook — Workspaces

> Project-owned. The framework spec lives in `docs/luckystack/ARCHITECTURE_TESTING.md`; THIS doc is
> how testing works in this repo: the layers, the exact commands, the recipes for new tests, and
> the push ritual. Kept current by the AI (Rule 15). Last major revision: 2026-07-21, after the
> four-phase test program (branch-logs/main.md entries #480–481).
<!-- @covers tests/** src/**/_api/*.tests.ts src/**/_sync/*.tests.ts -->

## The layers (what catches what)

| Laag | Wat | Draaien |
|---|---|---|
| Auto-sweep | contract / auth / rate-limit / csrf / fuzz, ELKE route automatisch | `npm run test` (sweep-lagen) |
| Per-route custom | businesslogica per route — elke route heeft er één (329 cases) | `npm run test` (custom-laag) |
| Standalone suites | integratie/unit in `tests/` (334 bestanden, incl. structurele bewakers) | `npm run test:ws` |
| Effect-matrix | elke assistant-op → geverifieerd effect óf gedocumenteerde uitsluiting | bewaker draait mee in `test:ws` (unit) |
| Playwright | 42 deterministische kernflow-specs (12 files), geen LLM in de loop | `npm run test:e2e` (test:all: `--workers=4`) |

## Commands

- **Alles**: `npm run test:all` (= test:ws → test → test:e2e). Vereist de dev-runtimes
  (`npm run server` + `npm run client`) en echte Mongo/Redis. Reken op ~18-20 min sinds de
  parallelisatie van 2026-08-23 (was ~40): `test:ws` draait nu een WORKER-POOL (unit ×8,
  integratie ×4, plus een SERIAL LANE voor tests met een vaste resource — poort/Docker/writer-
  singleton/globale aggregaten; zie de `SERIAL`-set in `scripts/runWsTests.mjs` — een test die
  onder de pool flaked hoort DAAR bij, dat is de ontworpen escape hatch) en Playwright ×4 workers.
  De sweep blijft het grootste blok (~11 min) en is bewust sequentieel (zie Discipline 1).
- **Snelle laag** (wat de pre-push-hook draait): `npm run test:unit` + `npm run lint` + `npx tsc --noEmit -p tsconfig.json` (client + server typecheck — Vite en tsx typechecken niets, lesson 0029) + `npm run ai:lint`.
- **Eén route**: `TEST_ONLY_CUSTOM=1 TEST_FILTER="<page>/<name>/<versie>" npm run test`
  (bijv. `workspaces/quickAdd/v1`). De base-URL default sinds 2026-07-21 naar de ÉCHT gebonden
  backend-poort (dev-server.json → config.ports-fallback, altijd `127.0.0.1`) — `TEST_BASE_URL`
  is alleen nog nodig voor een afwijkend doelwit.
- **Eén Playwright-spec**: `npx playwright test tests/e2e/<file>.spec.ts --workers=1`.
- **Eén standalone file / subset**: `node scripts/runWsTests.mjs <substring>` (matcht op pad).

## Discipline (hard geleerd)

1. **Draai de sweep SOLO.** Parallelle sweep-processen duwen elkaar via route-rate-limits vals
   rood — de "transient fetch failed"-klasse. Eén runner tegelijk, klaar.
2. **De server moet draaien en ACTUEEL zijn.** De sweep test de dráaiende server; na server-side
   wijzigingen eerst herstarten (kill de `luckystack-dev`-SUPERVISOR-boom, niet het poort-PID —
   lesson 0016 — en check daarna het listener-áántal, niet alleen "de poort antwoordt").
3. **Poll-na-ack.** Een sync-ACK is niet de postconditie (Conductor is de enige schrijver) —
   assert altijd via een Prisma-poll (helper staat in elke sync-test).

## Nieuwe code = nieuwe tests (verplicht, zie ook CLAUDE.md)

- **Nieuwe `_api`/`_sync` route** → `npm run scaffold:test <page>/<name>/<versie>`, vul minimaal
  één happy-path (het echte succes-contract + DB-postconditie) en één guard-case (wat de route
  écht afdwingt — lees de implementatie). Sync-tests: importeer `loginSeededUser`, `joinRoom`
  (verplicht — het HTTP-harnas heeft geen socket-roomCodes) en `cleanupWorkspace` uit
  `tests/_helpers.mjs`; exemplaren: `_api/snapshot_v1.tests.ts`, `_sync/quickAdd_server_v1.tests.ts`.
- **Nieuwe assistant-op** → classificeer hem in `tests/effectMatrix.mts`: `covered` (met
  test-verwijzing) of `excluded:*` met reden. De bewaker `tests/unit/opEffectCoverage.test.mts`
  maakt een ongeclassificeerde op ROOD — dit is bewust niet optioneel. Taxonomie (owner-besluit
  2026-07-20): stub/dummy-paden tellen als testbaar (`covered`); `excluded:ai-cost` alleen zonder
  stub-pad; `excluded:external` = echte third-party/remote (publish, forge-push, e-mail);
  `excluded:infra` = vereist live Docker/forge/DB.
- **Nieuwe kernflow of UI-belofte** → een Playwright-spec in `tests/e2e/` op de gedeelde fixture
  (`fixtures.ts`: API-auth + onboarding-helper). Selector-volgorde: `getByRole`/`getByLabel`
  eerst; `data-testid` (`ws-<pagina>-<element>`) alleen waar dat niet volstaat, en elke tag moet
  door een spec gebruikt worden. Geen AI-turns, publishes of containerstarts in specs.
- **Op-effect-principe (lesson 0017)**: test niet alleen dat een knop/op bestaat (entry) maar dat
  de belofte waar wordt op de plek waar de gebruiker hem ervaart (effect).

## Hooks & push-ritueel

- **`git commit`** → `.githooks/pre-commit`: AI-artifact-regens + `ai:lint` (geen tests — commits
  blijven snel).
- **`git push`** → `.githooks/pre-push`: lint (0 errors) + typecheck (`tsc --noEmit -p tsconfig.json`, 0 errors) + `ai:lint` + `npm run test:unit`
  (structurele bewakers incl. navStructure/surfaceReachability/opCatalogParity/opEffectCoverage).
- **AI gevraagd om te pushen** → de AI draait éérst `npm run test:all` volledig groen (runtimes
  aan, sweep solo) en pusht pas daarna. Dit is een vaste regel in CLAUDE.md.
- **Runtimes schoon starten/stoppen** → `npm run stop` doodt de hele `luckystack-dev`-supervisor-boom
  + Vite van DIT repo (alleen processen waarvan de command line dit repo-pad noemt). Nodig omdat het
  killen van het proces op :4787 (of het stoppen van een harness-background-task) alleen het KIND
  raakt en de supervisor het respawnt (lesson 0016). Met `SERVER_PORT_AUTO_INCREMENT=0` in
  `.env.local` faalt `npm run server` dan luid op een bezette poort in plaats van stil naar :4788 te
  hoppen (waarna de Vite-proxy en de sweep tegen de verkeerde backend praten).
