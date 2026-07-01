---
description: Interactive AI browser verification with agent-browser (navigate/click/fill/screenshot/console). Cheapest-first; always propose + get user approval before driving a browser. See docs/luckystack/AI_BROWSER_TESTING.md.
---

# agent-browser (interactive verification)

Use the **agent-browser** CLI to verify a frontend flow against the LOCAL dev server.
Always announce the action and get explicit user approval first (see the "AI Browser
Testing" section of CLAUDE.md + docs/luckystack/AI_BROWSER_TESTING.md).

## Setup (once, developer action)
- Install: `npm i -g agent-browser && agent-browser install` (fetches Chrome-for-Testing), OR
- Get the always-current usage skill: `npx skills add vercel-labs/agent-browser` then
  `agent-browser skills get core`.

## Guardrails (shipped `agent-browser.json`)
- `allowedDomains: ["localhost","127.0.0.1"]` — fenced to the dev server.
- `confirmActions: ["click","fill","navigate"]` — per-action confirmation.

## When NOT this tool
- Cross-browser / mobile rendering or a real vision styling judgement → Playwright MCP.
- Lighthouse / performance traces → Chrome DevTools MCP.
- Generating COMMITTED tests/audits → the `/agent-browser`, `/lighthouse`, `/a11y-audit` skills.
