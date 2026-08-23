# Workspaces

Workspaces is a self-hosted, AI-driven development and content orchestration platform built on the [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2) framework. You write simple tickets; a configurable pipeline of stages (refine → plan → implement → test → review) puts a coding agent to work on each one inside an isolated Docker container. The human stays in the loop as a man-in-the-middle who only approves and answers questions — phone-first, as a PWA with push notifications.

The coding agent is always an interactive harness on a subscription seat: Claude Code (Claude subscription) or the pi agent on a Codex/ChatGPT seat (ADR 0322). Never headless, never the Agent SDK, never an API key for coding work. Other AI providers are available for non-coding tasks (content generation, review, chat) through a pluggable per-feature provider registry.

All authoritative state — board, git, ticket status — is written by exactly one component: the deterministic Conductor (invariant B-23). LLMs and users only propose; every user-initiated write flows through a control-API op that the Conductor executes. Clients converge in realtime over Socket.io by merging on sequence numbers.

## Modules

- **Develop** — the scrum board and AI pipeline: tickets, backlog and sprints, the stage editor, an answer inbox for AI questions, live in-container terminals, a repo-aware Interviewer chat, a read-only code browser, automations (event + cron triggers), and a per-ticket in-browser code editor (openvscode-server running inside the ticket's container).
- **Content** — an AI content studio: a 6-stage pipeline (idea → script → media → assemble → review → publish) for AI video/image/audio pieces, with budget caps, cost confirmation, and publish gates to channels such as YouTube and TikTok; plus marketing asset generation and scheduled posts.
- **Design** — the Designer/Studio surface: design systems, themes, styles and typography the coding agent builds with, a component showcase, and brief-driven brand/marketing asset generation.
- **Documents** — an AI-drafted document library (specs, plans, briefs) with side-by-side draft review (apply is the consent) and export to PDF/Word/Excel/HTML.
- **Insights** — the workspace-wide activity feed, a knowledge graph of sources/tickets/pieces, and usage dashboards (tokens, spend, budgets, delivery analytics).

Workspaces are multi-tenant with role-based access control; every orchestrator-side path runs tenant-scoped row isolation (`runInTenant`). Git hosting integrates with GitLab (webhook ingestion, board sync) plus a built-in MR review experience, and a RAG knowledge layer feeds the agents repo and product context.

## Architecture in five lines

1. **LuckyStack socket-first** — React 19 frontend over a raw Node.js + Socket.io backend with file-based routing for pages, `_api` routes, and `_sync` realtime events.
2. **Conductor single-writer** — one deterministic component executes all board/git/status writes; AI proposes, the user accepts, the Conductor executes (B-23).
3. **Pipeline stages in containers** — each ticket-stage runs its agent in an isolated Docker container with per-ticket cloning, scoped tokens, and egress control.
4. **Coding-agent seats** — interactive PTY sessions (node-pty) on Claude Code or pi/Codex subscription seats; structured output via hooks and a frozen structured channel, never scraped from the terminal.
5. **Multi-instance safe** — a leader-elected orchestrator (leader lease + per-workspace write locks) so N instances can run while exactly one drives the background loops.

## Quick start (development)

```bash
npm install

cp .env_template .env
cp .env.local_template .env.local
# Fill in .env.local: DATABASE_URL, WORKSPACES_ENC_KEY (generation command is in the template),
# and any provider keys you want live — see docs/KEY_SETUP_GUIDE.md

npm run prisma:generate
npm run prisma:db:push

# Terminal 1 — backend (HTTP + Socket.io):
npm run server

# Terminal 2 — frontend (Vite dev server):
npm run client
```

Open <http://localhost:5173>. To run the full test set (standalone suites, endpoint sweep, per-route tests, Playwright):

```bash
npm run test:all
```

## Documentation

| Doc | Purpose |
| --- | --- |
| `CLAUDE.md` | The AI development contract: rules, invariants, and the map of every other doc |
| `docs/SETUP_FROM_SCRATCH.md` | Full environment setup from a clean machine |
| `docs/KEY_SETUP_GUIDE.md` | Which API keys and secrets power which feature, and how to obtain them |
| `docs/HOSTING.md` | Deployment and hosting |
| `docs/TESTING_PLAYBOOK.md` | Test layers, commands, and recipes for new tests |
| `src/workspaces/_docs/README.md` | The Workspaces design corpus: architecture, protocols, and build docs |
| `docs/PRODUCT.md` | Plain-language product description (the intent layer) |
