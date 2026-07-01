# AI-context eval harness

> The measurement nothing else in this repo provides: **do the committed AI-context
> artifacts actually make the AI's output better?** This is the hard signal ADR 0003
> requires before any RAG rung is justified.

## What it is

A deterministic scorer (`scoreEval.mjs`, `npm run ai:eval`) over a golden set of
scenarios (`scenarios/*.json`). Each scenario declares a `prompt` and the
**measurable** properties a good answer should have (`expects`) — which MCP tools
were used, whether an existing helper was reused, which ADR was cited, whether a
test was added, whether transport parity held. No LLM runs inside the scorer; it
grades a small **candidate record** you capture by hand.

## How to run it (the with/without comparison)

1. `npm run ai:eval` — list the golden-set scenarios.
2. For a scenario, run its `prompt` in Claude Code **twice**:
   - **with** the artifacts + `@luckystack/mcp` available (normal repo state),
   - **without** them (e.g. a checkout with `docs/AI_*` + `.mcp.json` removed).
3. After each run, capture what the agent did as a candidate JSON:
   ```json
   { "toolsUsed": ["get_capability"], "reusedHelper": true, "citedAdr": "0007",
     "addedTest": true, "stayedInParity": true, "citedRoutes": ["api/user/getProfile/v1"] }
   ```
4. Score each:
   ```
   npm run ai:eval -- --scenario add-auth-route --candidate with.json
   npm run ai:eval -- --scenario add-auth-route --candidate without.json
   ```
5. **The delta is the artifact-value signal.** If "with" consistently beats
   "without", the structured rungs are doing their job. If natural-language recall
   scenarios score poorly even *with* them, that's the documented trigger to
   consider the RAG rung (ADR 0003).

## Files

- `scoreEval.mjs` — the scorer. `npm run ai:eval -- --selftest` proves its logic.
- `scenarios/*.json` — the golden set (extend it; one file per scenario).

## Checkers available in `expects`

`usesTools` (all), `usesAnyTool` (any), `reusedHelper`, `citedAdr`, `addedTest`,
`stayedInParity`, `citedRoutesNonEmpty`. Add new ones in `CHECKERS` in `scoreEval.mjs`.
