# Branch: fix/audit-leftovers

> Append-only progress log. New entries to the bottom.

## 2026-08-23 13:20 — Complete remaining Agent 5 leftovers

**User prompt (summary)**: Continue the Agent 5 leftovers work after the progress check; verify each item, commit each item, and finish the checklist.

**What I did**:
- Fixed F-122 by putting Usage tabs in the URL trail.
- Fixed F-123 by preserving raw custom invite role keys/labels in snapshot and realtime projections.
- Fixed F-037 by reusing the frozen `accept-suggestion` op with `action: 'dismiss'`, persisting dismissals through the Conductor.
- Fixed F-084 by deleting the dead `listPats` route/test and regenerating API artifacts.
- Fixed F-085 by adding the typed project-context generation action to Sources with SavePill/notification feedback and repo gating.
- Fixed F-045 by tagging persisted Interviewer chat rows and separating them from the shell Assistant history.
- Fixed F-064 with shared brand-layer ladder notes and cross-links on product context, Studio Brand Library, and channel voice surfaces; translations were added in all four locales.
- Updated `AGENT_5_LEFTOVERS.md` result lines and checkboxes for all 13 findings.

**Verification**: Per item, `npm run lint`, `npm run build`, `npx tsc --noEmit -p tsconfig.json`, `npm run ai:lint`, and `npm run test:unit` passed. The unit suite passed at **130/130**. No development server was started.

**Commits**: `f6c5867`, `aa43d57`, `c3ab7af`, `d7c6c85`, `21e915a`, `2eb4fdc`, `913e9fa`.
