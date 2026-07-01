# AI Browser Testing

> How an AI agent verifies your LuckyStack frontend — functional flows, cross-browser
> styling, and Lighthouse/performance — **cheaply by default and always behind your
> explicit approval.** Wired into your project when you pick the AI browser tooling at
> scaffold time (`--ai-browser=all|agent-browser|none`). These are **dev tools** — never
> runtime dependencies.

## The three tools

| Tool | How the AI uses it | Strongest at | Limits |
|---|---|---|---|
| **agent-browser** (`vercel-labs/agent-browser`) | CLI — the AI shells out via Bash. a11y-tree snapshots (~200-400 tok/page). | Action/flow verification (click/fill/login/navigate), "does it work", console/errors/network, single-browser screenshot + visual-diff, Web Vitals. **Cheapest by far.** | No Lighthouse. Visual fidelity = screenshots only. |
| **Playwright MCP** (`@playwright/mcp`) | MCP server — native tool-calls. | **Cross-browser** (Chromium/Firefox/WebKit) + **device emulation** + **vision-based styling** review. | ~13k token schema when active. |
| **Chrome DevTools MCP** (`chrome-devtools-mcp`) | MCP server — CDP. | **Lighthouse** audits, **performance traces / Core Web Vitals / bottlenecks**, deep network + console diagnostics. | Chrome-only. ~13k token schema when active. |

## The decision ladder (cheapest-first)

1. **DEFAULT → agent-browser** (~80-90%): navigate, click, fill, login matrix, "does the flow work", read console/errors/network, quick screenshot + single-browser visual-diff, Web Vitals.
2. **ESCALATE → Playwright MCP** only when: it must render correctly in **Firefox/WebKit or on mobile**, OR a **vision styling judgement** beyond a single screenshot is needed.
3. **ESCALATE → Chrome DevTools MCP** only when: a **Lighthouse** score, a **performance trace / Core Web Vitals / bottleneck analysis**, or deep perf-coupled network/console diagnostics is needed.

> Rule of thumb: start at the cheapest rung; only climb when the task genuinely needs the higher rung's exclusive capability.

## Suggest → approve protocol

The AI must **never** silently launch a browser tool. It proposes a tool + the reason, then waits for your approval. Three enforcement layers ship with your project:

1. **CLAUDE.md rule** — the "AI Browser Testing" section requires cheapest-first + an explicit *"I want to verify X → cheapest fit = `<tool>` → approve?"* announcement.
2. **`.claude/settings.json` `permissions.ask`** — the browser tools are deny-by-default, so the harness prompts even if the AI forgets the rule. (First use of an MCP server also shows a one-time "trust this server" prompt.)
3. **`agent-browser.json`** — `allowedDomains: ["localhost","127.0.0.1"]` fences it to your dev server; `confirmActions: ["click","fill","navigate"]` confirms each state-changing action.

## Before any browser test (developer actions)

- **Start the dev server** — `npm run server` + `npm run client`. The AI asks you to start it; server-start is always your action.
- **Install the tools** — `npm i -g agent-browser && agent-browser install` (fetches Chrome-for-Testing). The MCP servers (`@playwright/mcp`, `chrome-devtools-mcp`) launch via `npx` from `.mcp.json` — no install step, but the first run downloads them.
- **Auth** — use a **dedicated test account**; let the tool persist its own session/state-file. **Never read `.env.local`** (real secrets).

## Example invocations

```bash
# agent-browser — verify the login flow against the dev server
agent-browser navigate http://localhost:5173/login
agent-browser fill "@email" you@test.dev && agent-browser fill "@password" "test-pass"
agent-browser click "@submit"
agent-browser console        # read console/errors after the action
agent-browser screenshot     # single-browser visual check
```

Playwright MCP and Chrome DevTools MCP are driven via their native MCP tool-calls (the AI selects them from the schema once approved) — e.g. "render `/dashboard` in WebKit + mobile and judge the layout" (Playwright MCP) or "run Lighthouse on `/`" (Chrome DevTools MCP).

## The committed-test complement

Once agent-browser confirms a flow interactively, capture it as a **deterministic `@playwright/test` spec** under `tests/e2e/` (shipped example: `tests/e2e/example.spec.ts`). That keeps the LLM out of the permanent CI loop — the spec runs in CI without an AI. (Delete `tests/e2e/` + the `@playwright/test` devDep if you don't want this layer.)

## Related skills (generate committed artifacts)

These existing skills **generate** committed tests/audits (complementary to the interactive tooling above):

- `/agent-browser` — generate per-route E2E tests.
- `/lighthouse` — performance audit + code-split candidates.
- `/a11y-audit` — axe-core accessibility sweep + Tailwind-token contrast.

## Trimming token cost

Each active MCP server adds ~13k tokens of tool-schema per session (~26k for both). agent-browser (CLI) has zero standing cost. To trim: delete a server from `.mcp.json` (and its `permissions.ask` entry). The ladder + confirmation keep actual usage cheapest-first regardless.

> Config paths above are Claude Code's. Other AI clients (Cursor, etc.) use different config locations — adapt `.mcp.json` / permissions accordingly.
