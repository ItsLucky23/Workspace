# LuckyStack Skills

This directory contains Claude Code skills available to AI assistants working in this repository.

## Folder Structure

- `official/` — Anthropic-published skills. Placeholder for now; framework-team does not author files here.
- `custom/` — Framework- and project-specific skills authored in this repo.

See `custom/README.md` for the index of available custom skills.

## How Claude Code Loads Skills

Skills are invoked via the `Skill` tool. The argument passed is the skill name (the folder name under `skills/custom/` or `skills/official/`). When invoked, Claude reads the corresponding `SKILL.md` file as its workflow definition and follows the steps described there.

A skill folder MAY contain additional files (templates, examples, helper docs) that the `SKILL.md` references.

## Skills vs Slash Commands

Both extend Claude Code behavior, but they serve different purposes:

| Aspect | Slash Command (`.claude/commands/`) | Skill (`skills/`) |
| --- | --- | --- |
| Trigger | User types `/<name>` in chat | AI invokes `Skill` tool by name |
| Scope | Quick prompt template, single intent | Complete workflow with sub-steps |
| Composition | One markdown file | A folder with `SKILL.md` + optional supporting files |
| Tool use | Inherits caller context | Can prescribe specific tool calls and sequencing |
| Best for | One-shot prompts ("review this PR", "save session") | Multi-step procedures with checklists ("add a new API endpoint") |

Rule of thumb: if the procedure has more than three steps or requires consulting multiple files/templates, write a skill. If it is a single instruction the user wants to type quickly, write a slash command.

## Naming Convention

- All skill folder names use `lower-kebab-case`.
- Skill names should be verb-first when they describe an action (`add-new-api`, `daily-handoff`).
- Avoid abbreviations unless they are already idiomatic in this codebase.

## Authoring a New Skill

1. Create a folder under `skills/custom/<skill-name>/`.
2. Add a `SKILL.md` describing the workflow (numbered steps, code-fenced templates, links to relevant docs in `docs/`).
3. Add an entry to `skills/custom/README.md` under the index.
4. Keep skills focused: one workflow per skill. Split rather than overload.
