---
id: 0008
title: The claude-cli provider runs in a scratch cwd — AI-gen prompts must be pure-context
date: 2026-07-02
severity: medium
area: ai-provider, docs-gen, dockerfile-gen
tags: [ai, claude-cli, prompt]
---

## What happened

The first `generateProjectDoc` turn (register-flow D) returned a doc that opened with:
*"I checked the working directory for the referenced README, but it doesn't exist — the
only file present is `settings.json`. Here is the summary based on what is actually
there…"* — an awkward, self-doubting preamble instead of a clean doc.

## Root cause

`server/ai/providers/claudeCli.ts` spawns the interactive `claude` PTY in a **temp scratch
dir** (`ws-ai-<pid>-<hrtime>/`), NOT in the repo. That dir contains only the rendered
`.claude/settings.json`. The repo content is passed to the model **inline in the system
prompt** (file tree + manifests). But `claude` is an AGENT with filesystem tools, so it
*also* looked at its actual cwd, found only `settings.json`, saw the mismatch with the
"README" I'd listed, and narrated the discrepancy into the output.

## How to avoid

Any feature that drives `claude-cli` with repo context in the PROMPT (docs-gen,
dockerfile-gen, workspace-chat, …) must tell the model explicitly:
> "Base your answer ONLY on the files listed below. Do NOT read the filesystem or run any
> tools — your working directory is empty; the repo content is provided inline here."

Adding that line removed the preamble and produced a clean, factual doc. The alternative —
running the provider IN a repo checkout so the agent's tools see real files — is heavier
(needs a worktree/volume per call) and is deferred; pure-context prompting is the V1 answer.
Related: [[ai-provider-abstraction]], the provider's scratch-cwd design in `claudeCli.ts`.
