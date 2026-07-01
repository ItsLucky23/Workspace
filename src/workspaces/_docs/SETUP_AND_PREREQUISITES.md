# Setup & prerequisites — what YOU (the operator) need to provide

> The one place that lists every **non-code** thing a human has to set up to run Workspaces for real: accounts, infra, the container image, credentials, and the per-integration steps. Code is built from the architecture docs (`01`–`06`) + the feature docs (`features/`); **this doc is the environment around that code.** Each item is tagged with the **build phase** it's first needed for (see `05_BUILD_PLAN.md`) and cited to its source decision/gap. Last updated: 2026-06-03.

---

## TL;DR — what's needed *right now* (the prototype)

**Almost nothing.** The current `src/workspaces/` is dummy-data UI plus one real piece: the dev terminal. To use that terminal:

- Run **`claude login`** on this machine (your Claude **Max** subscription) — the terminal spawns the real Claude CLI over node-pty on your subscription.
- The dev terminal is **dev-gated**: it only runs when `NODE_ENV!=='production'` or you set **`WORKSPACE_AI_ENABLED=1`** / `WORKSPACES_TERMINAL_ENABLED=1`.

Everything below is for **when we build the real orchestrator** (post-publish repo). Nothing below is required to keep iterating on the prototype UI.

---

## 1. Host & Claude auth — *needed: P1*

