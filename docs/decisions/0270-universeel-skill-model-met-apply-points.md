---
status: accepted
date: 2026-07-17
tags: [ai, skills, architecture, documents-and-skills]
---

# 0270 — Universeel Skill-model met apply-points (één injectielaag voor elke AI-run)

## Context

De gebruiker wil "skills" (humanizer, tone-of-voice, SEO-optimizer, merkstem, jargon-vertaler) die overal in het platform variatie en sturing geven — niet alleen in één module. Het platform had al drie half-overlappende sturingslagen: `Workspace.aiInstruction` (alles), `StylePreset` (per-feature render-stijl, per run gekozen), en DesignThemes/media-styles (galerijen). Geen daarvan is een herbruikbaar, per-workspace beheerbaar gedrags-blok dat selectief op módules toepasbaar is.

## Decision

Eén nieuw workspace-scoped `Skill`-model (slug, name, instruction, examples, applyPoints[], enabled, builtin) met één resolver (`server/ai/skills.ts`): `skillPromptBlock(workspaceId, applyPoint)`. Twee injectiepunten dekken ALLE AI-runs: (1) het bestaande completion-choke-point in `server/ai/registry.ts` (elke one-shot feature; de feature→apply-point-groep-map staat in skills.ts en is exhaustief over `AiFeature`), en (2) de PTY-stage-runner als contextDoc (`'dev'`-groep). Apply-point-groepen: all/content/studio/designer/dev/interviewer/documents/chat/custom — canonieke lijst in `src/workspaces/_data/types.ts` (client+server één bron). Vijf builtin-seeds per workspace (lazy bij snapshot-read, idempotent), allemaal standaard UIT (consent-first); builtins zijn bewerkbaar + resetbaar, nooit verwijderbaar. CRUD via vier `ai-skill-*` Conductor-ops (B-23), RBAC workspaceSettings. De humanizer-seed verankert de ADR-0015-grens (menselijke toon ja, AI-detectie-omzeiling/disclosure-verwijdering nooit) in de instructietekst zelf.

## Rejected alternatives

- **Skills alleen in de Document-module eerst**: dubbele picker-UI en een tweede migratie later; de choke-point-injectie maakt "overal" zelfs goedkoper dan "één module".
- **Alles unificeren onder Skill (StylePresets/DesignThemes migreren)**: raakt werkende features en vergt een datamigratie; de winst is cosmetisch. Ze blijven naast elkaar; latere migratie kan alsnog.
- **Per-run skill-picker (zoals styles)**: skills zijn gedrag ("altijd zo schrijven"), geen per-run keuze; aan/uit per workspace + apply-points dekt de behoefte zonder elke run een extra keuzestap te geven.

## Consequences

- Elke nieuwe `AiFeature` DWINGT (tsc-error) een rij in de feature→groep-map af.
- Skills-tekst reist mee in elke prompt zodra enabled — lange instructies kosten tokens op élke run; de UI toont dit als workspace-brede keuze.
- De PTY-kant ziet skills als contextDoc, niet als system-prompt — zelfde inhoud, ander transport.
- Bonus-fix meegenomen: de snapshot las `CustomAiTask`/`OutputTemplate` ongescopet (niet in TENANT_MODELS → tenantDb pass-through) — cross-tenant-lek gedicht met expliciete workspaceId-filters + regressietest.
