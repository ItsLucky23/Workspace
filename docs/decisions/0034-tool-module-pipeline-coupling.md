---
id: 0034
title: Tool-module ↔ pipeline coupling (design-system, interview findings, ticket↔artifact)
status: accepted
date: 2026-07-05
tags: [pipeline, designer, interviewer, studio, coupling, injection, b-23]
supersedes: []
---

# Tool-module ↔ pipeline coupling

## Context

The Designer, standalone Interviewer, and Marketing/Studio surfaces were built as **standalone tool-modules**: the Designer's themes/styles/animations are client-only React state (lost on reload, no Prisma model); the standalone Interviewer chat is ephemeral (`workspaces/aiChat`) and its agent-role output is **notification-only**; Studio artifacts persist but link to nothing. Meanwhile the pipeline feeds the in-container coding `claude` agent **only** through `InfoSource` context-docs (`sourceIds` → `renderStage` → `/work/CLAUDE.md`) + RAG excerpts (`stageRunner.runStage`). So **none of the tool-modules reach the coding agent**, and a chosen theme/finding has no path into the work.

The user decided (2026-07-05) to couple them, with the active design choice held **workspace-wide** (not per-ticket).

## Decision

1. **Design-system is the coupling.** Persist the Designer library as `DesignArtifact` rows (kind `theme|style|animation`, `active` flag). One **active theme + style per workspace** is the fixed truth; the Designer stays a playground. From the active choice we synthesize a single `InfoSource(mode:'context-doc', source:'design-system', name:'Design system')`; `stageRunner` auto-injects `source:'design-system'` into **every** stage's `CLAUDE.md` (same seam as `source:'starter'`). The coding agent thus builds on-brand. Optional **"Apply to app"** emits a `WorkspaceSuggestion(type:'design')` carrying the `src/index.css` `@theme` token-diff; on accept the **Conductor** writes it (single-writer, B-23).

2. **Interviewer findings persist + categorize.** New `InterviewFinding` (workspace-scoped: `area`, `severity`, `status open|accepted|dismissed`, `title`, `summary`, `detail`). The interviewer role/chat write structured findings instead of a bare notification. **"Make ticket from finding"** (human-clicked, B-23) creates a `Ticket` → feeds the pipeline.

3. **Ticket ↔ artifact link.** New `TicketArtifactLink` (ticket → `DesignArtifact`/`StudioArtifact`) — a live reference the Conductor reads at stage-spawn to inject the artifact as extra context.

4. **Persist the Designer + reuse Studio for Marketing** (fixes the reload-loss gap).

## Rejected alternatives

- **Per-ticket design-system** — rejected for V1: workspace-wide default is simpler and matches "one design truth per project"; a per-ticket override can layer on later via `TicketArtifactLink`.
- **Hardcoding design choices in the agent system prompt** — rejected: the tokens are per-project, user-edited data, not a framework constant; they belong in an injected `InfoSource` context-doc (the existing seam), not in code.
- **A single `ModuleArtifact` mega-table** (the handoff-corpus design) — rejected: reusing `InfoSource` for injection plus focused `DesignArtifact`/`InterviewFinding` tables fits existing conventions with less abstraction.

## Consequences

- Schema grows (`DesignArtifact`, `InterviewFinding`, `TicketArtifactLink`; `WorkspaceSuggestion.type` gains `'design'`/`'interview-answer'`).
- The coding agent becomes design-aware via the proven `sourceIds` seam — no new agent-context mechanism.
- B-23 preserved: every write (design-system doc, apply-to-css, make-ticket) flows through the Conductor / a control-op, human-gated.
- Fixes the existing gap where accepting a `config-review` suggestion did not apply its patch — the apply path is now built for `type:'design'` and generalized.
