---
name: stale-broken-dev-process-looks-like-a-per-route-bug
title: "Alle input op _ai-routes geweigerd" was geen type-bug — het was een stale dev-proces met lege devApis
severity: high
area: packages/server
date: 2026-07-18
tags: [dev-tooling, false-diagnosis, silent-failure, ports, hot-reload, devkit]
---

# 0012 — Een stale/kapot dev-proces ziet eruit als een per-route framework-bug

## What happened

Symptoom (aangeleverd door een andere AI): in de draaiende dev-server werd **alle**
input op de `_ai`-routes geweigerd. De eerste hypothese was een framework-bug in de
dev runtime type-validatie (`getInputTypeFromFile` → `resolveRuntimeTypeText`), mogelijk
een regressie van de 0.6.0 → 0.7.0 devkit-changes.

Na verificatie klopte het hele validatiepad: de opgeslagen `devApis[route].inputType`
was correct geïnlined, `resolveRuntimeTypeText` gaf `status:success` op alle vier de
routes, en `stored === verse extractie`. Er was **geen** extractie- of resolver-bug.

De echte oorzaak: een dev-proces waarvan `initializeAll()` bij boot faalde. Dat maakt
`devApis` leeg maar laat de server draaien — dus elke `/api`-request faalde. Twee
framework-randen verborgen dit:

1. De init-fout was slechts een `getLogger().warn(...)` die wegscrollde; de server bleef
   "up".
2. Dev-poort-auto-increment (`SERVER_PORT_AUTO_INCREMENT` default aan) liet elke "verse"
   restart stil naar de volgende poort hoppen terwijl het kapotte proces de canonieke
   poort vasthield. De goede server draaide op 4101; de client praatte door met de
   zombie op 4100.

Samen lieten een *tijdelijke* init-fout eruitzien als een *hardnekkige, per-route*
type-validatie-bug — over meerdere restarts heen.

## Root cause

Een fail-closed validator (terecht) + een **stil** falende dev-init + een **stille**
poort-hop. Geen enkele van de foutgevoelige plekken zei WAAROM er niks werkte, dus de
diagnose ging naar de meest zichtbare component (de type-validatie) in plaats van naar
de daadwerkelijk kapotte laag (het dev-proces zelf).

## How to avoid

- **Verifieer eerst dat het proces dat je test het levende, juiste proces is.** Bij een
  "alles faalt op deze routes"-symptoom: check de boot-logs op init-fouten en check op
  welke poort dit proces daadwerkelijk luistert (dev auto-increment hopt weg van een
  bezette poort). Een zombie op de canonieke poort is de klassieke val.
- **Onderscheid de twee code-paden.** De extractor (`getInputTypeFromFile`, volledige
  TypeChecker) en de request-tijd-resolver (`resolveRuntimeTypeText`, string-re-parser)
  zijn verschillend. "Verse extractie werkt wél" bewijst niets over het request-pad tenzij
  je een echte request door de validatie stuurt.
- **Framework-fix (deze les):** foutgevoelige plekken moeten luid + zelf-verklarend falen.
  `createServer.ts` logt een init-fout nu als `error` met volledige uitleg + herstelstap
  en registreert de fout (`devToolsStatus.ts`); `apiRoute.ts`/`syncRoute.ts` geven dan een
  `503` met de echte oorzaak i.p.v. een misleidende 404; de poort-hop-warning legt de
  zombie-consequentie uit.
