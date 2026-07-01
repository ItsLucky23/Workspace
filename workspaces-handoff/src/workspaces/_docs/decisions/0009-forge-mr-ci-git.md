---
title: Forge / MR / CI / git — forge wint, merge-gate fail-closed, terugdraai uitgezonderd
status: accepted
date: 2026-06-22
covers: [G-FORGE-1, G-FORGE-2, G-MR-1, G-MR-2, G-MR-3, G-CI-1, G-CI-2, G-GIT-1, G-GIT-2, G-22-1, G-22-2, G-22-3, G-20-2]
---

## Context
De integratie met externe forges (GitHub/GitLab), merge-requests, CI-gates en git-samenvoegen kende veel botsings- en faal-scenario's. Het leidende principe: de forge is de bron van waarheid en de merge-gate sluit veilig dicht.

## Beslissing
- **Oude reviews als read-only archief (G-FORGE-1):** bij overstap naar een externe forge blijven oude in-huis reviews als alleen-lezen archief bij ons staan.
- **Forge wint altijd (G-FORGE-2):** bij conflict tussen onze onthouden merge-status en de forge wint de forge altijd.
- **Eigen kopie is baas, forge krijgt losse link (G-MR-1):** een review-bericht wordt eerst bij onszelf opgeslagen (bron van waarheid voor ons); de forge-spiegeling is een bewust losgekoppelde stap.
- **Stopzetten sluit open MR's netjes (G-MR-2):** bij het stopzetten van een taak worden gekoppelde openstaande merge-voorstellen netjes gesloten en gelogd.
- **Auto-merge checkt tests groen (G-MR-3):** bij "0 goedkeurders" checkt het systeem zelf of de tests groen zijn en voegt dan samen, zonder goedkeur-stap.
- **Nieuwe code breekt oude test af (G-CI-1):** een nieuwe code-versie breekt de nog lopende test van de vorige versie direct af.
- **Merge-gate fail-closed (G-CI-2):** de poort eist een expliciete "geslaagd"; bij ontbrekende uitslag blokkeert hij (veilig dicht).
- **Auto-merge-volgorde = test-groen-tijd (G-GIT-1):** zonder mens bepaalt de volgorde waarop tests groen werden de merge-volgorde, één voor één.
- **Terugdraai uitgezonderd van auto-merge (G-GIT-2):** revert-acties worden altijd uitgezonderd van automatisch samenvoegen.
- **Eigen wijzigingen markeren tegen sync-lus (G-22-1):** eigen wijzigingen krijgen een markering zodat ze geen forge↔bord-lus veroorzaken.
- **Issue verwijderd/verplaatst → archiveren (G-22-2):** als de forge-issue verdwijnt/verhuist, wordt de taak gearchiveerd (niet hard verwijderd) en lopend werk netjes gestopt.
- **Sync-fout zichtbaar maken (G-22-3):** mislukt wegschrijven naar de forge toont een duidelijk "niet gesynct"-waarschuwingsteken met opnieuw-knop.
- **Overschreven historie tonen met label (G-20-2):** een door de forge overschreven moment wordt op de tijdlijn getoond als historisch punt met een "later gewijzigd"-label.

## Afgewezen alternatieven
- **Reviews exporteren/weggooien** (G-FORGE-1 B/C) — verlies of onbetrouwbare migratie.
- **Onze status wint** (G-FORGE-2 B) — drift t.o.v. de echte forge-staat.
- **Auto-merge slaat "goedgekeurd" over** (G-MR-3 B) — verliest de status-overgang in het logboek.
- **Eén test tegelijk, nieuwe wacht** (G-CI-1 B) — verspilt rekentijd aan verouderde code.
- **Forge zelf bevragen bij verloren bericht** (G-CI-2 B) — minder veilig dan fail-closed.
- **Achterhaalde momenten verbergen** (G-20-2 B) — verbergt forensisch relevante historie.

## Gevolgen
- Reconciliatie behandelt de forge als autoritatief; lokale state is een cache met expliciete spiegeling.
- Auto-merge-pad heeft een CI-status-gate die fail-closed is en reverts uitsluit.
- Bord↔forge-sync gebruikt origin-markers tegen feedback-loops; faal-state is zichtbaar in de UI.
