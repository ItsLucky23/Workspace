# Fix round 2026-08-22 — 3-agent setup

Fixes for the 125 findings in `../UI_FUNCTIONAL_AUDIT_2026-08-22.md` (audit baseline: commit `55ff5b7`), split over three AI agents that can run **simultaneously** without stepping on each other.

| Agent | Model class | Handoff file | Branch | Work |
|---|---|---|---|---|
| 1 | Smart (Fable-class) | `AGENT_1_FABLE.md` | `fix/audit-crit-high` | All 3 critical + 25 high findings, in 10 batches |
| 2 | Fast/cheap | `AGENT_2_DEVELOP.md` | `fix/audit-develop` | 49 medium/low — develop module, provider, terminals |
| 3 | Fast/cheap | `AGENT_3_CONTENT_SHELL.md` | `fix/audit-content-shell` | 48 medium/low — content, settings, shell UI, workspace-settings |

## Why the phases exist

40 of the 97 medium/low findings live in files Agent 1 rewrites (e.g. `workspace/page.tsx`, `pipeline/stageTabs.tsx`, `Shell.tsx`, marketing/studio). Fixing those in parallel would guarantee merge conflicts. So Agents 2 and 3 each have:

- **Phase A** — files Agent 1 never touches. Safe to run NOW, in parallel with Agent 1.
- **Phase B** — files Agent 1 owns. Start ONLY after Agent 1's branch is merged into `main` and your branch is rebased onto it. Re-verify each Phase B finding against the merged code first: Agent 1's rewrites may have fixed or moved some of them.

## Setup (owner does this once)

Three git worktrees so all agents work simultaneously on one clone:

```
git worktree add ../Workspace-fix1 -b fix/audit-crit-high
git worktree add ../Workspace-fix2 -b fix/audit-develop
git worktree add ../Workspace-fix3 -b fix/audit-content-shell
```

Run each AI in its own worktree. `npm install` once per worktree if needed. **Merge order: Agent 1 → Agent 2 → Agent 3** (then Agents 2/3 rebase and run Phase B). Locale-file conflicts at merge time: resolve by UNION (keep both sides' added keys).

## Shared rules

- Only one dev-server/test-sweep can run at a time (ports). `npm run lint`, `npm run build`, `npm run test:unit` are safe everywhere.
- Each agent tracks progress by ticking checkboxes in its OWN handoff file and filling the Result lines — that file is the source of truth.
- Cross-agent dependency notes are marked inline in the handoff files.
