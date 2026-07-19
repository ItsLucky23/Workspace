---
title: Assistant parity by default — the 72-op tranche, copilot reach for propose-less surfaces, and project-facts Q&A
status: accepted
date: 2026-07-20
tags: [workspace-ai, chat, op-catalog, parity, copilot, rag, b-23]
---

# Context

The op catalog held 182 control ops: 76 assistant-proposable (`enabled`), 78 parked as `later`
(safe in principle, missing only a client dispatcher) and 28 `excluded` (secret/credential/auth
plumbing). The owner's directive: "the Workspace-AI must be able to do everything the UI can, and
answer technical questions about the project." Separately, non-op `_api` surfaces (Designer/Studio
generation, voice, SEO) had no assistant path at all, and "is X possible with this project?" relied
on semantic code-chunk retrieval that reliably missed dependency/stack facts.

# Decision

1. **Parity by default.** Every `later` op whose manual UI dispatch path exists was flipped to
   `enabled` — 71 ops (total 147) — each with a researched catalog entry (params, hint,
   destructive flag) and a `CHAT_DISPATCH` entry that reuses the exact `_sync` route the manual UI
   uses. B-23 stays intact end-to-end: the AI proposes; accept → RBAC → Conductor; destructive ops
   keep the mandatory extra confirm. Ops staying deliberately `later`: the route-less/aliased four
   (content-create, content-reorder-beats, gitlab-verify, raise-cap), the pre-existing pins, and
   `ai-skill-delete` — an earlier recorded decision ("deleting a user-authored skill stays
   UI-only", pinned by couplingBridges) that this tranche initially overrode and then restored;
   overruling it is an open owner call. The 28 `excluded` ops remain excluded — the assistant
   never touches secrets, credentials or auth.
2. **Copilot reach instead of new verbs.** Propose-less surfaces (Designer/Studio generation) are
   reachable through the existing copilot lane: COPILOT_NAV now covers every view, and the
   Designer + Studio pages consume `copilotPrefill` (navigate + prefill, never auto-submit).
3. **Project-facts Q&A.** `workspaceStateText` gained a structured project-facts block (stack,
   dependencies, DB kind, service stacks, deploy targets, env KEY NAMES only) plus eleven new
   reference collections (documents, sprints, invites, findings, styles, …) that double as
   validation grounds for the new ops' id-params.
4. **System-prompt transport.** The grown prompt broke Windows' ~32k argv limit in the Claude-CLI
   provider (spawn error 206). When the provider owns the cwd (the throwaway runDir) the system
   prompt now ships as a `CLAUDE.md` there — auto-loaded by the CLI at session start, same
   instruction tier, no argv limit. The PTY-billing invariant is untouched (still the interactive
   CLI, never `-p`/SDK).

# Rejected alternatives

- **Selective enablement (only "high-value" clusters):** rejects the owner's parity directive and
  recreates the drift this tranche closes; the catalog's mode field already provides the safety
  taxonomy.
- **New chat verbs for Designer/Studio generation:** violates the frozen-verb invariant; the
  copilot lane already models "AI drives the UI, the human presses the button".
- **Prompt-size cuts to stay under the argv limit:** starves the model of exactly the state the
  parity ops validate against.

# Consequences

- `opCatalogParity` grew to 346 assertions and pins the tranche (enabled≡client set, destructive
  flags, excluded-never-validates, the 6 deliberate `later` pins).
- Live proof: the assistant proposed the newly-enabled `archive` op, the destructive confirm
  rendered, the Conductor executed it — which surfaced that board/backlog had NEVER filtered
  soft-archived tickets (the op's UI contract existed only in prose). Both now filter
  `archived === true`.
- The one-shot runDir gained a CLAUDE.md file per chat turn; callers that pin their own cwd keep
  argv (small prompts) or a PTY-stdin prefix (oversized) — no caller does today.
