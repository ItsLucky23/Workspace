# Workspaces — build-handoff package

> **What this folder is.** A **self-contained, drop-in build-handoff package** for **Workspaces** — a self-hosted, AI-driven dev-orchestration app. It contains the whole **portable frontend** (real TSX prototype) plus **all the project context** (architecture, V1 scope, 24 feature specs, container runtime, control-API, the tool-module build plans, and the executable build program) needed to build the product from cold.
>
> Design-corpus consolidated **2026-06-11**; the gefaseerde **build program** + tool-module plans added **2026-06-15**.

---

## ▶ Beginnen / verdergaan (LEES DIT EERST)

Dit pakket bevat een **uitvoerbaar bouwprogramma** in fases, met een levend voortgangslog. Twee instap-paden:

- **"Begin met workspaces_handoff"** (nieuw project) → lees **[`BUILD_PROGRAM.md`](./BUILD_PROGRAM.md)** (het gefaseerde plan + uitvoeringsmodel), bootstrap een **verse repo** die `@luckystack/*` installeert (Fase 0, stap 0.1), en werk **[`BUILD_LOG.md`](./BUILD_LOG.md)** bij na elke stap.
- **"Ga verder met workspaces_handoff"** (hervatten) → lees **[`BUILD_LOG.md`](./BUILD_LOG.md)**, pak de **"Volgende actie"**, voer die stap uit volgens het uitvoeringsmodel in `BUILD_PROGRAM.md`, en werk het log bij. Het log zegt bijv. *"Fase 1 done · Fase 2 moet nog geverifieerd worden"*.

**Uitvoeringsmodel (kort):** elke stap is een **ultracode-workflow** — **Haiku**-agents doen het bulkwerk (scaffolding/CRUD/UI/tests), **Sonnet** voor engine/integratie (PTY, Conductor, containers, RBAC), en na elke stap/fase verifieert een **Opus**-agent → gevonden misses worden door verse **Haiku**-agents gefixt → herverifiëren tot groen → log bijwerken. Volledige policy + de fase/stap-specs: `BUILD_PROGRAM.md`.

**De drie fases in één blik:**
1. **Basisplatform, geen AI** — login, workspaces, email-invites, **volledige RBAC + settings**, **volledig DB-schema**, bord + tickets.
2. **AI + pipeline + hulp-AI + image-builder** — orchestrator/Conductor, container-runtime, AI-voorgestelde stacks/images per instance, werkende bewerkbare pipeline, Assistant + notifications + question-forwarding. (Gated op de P0.5 CLI-billing-spike.)
3. **Tool-modules** — gedeeld raamwerk → Interviewer → Designer → Marketing-setup → Document.

> De tool-module-bouwplannen staan in **[`build-plans/`](./build-plans/)** (`INDEX.md` + `DECISIONS.md` zijn bindend). De diepe design-specs staan in `src/workspaces/_docs/` (begin daar bij `BUILD_HANDOFF.md` als je de *waarom*-laag nodig hebt).

---

## What Workspaces is (one paragraph)

A user writes simple tickets; a configurable **pipeline of stages** (refine → plan → implement → test → review) drives each ticket forward; the human is a **man-in-the-middle who only approves and answers questions** — ideally from a phone. Three roles: the **Assistant** (one interactive `claude` PTY per active user — the chat that proposes/relays), the **Stage-Agent** (one interactive `claude` PTY per *(ticket, stage)*, doing the work in a container), and the **Conductor** (deterministic Node — *the only writer* of board/git/status). Bovenop dit kern-product komen de **tool-modules** (Interviewer, Designer, Marketing, Document) als losse sidebar-pagina's, per workspace aan/uit.

---

## How to use this package (bootstrap)

