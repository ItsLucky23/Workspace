# Workspaces — Modules Brainstorm

Interactieve brainstorm-pagina's om de nieuwe Workspaces-tools (Designer, Marketing, Document, Interviewer, …) qua scope en richting uit te denken. Open een `.html` in je browser, beantwoord de vragen (autosave in localStorage), klik **Exporteer** → je krijgt een `.md`-bestand met je antwoorden terug.

## Drie rondes (chronologisch)

1. **`interview.html`** — de eerste, brede modules-brainstorm (75 vragen, per-module mening + risico's + voorstellen). Bron: `modules/`. Bouwen: `node build.mjs`.
2. **`interview-scope.html`** — de **scope-ronde** (34 vragen): per tool de vorm/grenzen, met "zo begrijp ik je visie" bovenaan. Bron: `round2/`. Bouwen: `node build.mjs 2`. ✅ beantwoord.
3. **`interview-deep.html`** — ★ **START HIER** (2026-06-15). De **diepe ronde** (26 vragen) voor de 4 kern-tools (Interviewer → Designer → Marketing-setup → Document): concrete bouw-/UX-keuzes bovenop de vastgelegde scope. Bron: `round3/`. Bouwen: `node build.mjs 3`.

Elke pagina gebruikt een eigen localStorage-key, dus antwoorden lopen niet door elkaar.

## Hoe het werkt

`build.mjs` leest de markdown-bronnen (in `modules/` resp. `round2/`), parset ze tolerant, en genereert een self-contained interactieve HTML. Pas je een bronbestand aan, dan regenereert `node build.mjs [2]` de pagina.