- **`claude login` on the orchestrator host**, using the **Max subscription** account. Every Assistant/Stage-Agent runs as an interactive PTY on that login (the load-bearing billing decision — `01 §1`).
- **Do NOT set `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `apiKeyHelper`** in the orchestrator's environment — they take precedence and would bill **API credits** instead of the subscription (`01 §1`). Spawn sessions with a clean env.
- For containerized stage-agents (P2+), **mount the host `~/.claude`** into each container so they inherit the subscription auth (`01 §7`).

## 2. Container image — *needed: P1 (base) / P2 (per-project)*  ·  refs: G12-era infra, `features/04`
- Install **Docker** (Linux: native; **Windows: Docker Desktop + WSL2** — the orchestrator drives the Docker API identically, `01 §7`).
- Build a **base image** containing: `git`, the **Claude CLI**, Node + build deps for **node-pty**, and the common integration **CLI clients**: `psql`, `mysql`, `mongosh`, `redis-cli`, `curl`, `git`, `gh` (`features/04`).
- Build a **per-project image / Dockerfile** on top for the project's runtime (e.g. **.NET SDK** for a C# repo, Go toolchain, etc.) + any **extra integration clients** via `Dockerfile ADD` (`features/04`, stack-agnostic per `01 §7`).
- DEV containers run **2 processes** (Vite `:5173` exposed → Node backend `:80`) — the proxy targets **Vite 5173**, not the backend (gap **G14**).

## 3. Data infrastructure — *needed: P2 (RAG) / P1 (Redis)*
- **MongoDB** with **Atlas Local** in the Docker stack — required for `$vectorSearch` RAG; a vanilla `replicaSet=rs0` does **not** serve it (gap **G10**, B-24). Fallback: `Float[]` + cosine in the worker behind a flag (≤~10k vectors/snapshot).
- **Redis** — sockets/adapter, the leader-election **lease**, the job **queue**, per-ticket **seq** (`INCR`), presence (gaps **G1/G2/G8/G13**). Env: `REDIS_HOST/PORT/USERNAME/PASSWORD`.
- A self-hosted **embeddings model** container (nomic-embed / BGE / jina-code) for the RAG skill — no cloud embedding cost (B-18). *Needed when RAG is built.*

## 4. GitLab — *needed: P1 (token) / P4 (webhook)*
- A **GitLab OAuth app** for login (B-05) — set `*_CLIENT_ID/SECRET` for your provider (the framework supports GitHub/Google/etc.; add a GitLab provider in `oauthProviders.ts`).
- A **per-workspace GitLab token** with repo access (B-07) — you paste it during workspace setup (`features/01`); it's stored encrypted per workspace, **never** reused across workspaces (decision 01.q3).
- A GitLab **merge webhook** → the orchestrator, for board sync (B-29). Note the **origin-403** + **body-consumed** edges (gaps **G6/G7**): the edge proxy must inject an allowed `Origin`, and verify the plaintext `X-Gitlab-Token` header (not a body-HMAC).

## 5. Networking / reverse proxy — *needed: P2+ (real multi-container only)*  ·  ref: gap G3, B-11
- **Caddy** (or Traefik) as the TLS-terminating edge with **wildcard DNS + TLS** for: `app.<domain>` (web-app), `term.<domain>` (orchestrator terminals/control), and `dev-<ticketId>.<domain>` (per-ticket preview). The orchestrator POSTs/labels a route per container on start and removes it on teardown.
- `@luckystack/router` is **not** the tool here (it's path-segment routing, no TLS — gap **G3/G21**). Not needed for a single-host local PoC.

## 6. Per CLI-integration (DB / cache / queue / API) — *needed: P3*  ·  ref: `features/04`, B-O8
For **each** third-party tool you want the AI to use (the goal: e.g. "let the agent query my database to see data"):

1. **Client in the image** — ensure its CLI client is present (common ones are pre-baked, §2; otherwise add it via the per-project Dockerfile).
2. **Two credentials per tool** — create a **read-only** user and a **read-write** user on the tool (e.g. a `ro` and `rw` MySQL/Mongo user). The stage's **`ro`/`rw` tier** picks which credential is injected at spawn → real, DB-level isolation (a read-only stage *physically* cannot write). (B-O8, decision 04.q3.)
3. **Wire it in the UI** — put the connection details in the workspace **Env vars**, configure the **Integration tool** (its `type` maps to the client; map its fields → the env vars), then **select it per stage** with a tier (`StageToolCfg{toolId, tier}`).
4. **MCP only as the exception** — use an MCP server only where a CLI client genuinely can't do the job (e.g. semantic RAG). Custom tools may declare their own `command` + allow-pattern; any wrapper is an **allow-listed `run-command`**, never a new agent verb (decision 04.q1).

> Example (MySQL, read-only for a Plan stage): bake `mysql` in the base image → create a `readonly` DB user → add `DB_HOST/DB_USER_RO/DB_PASS_RO/...` to workspace Env → configure a `mysql` Integration tool mapping to those → select it on the Plan stage with tier `ro`. The agent then runs `mysql ...` via its allow-listed Bash to inspect data.

## 7. Notifications / SSH / voice
- **Web-push VAPID keys** (PWA push notifications) — *P2*, B-34. Plus the email adapter (`RESEND_API_KEY` **or** `SMTP_*`; otherwise console-only).
- **SSH public key per user** — each operator pastes their public key (Account → SSH keys) to unlock terminals; the private key never leaves their device (B-05, gap **G19**). *P1.*
- **whisper.cpp** container for speech-to-text — **deferred** (voice is build-deferred, `features/06`, B-O1, gap **G27**). One shared orchestrator-side instance (decision 06.q3).

## 8. UI-Builder (code editor) — *needed: P5 / when the editor feature is built*
The whole-codebase VSCode-like editor is powered by your **external UI-Builder** project. It is **not in this repo yet** — you'll add it as an **in-repo folder at `src/workspaces/_uibuilder/`** when that feature is built (`features/08`, decision 08.q1). It's a **hard dependency provided later**; the doc defines the mount/props contract so the drop-in is mechanical. Until then, the read-only `FileDiffViewer` is the interim.

## 9. Framework prerequisites — *mostly already done*
- The framework remediations **R1–R5 + D-MT** (webhook origin-exempt seam, keyed client-registry, `registerRedisKeyFormatter`, streaming-upload seam, leader-election lease, multi-tenant doc) are landed/opt-in per **B-09**; the real post-publish repo just `npm install`s the `@luckystack/*` packages.
- The orchestrator runs as **one single-instance** process (it owns containers/worktrees/PTYs); only the **web-app** scales horizontally (gaps **G8/G16**). Multi-instance/DR detail lives in `05_BUILD_PLAN.md` **P4**, not here.
- Scheduler/queue (`bullmq` + `node-cron`) and the event-log are **app-built**, not framework (gaps **G1/G2**) — code, not operator setup.

## 10. Framework env vars you actually set (`.env` / `.env.local`)
From `.env_template` (real secrets go in `.env.local`): `NODE_ENV`, `PROJECT_NAME`, `SERVER_IP`, **`DNS`** (must be the real subdomain in prod, or CORS/OAuth break — gap **G15**), **`REDIS_HOST/PORT/USERNAME/PASSWORD`**, **`DATABASE_URL`** (MongoDB for RAG), OAuth `*_CLIENT_ID/SECRET` per provider, optional `RESEND_API_KEY`/`SMTP_*` (email), `SENTRY_DSN` (errors), `LUCKYSTACK_SECRET_MANAGER_URL` (optional secret-manager). Per-ticket containers additionally get `DNS=https://dev-<ticket>.<domain>` + `DATABASE_URL` + `REDIS_*` injected at boot (gap **G15**).

---

## Not an operator task, but related — the still-undocumented features
The orchestrator infra above serves features that **don't have a detailed doc yet** (the gap report): the existing screens (Board, Backlog+Sprints, Terminals UX, Sources mgmt, Members/RBAC, Account, Notifications, Usage/Budget, Activity+rewind, ⌘K) and flows (Auth, GitLab sync, preview-deploy, pause/kill). Those are a future `features/` batch — see `features/INDEX.md`. This setup doc already covers their *infra* prerequisites.

## Build-phase quick map
| Phase | Operator prerequisites that unlock it |
|---|---|
| **Prototype now** | `claude login` (for the dev terminal) — that's it |
| **P1 (Brain PoC)** | host `claude login` + clean env; Redis; base image; SSH-key per user; GitLab OAuth + per-workspace token |
| **P2 (flow)** | per-ticket containers (Docker + base image), Atlas Local + embeddings (RAG), web-push keys |
| **P3 (automation + integrations)** | per CLI-integration credentials (§6) |
| **P4 (hardening)** | Caddy + wildcard DNS/TLS, GitLab webhook, multi-instance/DR (05 P4) |
| **P5+ (editor, voice)** | UI-Builder folder (`_uibuilder/`); whisper.cpp container |
