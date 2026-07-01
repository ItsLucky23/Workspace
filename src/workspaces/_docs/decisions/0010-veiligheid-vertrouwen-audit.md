---
title: Veiligheid & vertrouwen — mens-in-de-lus, afkeuren-wint, strengste instelling wint, audit
status: accepted
date: 2026-06-22
covers: [G-07-1, G-07-2, G-10-2, G-18-1, G-18-2, G-18-3, G-19-1, G-19-2, G-19-3, G-TRUST-1, G-TRUST-2, G-AIQ-1, G-AIQ-2, G-FORENSIC-1, G-ANALYTICS-1, G-ANALYTICS-2, G-SCHED-1, G-QUOTA-1, G-ONBOARD-1]
---

## Context
Veiligheid is topprioriteit. Dat raakt goedkeur-conflicten, wie automatiseringen mag maken, meldings-bereik, budget-noodstop, audit-logging van autonome merges, autonomie-instellingen, AI-kwaliteitsborging, flaky-test-detectie, kosten-accounting en budget/voorrang-interactie.

## Beslissing
- **Afkeuren wint altijd (G-07-1):** bij gelijktijdig goed- en afkeuren wint afkeuren (veiligste); de ander ziet de afkeuring.
- **Geen bestanden → tekst goedkeuren (G-07-2):** als een stap geen bestanden wijzigde, verdwijnt het bestanden-onderdeel en keur je de tekst goed.
- **Alleen beheerders maken automatiseringen (G-10-2):** automatische regels (die rechten kunnen omzeilen) mogen alleen door beheerders gemaakt worden.
- **Melding verdwijnt overal bij antwoord (G-18-1):** zodra iemand een gedeelde vraag beantwoordt, verdwijnt de melding bij alle anderen.
- **Melding alleen naar betrokkenen (G-18-2):** alleen de toegewezen persoon en de maker krijgen een taak-melding (least-exposure).
- **"Alles gelezen" markeert echt alles (G-18-3):** ook oude, niet-ingeladen meldingen.
- **Token-usage-blokkering GEPARKEERD (G-19-1, G-19-2, G-19-3):** wijziging (eigenaar 2026-06-22) — de hard-blokkeer-logica bij een token-/budget-limiet hoort NIET in de huidige scope ("we moeten nog iets verzinnen, voor nu niet meenemen"). Dus géén "strengste budget-regel wint" / sliding-window-blokkade / budget-noodstop die AI, previews én tests uitzet in v1. Een eenvoudige **informatieve verbruik-weergave** mag blijven, maar **GEEN blokkeer-logica nu**. De oorspronkelijke keuzes (strengste-wint G-19-1 A, schuivende schatting G-19-2 A, noodstop-zet-alles-uit G-19-3 A) zijn geparkeerd tot er een doordacht mechanisme is.
- **Audit "samengevoegd door systeem" (G-TRUST-1):** autonome merges worden gelogd als "door systeem", met autonomie-niveau en wie het aanzette.
- **Strengste autonomie-instelling wint (G-TRUST-2):** het systeem neemt altijd de strengste van per-taak en algemene instelling (nooit per ongeluk losser).
- **A/B-variant vasthouden tot klaar (G-AIQ-1):** een taak houdt zijn toegewezen testvariant tot hij helemaal klaar is.
- **Opnames pinnen AI-versie, falen luid (G-AIQ-2):** replay-opnames onthouden hun AI-versie en falen luid bij een verschil (geen stille false-green).
- **Flaky-detectie op stabiele stap-naam (G-FORENSIC-1):** wisselvalligheid wordt herkend op de vaste logische stap-naam, niet op de wisselende code-stempel.
- **Kosten leggen tarief-van-moment vast (G-ANALYTICS-1):** elk kostenrecord pint de prijs van dat moment, zodat historie blijft kloppen bij tariefwijziging.
- **Revert telt niet als afgerond (G-ANALYTICS-2):** terugdraai-merges tellen niet mee en gelden als negatief signaal.
- **Voorrang-vs-budgetslot GEPARKEERD (G-SCHED-1):** wijziging (eigenaar 2026-06-22) — geparkeerd samen met de token-/budget-blokkering (G-19-*, G-QUOTA-1). Zolang er geen budget-/token-blokkeer-logica is, is er geen budgetslot om voorrang tegen af te wegen; alleen de voorrang-kiezer zelf blijft (zonder budget-gate). Heroverwegen zodra de blokkeer-logica wordt ontworpen.
- **Gedeeld-budget pauzeer-gedrag GEPARKEERD (G-QUOTA-1):** wijziging (eigenaar 2026-06-22) — onderdeel van dezelfde parkering als G-19-*. Zolang er geen budget-/token-blokkeer-logica is, is er ook geen pauzeer-bij-gedeelde-meter-gedrag in scope. De oorspronkelijke keuze (lage-grens-projecten pauzeren eerder, G-QUOTA-1 A) is geparkeerd; alleen informatieve weergave mag, geen blokkade.
- **Onboarding-helper uitgezonderd van auto-commit (G-ONBOARD-1):** de inwerk-helper houdt zijn werk als concept en is uitgezonderd van de regel die elke stap automatisch vastlegt.

## Afgewezen alternatieven
- **Eerste-klik-wint bij goed/afkeur** (G-07-1 B) — minder veilig dan afkeuren-wint.
- **Iedereen mag automatiseringen maken** (G-10-2 B) — omzeilt rechten.
- **Alle werkruimte-leden melden** (G-18-2 B) — over-exposure.
- **Oude cijfers meeveranderen** (G-ANALYTICS-1 B) — historie wordt onbetrouwbaar.

## Gevolgen
- Goedkeur-resolver implementeert reject-wins; merge-audit-record bevat autonomie-context.
- Autonomie-resolver neemt altijd het strengste niveau (min van twee).
- Eval-replay pint model-versie; flaky-detectie sleutelt op stage-naam.
- Cost-records zijn immutable met tarief-snapshot; revert telt negatief.
- Budget/token-blokkering (G-19-1/2/3, G-QUOTA-1) is geparkeerd: v1 toont hooguit een informatieve verbruik-weergave, maar implementeert geen blokkeer-/noodstop-/pauzeer-logica bij een limiet. Een definitief mechanisme wordt later verzonnen.
