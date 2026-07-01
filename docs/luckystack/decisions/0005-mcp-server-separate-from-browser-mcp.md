---
name: mcp-server-separate-from-browser-mcp
title: Ship @luckystack/mcp as its own npx-run MCP server, separate from the browser MCP servers
status: accepted
date: 2026-06-11
deciders: [mathijs]
tags: [ai-tooling, mcp, packaging, scaffold]
supersedes: []
relates: [0001, 0004]
---

## Context

The framework now produces several committed AI-context artifacts (the indexes, decisions, runbooks, and
the dependency graph). To let an AI *query* them (instead of loading whole files), we add an MCP server.
The scaffold already wires the `playwright` + `chrome-devtools` MCP servers (browser testing) into
`.mcp.json` when `--ai-browser=all`. The user asked whether the new server should be merged with those.

## Decision

Ship `@luckystack/mcp` as its own standalone read-only stdio MCP server, **separate** from the browser
MCP servers. They coexist as distinct entries in the same `.mcp.json` (`luckystack` vs `playwright` /
`chrome-devtools`) — MCP supports multiple servers, each with its own tool namespace; they are not merged
into one process. Specifics: it runs via `npx @luckystack/mcp` (no app dependency — Claude Code spawns it
with cwd = project root); it is gated on the `aiInstructions` scaffold choice (it is repo-context tooling,
alongside CLAUDE.md/docs/indexes), NOT on `aiBrowserTooling`; it is read-only and reads only committed
artifacts; and it is NOT a server-boot plugin (no `OPTIONAL_PACKAGES` entry).

## Rejected alternatives

- **Merge into one MCP server with the browser tools** — rejected: different concerns (repo introspection
  vs browser automation), different lifecycles, different owners (browser ones are external `npx` packages
  we don't control). One server mixing both would be a grab-bag with no upside.
- **Gate it on `aiBrowserTooling==='all'`** (where the browser MCP entries live) — rejected: it has nothing
  to do with browser testing; a user who wants repo-context tools but not browser MCP would miss it. Gate
  on `aiInstructions` instead.
- **Make it a server-boot plugin (`OPTIONAL_PACKAGES`) / app dependency** — rejected: it's a dev-time
  query tool launched by Claude Code, not part of the app's runtime boot. `npx` + a `.mcp.json` entry is
  all a consumer needs; no `npm i` required.

## Consequences

- `@luckystack/mcp` is added to the build + publish waves (leaf, only deps `@modelcontextprotocol/sdk` +
  `zod`). The scaffold writes the `luckystack` `.mcp.json` entry in the `aiInstructions` block; it merges
  additively with whatever `wireAiBrowserTooling` writes.
- Existing projects adopt it by adding the one `.mcp.json` entry (documented in the package README) — no
  install, no code change.
- One scoped eslint exception (`import-x/no-unresolved` ignores `@modelcontextprotocol/sdk/` in
  `packages/mcp`) because the SDK's `exports` types-wildcard (`*.d.ts`) doesn't match its `*.js` import
  subpaths; tsc + Node resolve it, the eslint resolver alone cannot. Documented in `eslint.config.js`.
