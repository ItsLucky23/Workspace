# GAP ANALYSIS — depth audit (2026-07-07)

> Grounding for `DEPTH_PROGRAM.md`. Findings from a 3-agent code audit (dev-orchestration / cross-cutting /
> content+frontend), all grounded in the real code. Honest state of "all-in-1 AI tool for code + content".

## Verdict
- **Code / dev-orchestration = genuinely DEEP + real** (real PTY `claude`, real Docker, real git incl.
  merge/revert, real CI/deploy/MR, real AI providers). Shallowness only at the EDGES.
- **Contract spine = REAL + coherent** (single-writer, RBAC, tenancy-for-core, leader-election, app-owned
  AES crypto, framework auth). No bypass found.
- **Execution spine beyond the one CLI path = broad but ~0% tested against real AI/container/media infra.**
- **Content platform = a HOLLOW skeleton**: schema + control-ops + ~230 shape tests are real, but 100% stub,
  **invisible + unusable in the app** (no UI, no route, dead snapshot state), and no real gen/render/publish
  code exists. NOTE: the stubs were meant as the no-key TEST path; the real live code behind `available()`
  was never written (`generate()` returns `notImplemented`) — that is the gap to close, not just "add keys".

## Code-side gaps (edges)
1. **MR merge/rollback never pushes to origin** — real git op lands in the local bare clone; `pushBranch`
   exists but is not called by the merge/rollback path. → FIX.
2. Everything is Docker-gated (no Docker ⇒ execution half no-ops). → ACCEPTED (Docker-dependency is fine).
3. **Fire-and-forget without readiness checks** — preview/editor/deploy dispatch a serve-command + assume
   success; a real `health.waitForContainerReady` probe exists but is uncalled. → FIX.
4. **No retry/backoff/pagination** on network ops (git push no non-ff recovery; forge issue sync drops >100
   silently). → ADD where needed.
5. **CI YAML parser is a fixed-indent mini-subset** (real `.gitlab-ci.yml` largely dropped) + PTY turns use
   hardcoded `wait()`s instead of prompt-ready detection (fragile on slow turns). → FIX.

## Cross-cutting gaps
1. **Tenant-isolation leak surface** — `tenantDb`'s loud-fail row-isolation covers only ~24 core models;
   ALL newer models (Service/Forge/Environment/CI + the ENTIRE content set) are outside it and rely on
   hand-written `workspaceId` filters (one unscoped `environment.findMany({status:'live'})` already exists).
   One forgotten filter = a silent cross-tenant leak. → FIX so it can NEVER leak in use.
2. **Encryption fails OPEN** — `secretBox` silently falls back to `plain:<base64>` (UNENCRYPTED) when
   `WORKSPACES_ENC_KEY` is unset. → HARD-FORCE the key (fail-closed).
3. **~0% real-infra test coverage** — no test drives a real Claude/PTY turn, a real container, or real media
   gen; per-route business tests exist for 3 of ~62 routes. → the complete live e2e happens ONLY once the
   keys are in place + the real code is written (NOT while half the codebase is fake). Deferred, user-triggered.
- Minor: observability has real gauges but no tracing + spend cost is structurally 0; multi-instance is real
  but single-Redis best-effort (split-brain possible). → later.

## Content + frontend gaps (the big hollow)
1. **No content UI at all** — no `content` WsView, no nav item, no route, no page/component; the
   `snapshot.content` loaded into the provider is read by NOTHING (dead state). → BUILD the UI (rich but
   clear for non-technical first-time users + good setup flows).
2. **No real media generation** — every fal/elevenlabs `generate()` is `notImplemented`; ~90% of the gen
   surface is fake `stub://`. Adding keys alone won't help. → WRITE the real code behind `available()`;
   keep the stub as the no-key fallback. (User will add keys + budget soon — careful, it costs real money.)
3. **No render pipeline** — assembly is a DB row + fake URL; no Remotion dep, no ffmpeg. → BUILD a real
   render (ffmpeg, via Docker where possible). Make it broad/extensive.
4. **No publishing API** — YouTube/TikTok "posts" are fake URLs; no OAuth, no upload. → BUILD YouTube +
   TikTok + OAuth.
5. **No provider-key / €-budget settings UI** — budget is computed but never shown. → BUILD it + a
   KEY-SETUP GUIDE (how to get each key + where to put it + cost expectations).
6. Even the "real" LLM lane is half-stub (reference-video always uses a canned blueprint; script live-parse
   is trivial). → make it all actually work when keys are added.

## Where it IS deep (confirmed by tests)
The single-writer + RBAC + tenancy-for-core + leader-election + AES crypto + auth contract layer, and the
`claude-cli` node-pty coding agent, are real and coherent — the hard part, done well.
