# Product

> Plain-language description of what THIS app is and what it is for — the INTENT layer. Maintained by the
> AI (and you): kept current when features land. Folded into the generated `docs/AI_PRODUCT_OVERVIEW.md`
> together with each page's `//? intent:` line.

## What this is

Workspaces is a self-hosted platform where AI does the executing work of software development and content production while a human stays in charge of decisions. You write a simple ticket; a configurable pipeline of stages (refine → plan → implement → test → review) lets a coding agent — Claude Code, or the pi agent on a Codex/ChatGPT seat — do the work in an isolated Docker container. The human is a man-in-the-middle who only approves and answers questions, ideally from a phone (PWA with push notifications). The AI proposes; the user accepts; the deterministic Conductor — the only writer of board, git, and status state — executes.

## Who it is for

Self-hosting solo developers and small teams who want AI to carry the executing work — coding, testing, reviewing, producing content — while keeping every consequential decision behind human approval. They run Workspaces on their own infrastructure, on their own AI subscription seats, and steer the whole thing from a board and an answer inbox instead of a terminal.

## Key areas

- **Develop** — the core loop. A scrum board where AI moves tickets through the pipeline stages; the user creates tickets, answers the agent's questions (a cross-ticket answer inbox collects them), and approves stage promotions. Around it: backlog and sprint management, the pipeline stage editor (per-stage model/context/behavior config), automations (event- and cron-driven triggers), live terminals into running ticket containers, a repo-aware Interviewer chat that turns findings into tickets, a read-only code browser, and a per-ticket in-browser VS Code (openvscode-server) running inside the ticket's container. GitLab integration syncs the board with the forge, and a built-in MR review surface handles diffs, review threads, approvals, and merges.
- **Content** — an AI content studio. Content pieces move through their own 6-stage pipeline (idea → script → media → assemble → review → publish) producing AI video, image, and audio with per-workspace euro budget caps, cost confirmation before generation, and publish gates to channels such as YouTube and TikTok. Includes marketing asset generation from a product brief, scheduled posts, brand-voice management per channel, and content insights (performance, short links and A/B tests).
- **Design** — the Designer and Studio surfaces: author the product's visual language (themes, styles, typography, animations) as the design system the coding agent builds with, preview it across a component showcase, and generate brand and marketing assets from a brief.
- **Documents** — an AI-drafted document library (specs, plans, briefs, sheets). The AI drafts side by side with your text; applying the draft is the consent — the AI never overwrites directly. Documents export to PDF, Word, Excel, and HTML.
- **Insights** — the workspace-wide activity feed (every command, file change, AI message, status move), the knowledge graph mapping sources, tickets, and content pieces, and usage dashboards: tokens per day/ticket/person/provider, spend records, budget caps, and delivery analytics.
- **Platform layer** — multi-tenant workspaces with role-based access control, realtime updates for every member (Socket.io, merge-by-seq), a RAG knowledge layer feeding agents repo and product context, per-workspace secrets, and a leader-elected orchestrator that is safe to run as multiple instances.

## Glossary

- **Workspace** — the tenant: an isolated environment with its own members, roles, projects, tickets, content, budgets, and secrets.
- **Project** — a linked code repository (e.g. a GitLab repo) that a workspace's Develop module works on.
- **Ticket** — the unit of work the user writes and the AI executes; it moves across the board through the pipeline stages.
- **Stage / pipeline** — one step in the configurable sequence a ticket flows through (refine, plan, implement, test, review); each stage runs its own agent with its own configuration.
- **Conductor** — the deterministic, LLM-free orchestrator component that is the only writer of authoritative state (board, git, status). AI proposes, the user accepts, the Conductor executes (invariant B-23).
- **Coding agent / seat / harness** — the interactive AI session that writes code: Claude Code on a Claude subscription seat, or the pi harness on a Codex/ChatGPT seat. Always an interactive PTY, never headless or API-billed.
- **Sync / control-op** — the two realtime primitives: sync events push server state to clients (merged by sequence number), and control-API ops are the only path for user-initiated writes (route → RBAC check → queue → Conductor).
- **Module** — a top-level product area of a workspace: Develop, Content, Design, Documents, Insights.
- **Content piece** — one unit of content (a video, image set, or audio item) moving through the content pipeline toward publication.
- **Brief / artifact** — a short product description (brief) the AI turns into generated assets (artifacts): landing pages, copy, ads, scripts, thumbnails.
- **RAG / knowledge** — the retrieval layer that indexes the repo, uploaded docs, and product knowledge so agents answer from the workspace's actual context.
- **MR review** — the built-in merge-request experience: diff, review threads, approvals, and merge for the changes a ticket produced.
- **Autonomy level** — how much the AI may do without asking: from gate-every-stage to letting the pipeline run and only surfacing questions and final approvals.
