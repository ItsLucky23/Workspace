---
title: UI-resilience — bord, realtime, crash/reconnect, voice & herstart-gedrag
status: accepted
date: 2026-06-22
covers: [G-01-1, G-01-2, G-02-1, G-02-2, G-03-1, G-03-2, G-04-1, G-04-2, G-05-1, G-05-2, G-06-1, G-06-2, G-08-1, G-08-2, G-09-1, G-09-2, G-10-1, G-12-1, G-12-2, G-13-1, G-13-2, G-13-3, G-15-1, G-15-2, G-15-3, G-20-1, G-24-1]
---

## Context
De schermen 01–24 hadden veel edge-case-vragen over wat de gebruiker ziet en mag bij crashes, reconnects, gelijktijdige acties, opgeruimde containers, bulk-acties, herindexering en herstart. Deze ADR bundelt het UI-gedrag dat de bouw-AI's consistent moeten implementeren.

## Beslissing
- **Workspace-opstart hervatbaar door elke beheerder (G-01-1):** vastgelopen workspace-setup mag elke beheerder opnieuw proberen; iedereen krijgt een melding.
- **Taken aanmaken mag tijdens indexeren (G-01-2):** taken mogen al worden aangemaakt en wachten rustig tot het indexeren klaar is.
- **Stage met taken niet weghaalbaar (G-02-1):** een stage verwijderen kan niet zolang er taken in zitten.
- **Afkeuren herstart dubbele controle bij 1 (G-02-2):** afkeuren stuurt het werk terug; de controle begint opnieuw bij controleur 1.
- **Handmatige doc-edit blijft staan (G-03-1):** auto-documentatie overschrijft een handmatige wijziging niet.
- **Setup gaat door zonder assistent (G-03-2):** bij afwezige AI-assistent gebruikt setup standaardkeuzes en gaat door.
- **Fail-teller reset bij succes (G-04-1):** de fout-teller per hulpmiddel gaat op nul bij één geslaagde poging.
- **Kapotte koppeling waarschuwen (G-04-2):** een verwijderd/hernoemd gekoppeld hulpmiddel geeft een duidelijke "kapot"-waarschuwing.
- **Kostenlabel telt alle pogingen (G-05-1):** het kosten/tijd-label telt alle pogingen op en herberekent de verwachte tijd.
- **"Limiet verhogen"-knop uit bij stilstand (G-05-2):** die knop is duidelijk uitgeschakeld zolang de werkruimte stilligt.
- **Voice in wachtrij (G-06-1):** een tweede spraakbericht komt netjes in de wachtrij met "wacht op je beurt".
- **Voice op verouderde vraag (G-06-2):** een gesproken antwoord op een al beantwoorde vraag toont "al beantwoord" en wordt niet dubbel verstuurd.
- **Read-only verkenner als tussenoplossing (G-08-1):** tot de echte file-explorer er is, een eenvoudige kijk-alleen verkenner.
- **Waarschuwing + opslaan vóór wegvallen (G-08-2):** bij wegvallende omgeving krijg je een waarschuwing en de kans om op te slaan.
- **Openstaande vraag overleeft crash (G-09-1):** een openstaande vraag blijft staan en wordt na herstart opnieuw voorgelegd.
- **Waarschuwing bij vervangen antwoorden (G-09-2):** je krijgt een waarschuwing voordat al ingevulde antwoorden verdwijnen.
- **Kapotte automatisering uitschakelen (G-10-1):** een regel die naar een verdwenen stap wijst wordt uitgeschakeld met een "kapot"-waarschuwing.
- **Geen animatie bij batch-reconnect (G-12-1):** bij veel verplaatsingen na reconnect springen kaarten meteen op hun plek (geen animatie-rommel).
- **Gepauzeerd bord blijft handmatig bruikbaar (G-12-2):** het robot-teken verandert duidelijk, maar handmatige acties blijven mogelijk.
- **Bulk = alles-of-niets (G-13-1):** lukt er één niet, dan wordt niets verplaatst.
- **Bulk slaat bezige AI-taken over (G-13-2):** taken waar de AI mee bezig is worden in bulk overgeslagen.
- **Sprint met taken niet zonder waarschuwing weg (G-13-3):** afwijking — een sprint met taken erin mag niet zonder waarschuwing verwijderd worden (conservatief).
- **Dubbele herindex doet niks extra (G-15-1):** een tweede gelijktijdige reindex-klik doet niks; het loopt al.
- **Geüpload doc aan nieuwste versie (G-15-2):** een handmatig geüpload document hangt aan de huidige nieuwste code-versie.
- **Mislukte reindex valt terug (G-15-3):** bij een mislukte herindexering valt het systeem terug op de laatste volledige goede versie.
- **Geen tussenpunten → melding (G-20-1):** terugspoelen op een opgeruimde taak toont "geen tussenpunten beschikbaar".
- **Hervatten na opruiming via melding (G-24-1):** afwijking — hervatten na auto-opruiming toont eerst "moet opnieuw opstarten — doorgaan?" (keuze-op-moment), niet stil herstarten.

## Afgewezen alternatieven
- **Alleen starter mag hervatten** (G-01-1 B) — onnodig beperkend bij teamwerk.
- **Auto-doc wint altijd** (G-03-1 B) — vernietigt handwerk.
- **Per-ticket deels-gelukt bij bulk** (G-13-1 B/C) — onduidelijker dan alles-of-niets.
- **Stil herstarten bij hervatten** (G-24-1 A) — eigenaar wil expliciete keuze i.v.m. kosten/herstart-tijd.
- **Sprint stil verwijderen** (G-13-3 A/B) — risico op verrassend dataverlies.

## Gevolgen
- Optimistische UI met server-reconciliatie; reconnect doet bulk-snap zonder animaties.
- Reject/cancel/cleanup-flows tonen expliciete bevestigingen waar dataverlies dreigt.
- Reindex en bulk zijn idempotent/skip-aware; doc-edits zijn merge-veilig.
