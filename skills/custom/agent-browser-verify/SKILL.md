---
name: agent-browser-verify
description: Interactively verify a LuckyStack flow (esp. the login matrix) with agent-browser against the running dev server — propose the tool + get user approval first.
category: automation
---

# Skill: /agent-browser-verify

INTERACTIVE verification of a running LuckyStack app with [`agent-browser`](https://github.com/vercel-labs/agent-browser) (and, on escalation, the Playwright / Chrome DevTools MCP servers). This is the *interactive dev-verify* counterpart to the `/agent-browser` skill (which GENERATES committed E2E tests). Use it to confirm a flow works before writing the committed spec.

> **Always propose the tool + reason and wait for explicit user approval before driving a browser.** Follow the cheapest-first ladder + protocol in `docs/AI_BROWSER_TESTING.md` and the "AI Browser Testing" section of `CLAUDE.md`. The harness also gates these tools via `.claude/settings.json` `permissions.ask`.

## When to use

- Manually verifying the **login matrix** (the recurring "left for the user" item): credentials login in BOTH cookie and sessionStorage modes, OAuth per configured provider, re-login while already signed in, register-while-logged-in.
- Confirming a page/flow works end-to-end before capturing it as a `@playwright/test` spec.
- Reading console/network/errors after an action.

## Prerequisites (developer actions — ask the user)

- Dev server running: `npm run server` + `npm run client` (server-start is always the user's action).
- `agent-browser` available: `npm i -g agent-browser && agent-browser install`.
- A **dedicated test account** (never read `.env.local`).

## Workflow

1. **Announce + get approval**: "I want to verify `<flow>` → cheapest fit = `agent-browser` → approve?". For an escalation (cross-browser/vision → Playwright MCP; Lighthouse/perf → Chrome DevTools MCP) name the exclusive capability that forces the higher rung.
2. **Drive agent-browser** fenced to `localhost`/`127.0.0.1` (per `agent-browser.json`): navigate → fill → click → `console`/`errors` → `screenshot`.
3. **Login matrix specifics**:
   - Cookie mode (`sessionBasedToken: false`): assert the HttpOnly session cookie is set + CSRF on writes.
   - sessionStorage mode (`sessionBasedToken: true`): assert the token lands in `sessionStorage`; OAuth `?token=` is consumed from the URL.
   - Re-login while signed in: log in as account B while A is active → session becomes B, no bounce.
4. **Report** what passed/failed with the console/network evidence.
5. **Offer the committed complement**: once green, propose writing a deterministic `@playwright/test` spec under `tests/e2e/` so CI covers it without an LLM in the loop.

## Output

A short pass/fail report per checked case + (on request) a generated `@playwright/test` spec. No state-changing action runs without the per-action confirmation from `agent-browser.json`.