1. **Create a fresh repo and install the framework** — `npm install @luckystack/*` (exact set in [`_docs/SETUP_AND_PREREQUISITES.md`](./src/workspaces/_docs/SETUP_AND_PREREQUISITES.md) / [`_docs/MIGRATION.md`](./src/workspaces/_docs/MIGRATION.md)).
2. **Copy `src/workspaces/` into the new repo's `src/`** — self-contained (only `@luckystack` + lib imports).
3. **Copy `server/hooks/workspacesTerminal.ts`** into the new repo's server hooks + its one registration line ([`_docs/PORT_MANIFEST.md`](./src/workspaces/_docs/PORT_MANIFEST.md)).
4. **Copy `_docs/REPO_CLAUDE.template.md` to the repo root as `CLAUDE.md`**.
5. **Volg `BUILD_PROGRAM.md`** (Fase 0 → 1 → 2 → 3), en houd `BUILD_LOG.md` bij. Voor de diepe *waarom*-laag van een onderdeel: `src/workspaces/_docs/BUILD_HANDOFF.md` is de design-corpus-voordeur.

> [`_docs/PORT_MANIFEST.md`](./src/workspaces/_docs/PORT_MANIFEST.md) is the authoritative copy-list (what to bring, what NOT to copy because it's the framework).

---

## What's inside

```
workspaces-handoff/
├── README.md                       ← you are here (start/resume front door)
├── BUILD_PROGRAM.md                ← ★ het gefaseerde, ultracode-uitvoerbare bouwprogramma
├── BUILD_LOG.md                    ← ★ levende voortgangsstatus (lees bij verdergaan)
├── build-plans/                    ← tool-module bouwplannen (00-framework … 05-image-builder + INDEX + DECISIONS)
├── server/hooks/workspacesTerminal.ts ← the one backend file to port (dev terminal bridge)
├── ui-builder/                     ← Lane-D Monaco editor reference (reference, not product code)
└── src/workspaces/                 ← THE PORTABLE FRONTEND (drop into new-repo/src/)
    ├── _components/ _data/ _screens/ _shell/
    └── _docs/                      ← ALL DESIGN CONTEXT (the authoritative spec set)
        ├── BUILD_HANDOFF.md        ← design-corpus front door (the why-layer)
        ├── V1_SCOPE.md, BUILD_ORDER.md, 01–08 + 02b/04b/07b addenda
        ├── CONTROL_API, GOLDEN_PLAN_STAGE, P0_CLI_SPIKE, MIGRATION, TESTING_STRATEGY…
        ├── features/01–24, additions/, design-reference/
```

---

## Reading order

1. **[`BUILD_PROGRAM.md`](./BUILD_PROGRAM.md)** + **[`BUILD_LOG.md`](./BUILD_LOG.md)** — wat te bouwen, in welke volgorde, hoe (ultracode-model) en waar je staat.
2. **[`build-plans/INDEX.md`](./build-plans/INDEX.md)** + **[`build-plans/DECISIONS.md`](./build-plans/DECISIONS.md)** — de tool-modules + de bindende beslissingen.
3. Voor de *waarom*-laag per onderdeel: [`src/workspaces/_docs/BUILD_HANDOFF.md`](./src/workspaces/_docs/BUILD_HANDOFF.md) → `V1_SCOPE.md` → de frozen contracts (`CONTROL_API`, `04b`, `02`).

---

## Framework prerequisites

This is a **consumer app** built on the LuckyStack framework — **not** a fork. The build assumes the framework provides file-based `_api`/`_sync` routing, the function-injection system, raw-Node + Socket.io rooms/broadcaster, Prisma + Redis, and the strict-typing + i18n + Tailwind-token conventions. **Verify the installed `@luckystack/*` set covers these at install time** ([`_docs/SETUP_AND_PREREQUISITES.md`](./src/workspaces/_docs/SETUP_AND_PREREQUISITES.md)).

---

## Status

**Design + docs + UI-only prototype + uitvoerbaar bouwprogramma.** Nog geen backend-AI bedraad; de prototype-schermen draaien op dummy-data. De eigenlijke bouw start in een **verse repo** via `BUILD_PROGRAM.md` (Fase 0). Eerste mijlpaal in Fase 2 is de **P0.5 CLI-billing-spike** ([`_docs/P0_CLI_SPIKE.md`](./src/workspaces/_docs/P0_CLI_SPIKE.md)), die het container/PTY-werk gate. Voortgang: **[`BUILD_LOG.md`](./BUILD_LOG.md)**.
