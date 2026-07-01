---
title: Multi-tenancy & identiteit — alles op account-niveau, cross-device, gebruiker-verwijderen
status: accepted
date: 2026-06-22
covers: [G-MT-AGENTSESSION-GLOBAL, G-11-1, G-11-2, G-17-2, G-17-3, G-16-1, G-16-2, G-16-3, G-17-1, G-ENV-2]
---

## Context
Identiteit en multi-tenancy raken meerdere features: gebruiker-verwijderen, cross-device chat-state, uitnodigingen, rol/eigenaar-beheer, sleutel-intrekking en de aan/uit-schakelaars per werkruimte. Het leidende principe is "alles op account-niveau".

## Beslissing
- **Gebruiker verwijderen: eigenaar kiest wissen óf anonimiseren (G-MT-AGENTSESSION-GLOBAL):** bij verwijderen van een gebruiker kies je per geval tussen alle bijbehorende gegevens netjes wissen óf anonimiseren. (Eigenaar-keuze.)
- **Half AI-antwoord bewaard, account-breed (G-11-1):** een halverwege afgebroken AI-antwoord blijft bewaard en gaat door bij terugkomst.
- **Eén gedeelde chat over apparaten (G-11-2):** de AI-chat per werkruimte is één gedeelde geschiedenis, gelijk op alle apparaten — past bij account-niveau.
- **Inlog-e-mail moet matchen met uitnodiging (G-17-2):** een uitnodiging werkt alleen als het inlog-e-mailadres met de uitnodiging klopt.
- **Export: alleen eigen accountgegevens (G-17-3):** "exporteer mijn data" levert alleen je eigen accountgegevens, geen gedeelde werkruimte-data. (Eigenaar/privacy-keuze.)
- **Rechten-intrekking: lopende actie afmaken, dan dicht (G-16-1):** bij intrekken van rechten maakt een lopende actie zichzelf af, daarna direct geen toegang meer.
- **Zelf-promotie tot eigenaar geblokkeerd (G-16-2):** jezelf tot (enige) eigenaar maken is altijd geblokkeerd.
- **Rol niet verwijderbaar terwijl in gebruik (G-16-3):** een rol kan niet verwijderd/hernoemd worden zolang er mensen aan hangen.
- **Laatste sleutel intrekken sluit open terminals (G-17-1):** het verwijderen van je laatste sleutel sluit open terminals per direct.
- **Twee aparte schakelaars: terminal & AI (G-ENV-2):** er zijn twee eenduidig benoemde aan/uit-schakelaars — één voor terminal, één voor AI-chat.

## Afgewezen alternatieven
- **Vaste opruim-strategie bij verwijderen** (G-MT-AGENTSESSION-GLOBAL A/B vast) — eigenaar wil per-geval-keuze.
- **Chat per apparaat** (G-11-2 B) — botst met account-niveau.
- **Uitnodigingslink voor iedereen** (G-17-2 B) — onveilig.
- **Export van alles met toegang** (G-17-3 C) — privacy-lek-risico op gedeelde data.
- **Eén gezamenlijke schakelaar** (G-ENV-2 B) — minder granulariteit.

## Gevolgen
- Account is de tenancy-anker; werkruimte-membership filtert toegang.
- Delete-flow biedt expliciete keuze wissen/anonimiseren (audit-gelogd).
- Invite-flow valideert e-mailmatch; eigenaar-promotie heeft een self-promote-guard.
- Twee onafhankelijke feature-flags (terminal, AI) per werkruimte.
