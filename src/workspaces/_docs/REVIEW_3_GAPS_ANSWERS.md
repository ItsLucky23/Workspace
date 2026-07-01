# Antwoorden — ronde 3 gaps (live ingevuld in chat)

> Keuzes die de gebruiker in de chat-walkthrough maakte. A = aanbevolen optie (tenzij anders). Zie `REVIEW_AND_OPEN_QUESTIONS_3_GAPS_SIMPLE.md` voor de volledige vraagtekst per G-id.

## Cluster 1 — Engine / Protocol / Orchestrator / Container (22/22)

| Vraag | Keuze | Samenvatting |
|---|---|---|
| G-ENG-1 | A | Voortgang + telling onthouden, bij hervatten verdergaan |
| G-ENG-2 | B | Aparte maxima voor chat-AI's en werk-AI's |
| G-ENG-3 | A | Codenummer optioneel voor rollen zonder codemap |
| G-PROTO-1 | A | Plek vrijgeven tijdens wachten op gebruiker |
| G-PROTO-2 | A | Uniek kenmerk per bericht tegen dubbels |
| G-PROTO-3 | A | Harde tijdslimiet, dan terugvallen op database |
| G-SM-1 | A | Externe afronding → AI stoppen + melding |
| G-SM-2 | A | Echte 'geannuleerd'-eindstatus |
| G-SM-3 | A | Afkeuren → AI opnieuw met de afkeurreden |
| G-AUTO-1 | A | Meerdere triggers: op volgorde, eerste wint |
| G-AUTO-2 | A | Gefaalde actie: 1x proberen + foutmelding |
| G-AUTO-3 | A | Timer-info in blijvend geheugen |
| G-AUTO-4 | A | Voorstel toetsen aan sjabloon + verouderd-check |
| G-ORCH-1 | A | Aparte rijen per soort werk |
| G-ORCH-2 | A | Route-instelling opnieuw proberen met backoff |
| G-ORCH-3 | A | Vergelijken met laatst verwerkte versie |
| G-CT-1 | A | Sleutel ruim op tijd verversen |
| G-CT-2 | A | Bouw met slot, maar 1x |
| G-CT-3 | A | Onopgeslagen werk eerst wegzetten |
| G-CT-4 | A | Database als uitzondering buiten de doorgang |
| G-CT-5 | A | Handmatig herstelplan met hersteltijd |
| G-CT-6 | A | Pty-onderdeel op intern netwerk, op naam vindbaar |

## Cluster 2 — Datamodel & control-API (17/17)

| Vraag | Keuze | Samenvatting |
|---|---|---|
| G-DATA-PREVIEWDEPLOYMENT | A | Eén bij te werken regel per ticket |
| G-DATA-WORKSPACESIGNAL-BODY | A | Eén soort briefje + mens/AI-veldje |
| G-DATA-RAGENTRY-INFOSOURCE | A | Alles in één tabel (bestand+tekst+vingerafdruk) |
| G-DATA-INTEGRATIONTOOL-PERSIST | A | Aparte beveiligde kluis-tabel voor geheimen |
| G-DATA-WORKSPACENOTE-BODY | A | Vaste notitie-regel + auteur (mens/AI) |
| G-CTRL-IDEMPOTENCY-STORE | A | Kort, per werkruimte, automatisch verlopen |
| G-CTRL-CRON-TRIGGER-OP | A | Aparte knoppen voor geplande taken |
| G-CTRL-RETRY-DEADLETTER | A | Paar keer opnieuw, daarna foutmelding |
| G-CTRL-ANSWER-QUESTIONSET | A | Aparte nette 'beantwoord-vragen'-knop |
| G-DATA-STAGEKIND-DUALREVIEW | A | Uniek kenmerk per stap, soort los bewaren |
| G-DATA-STAGEKIND-CUSTOM | A | Extra soort 'eigen' voor zelfgemaakte stappen |
| G-MT-AGENTSESSION-GLOBAL | **Eigen** | Bij verwijderen zelf kiezen: alles wissen óf anonimiseren |
| G-MT-PUSHSUB-CROSSTENANT | **Eigen** | Alles op account-niveau: op laptop gestart ticket op telefoon oppakken bij inloggen zelfde account |
| G-MIG-PRESET-SEED | A | Eén centrale lijst per pakket |
| G-MIG-SEED-7-TO-KIND-CONSUMERS | A | Bestaande gegevens ombouwen naar nieuwe namen |
| G-DATA-QUESTIONSET-ANSWEREDBY | A | Veld 'beantwoord door' + in één stap zetten |
| G-DATA-CARRYOVER-CASCADE-CONFLICT | A | Altijd nieuwste pakketje, oudere als geschiedenis |

## Cluster 3 — Bouwvolgorde, scope, back-ups, server (30/30)

| Vraag | Keuze | Samenvatting |
|---|---|---|
| G-SEQ-1 | A | Stap-voor-stap-plan leidend + mappingtabel |
| G-SEQ-2 | A | Eerst database-fundament af + bevriezen |
| G-SEQ-3 | A | Tool-modules pas ná versie 1 |
| G-SCOPE-1 | A | Preview-meters niet bouwen zolang previews eruit zijn |
| G-SCOPE-2 | A | AI-kwaliteitstest erin + duidelijke eigenaar |
| G-SCOPE-3 | **B** (gewijzigd 2026-06-22, was A) | Per-project image-/project-laag KOMT in v1, gated op de AI-implementatie-laag (ADR 0016) |
| G-DEFER-1 | A | Back-ups verplicht vóór eerste echte gebruiker |
| G-DEFER-2 | A | Max uitvaltijd + moment waarop reserve verplicht |
| G-DEFER-3 | A+ (uitgewerkt, ADR 0017) | Configureerbare context-cyclus per model: N× compact → clear + handoff-doc reload. Opus-1M: 2× compact ~400k, dan clear+handoff. |
| G-DEPLOY-1 | A | Levensteken-tijd met ruime marge |
| G-DEPLOY-2 | A | Concrete capaciteitsgetallen (8 cores/32 GB) |
| G-DEPLOY-3 | A | Eerlijk één app-kopie in v1 |
| G-BACKUP-1 | A | Hoofdsleutel apart + versleuteld back-uppen |
| G-BACKUP-2 | A | Ook onopgeslagen handwerk back-uppen |
| G-BACKUP-3 | A | Meerdere generaties + noodpad |
| G-OBS-1 | A | Concrete alarmgrenzen + tijdsvensters |
| G-OBS-2 | A | Per achtergrondtaak een meld-ritme |
| G-OBS-3 | **B** | Echt monitoring-dashboard meteen in v1 + eigenaar |
| G-ENV-1 | A | Handleiding bijwerken naar veilige login |
| G-ENV-2 | A | Twee aparte schakelaars (terminal / AI) |
| G-ENV-3 | A | Geavanceerde zoek-database als standaard |
| G-SPIKE-1 | A | Maximum aantal noodgrepen, daarna mislukt |
| G-SPIKE-2 | **B** | Gepland aantal verlagen tot binnen de limiet |
| G-SPIKE-3 | A | Verplicht testen op het echte serversysteem |
| G-SPIKE-4 | A | Vaste eigenaar voor tool-updates |
| G-XB-1 | A | Losse 'denker' pas ná versie 1 |
| G-XB-2 | A | Test of verbruik uitleesbaar is + plan B |
| G-XB-3 | A | Eén afhankelijkheids-indeling bindend |
| G-XB-4 | A | Handwerk apart vastleggen (eigen notitie) |
| G-XB-5 | A | Max pogingen, daarna escaleren naar mens |

---

> **Vanaf hier door Claude ingevuld** namens de gebruiker (die het beantwoorden moe was), op basis van de aanbeveling + het beslispatroon hierboven. Afwijkingen van de aanbeveling en eigenaar-beslissingen staan **vet**.

## Cluster 4 — Schermen & features 01–12 (24/24, door Claude)

| Vraag | Keuze | Samenvatting |
|---|---|---|
| G-01-1 | A | Elke beheerder mag hervatten; iedereen krijgt melding |
| G-01-2 | A | Taken mogen al aangemaakt; wachten tot indexeren klaar |
| G-02-1 | A | Stap weghalen kan niet zolang er taken in zitten |
| G-02-2 | A | Afkeuren stuurt terug; controle begint opnieuw bij 1 |
| G-03-1 | A | Systeem ziet jouw wijziging en laat die staan |
| G-03-2 | A | Standaardkeuzes gebruiken, doorgaan zonder assistent |
| G-04-1 | A | Teller per hulpmiddel terug op nul bij één succes |
| G-04-2 | A | Duidelijke waarschuwing dat de koppeling kapot is |
| G-05-1 | A | Label telt alle pogingen op, herberekent tijd |
| G-05-2 | A | Knop uitgeschakeld zolang werkruimte stilligt |
| G-06-1 | A | Netjes in wachtrij met "wacht op je beurt" |
| G-06-2 | A | Toont dat vraag al beantwoord is; geen dubbel |
| G-07-1 | A | Afkeuren wint altijd (veiligst); ander ziet afkeuring |
| G-07-2 | A | Bestanden-onderdeel verdwijnt; tekst goedkeuren |
| G-08-1 | A | Eenvoudige kijk-alleen verkenner als tussenoplossing |
| G-08-2 | A | Waarschuwing + kans om op te slaan voor wegvallen |
| G-09-1 | A | Vraag blijft staan, opnieuw voorgelegd na herstart |
| G-09-2 | A | Waarschuwing voor verdwijnen ingevulde antwoorden |
| G-10-1 | A | Regel uitgeschakeld + "kapot"-waarschuwing |
| G-10-2 | A | Alleen beheerders mogen automatische regels maken |
| G-11-1 | A | Half antwoord bewaard, gaat door bij terugkomst |
| G-11-2 | A | Eén gedeelde chat, gelijk op alle apparaten (past bij account-niveau) |
| G-12-1 | A | Kaarten springen meteen op plek, geen animatie |
| G-12-2 | A | Robot-teken verandert; handmatige acties blijven mogelijk |

## Cluster 5 — Schermen & features 13–24 (33/33, door Claude)

| Vraag | Keuze | Samenvatting |
|---|---|---|
| G-13-1 | A | Alles-of-niets bij bulk-fout, veilig en duidelijk |
| G-13-2 | A | Bulk slaat taken over waar AI mee bezig is |
| G-13-3 | **C** | Sprint met taken niet weggooien zonder waarschuwing (conservatief) |
| G-14-1 | A | Beiden zien en typen samen in terminal |
| G-14-2 | A | Duidelijke "geen toegang"-melding |
| G-14-3 | A | Nette "sessie afgesloten"-melding + herstart-knop |
| G-15-1 | A | Tweede klik doet niks, herindexering loopt al |
| G-15-2 | A | Document hangt aan nieuwste code-versie |
| G-15-3 | A | Terugvallen op laatste volledige goede versie |
| G-16-1 | A | Lopende actie afmaken, daarna direct geen toegang |
| G-16-2 | A | Zichzelf tot eigenaar maken altijd geblokkeerd |
| G-16-3 | A | Rol niet verwijderbaar zolang mensen eraan hangen |
| G-17-1 | A | Open terminals per direct afsluiten |
| G-17-2 | A | Inlog-e-mail moet kloppen met uitnodiging |
| G-17-3 | A · **EIGENAAR** | Alleen eigen accountgegevens exporteren (privacy-beslissing) |
| G-18-1 | A | Melding verdwijnt overal zodra iemand antwoordt |
| G-18-2 | A | Alleen toegewezen persoon + maker krijgen melding |
| G-18-3 | A | Markeert echt alles, ook oude meldingen |
| G-19-1 | **Geparkeerd** (2026-06-22, was A) | Token-/budget-blokkering niet nu; alleen informatieve weergave, geen blokkeer-logica |
| G-19-2 | **Geparkeerd** (2026-06-22, was A) | Sliding-window-verbruiksblokkade niet nu; alleen informatieve weergave |
| G-19-3 | **Geparkeerd** (2026-06-22, was A) | Budget-noodstop (AI/previews/tests uit) niet nu; geen blokkeer-logica |
| G-20-1 | A | Melding "geen tussenpunten beschikbaar" |
| G-20-2 | A | Tonen als historisch moment + "later gewijzigd"-label |
| G-21-1 | A | Doorzoekt alles waar je toegang toe hebt |
| G-21-2 | A | Resultaten vooraf op leesrechten gefilterd |
| G-22-1 | A | Eigen wijzigingen markeren tegen sync-lus |
| G-22-2 | A | Taak archiveren, lopend werk netjes stoppen |
| G-22-3 | A | Waarschuwing "niet gesynct" + opnieuw-knop |
| G-23-1 | A | Echt gebruik houdt preview vanzelf aan |
| G-23-2 | A | Preview bevroren op moment + "verouderd"-label |
| G-23-3 | A | Eerst-binnen-eerst, met annuleerknop |
| G-24-1 | **B** | Eerst melding "moet opnieuw opstarten — doorgaan?" (keuze-op-moment) |
| G-24-2 | A | Eerst "geen nieuwe starts"-slot, dan alles stil |
| G-24-3 | A | Preview + terminals dicht, met duidelijke melding |

## Cluster 6 — Code-samenvoegen, testen, push & extra's (26/26, door Claude)

| Vraag | Keuze | Samenvatting |
|---|---|---|
| G-FORGE-1 | A | Oude reviews als alleen-lezen archief bij ons |
| G-FORGE-2 | A | GitHub/GitLab wint altijd over eigen status |
| G-MR-1 | A | Eigen kopie is baas, GitHub krijgt losse link |
| G-MR-2 | A | Bij stopzetten voorstellen netjes sluiten + loggen |
| G-MR-3 | A | Systeem checkt tests groen, voegt dan samen |
| G-CI-1 | A | Nieuwe versie breekt oude lopende test af |
| G-CI-2 | A | Poort eist "geslaagd", blokkeert anders (veilig dicht) |
| G-GIT-1 | A | Samenvoegen op volgorde van wanneer test groen werd |
| G-GIT-2 | A | Terugdraai-acties altijd uitgezonderd van auto-merge |
| G-AIQ-1 | A | Taak houdt test-variant tot helemaal klaar |
| G-AIQ-2 | A | Opnames onthouden AI-versie, falen luid bij verschil |
| G-CLIENT-1 | A | App haalt verse stand, toont "al beantwoord door X" |
| G-CLIENT-2 | A | Elke nieuwe meldingssoort krijgt eigen kanaal-instelling |
| G-INSTALL-1 | A | Meldings-sleutel gaat mee in back-upset |
| G-INSTALL-2 | A | Volledige opzet draait alles; per project instelbaar |
| G-TRUST-1 | A | "Samengevoegd door systeem" + autonomie-niveau + wie aanzette |
| G-TRUST-2 | A | Systeem neemt altijd de strengste instelling |
| G-ANALYTICS-1 | A | Elk kostenrecord legt prijs van dat moment vast |
| G-ANALYTICS-2 | A | Terugdraai-merges tellen niet, gelden als negatief signaal |
| G-ONBOARD-1 | A | Inwerk-helper uitgezonderd van auto-vastleggen per stap |
| G-FORENSIC-1 | A | Wisselvalligheid herkennen op vaste stap-naam |
| G-SCHED-1 | Geparkeerd | Voorrang-vs-budgetslot geparkeerd met token-/budget-blokkering (2026-06-22) |
| G-QUOTA-1 | **Geparkeerd** (2026-06-22, was A) | Gedeeld-budget pauzeer-gedrag niet nu (onderdeel van de token-blokkering-parkering); alleen informatieve weergave |
| G-PRESENCE-1 | A | Statuscheck is echte bescherming tegen dubbel antwoord |
| G-NOTIF-1 | A | Goedgekeurd "geldt-voor-alles"-pad zoals bij aanmeldingen |
| G-TIER2-1 | A · **EIGENAAR** | Gebeurtenis-motor toewijzen aan automatiserings-laag |

## Cluster 7 — Extra mini-apps / tool-modules (30/30, door Claude)

| Vraag | Keuze | Samenvatting |
|---|---|---|
| G-FW-1 | A | Aan/uit per hele werkruimte (eenvoud op accountniveau) |
| G-FW-2 | A | Uitzetten verbergt alleen; artifacts blijven leesbaar |
| G-FW-3 | A | Eén gedeelde opslag voor alle mini-apps |
| G-FW-4 | A | Vaste systeem-bepaalde volgorde in zijbalk |
| G-FW-5 | A | Eén gedeeld mappensysteem voor alle mini-apps |
| G-FW-6 | A | Eén gedeelde bak met label per mini-app |
| G-INT-1 | A | Vragen vrij uit wachtrij, ook tijdens pauze |
| G-INT-2 | A | Eén opgeschoonde statuslijst (vijf toestanden) |
| G-INT-3 | **B** · eigenaar | Interviewer plant ook hele nieuwe features uit (niet alleen vragen beantwoorden) |
| G-DSGN-1 | A | Eén gedeelde voorvertoning-server voor systeem |
| G-DSGN-2 | **C** | Afgeschermd draaien én goedkeuring (veiligheid hoog) |
| G-DSGN-3 | A · **EIGENAAR** | Tekstbeheer in Designer, geen aparte Copy-tool |
| G-DSGN-4 | A | Kleurvarianten passen automatisch samen mee |
| G-MKT-1 | A | Vaardigheid bruikbaar voor meerdere tools tegelijk |
| G-MKT-2 | A | Eén centrale merk-bibliotheek voor alle tools |
| G-MKT-3 | **Eigen** | GEEN billing/payments in het project; alle AI-kosten lopen via subscription of eigen API-key |
| G-MKT-4 | A | Dezelfde gedeelde mappenregel als de rest |
| G-DOC-1 | A · grens behouden | Integriteitsgrens BLIJFT: geen AI-detectie-omzeiling als feature (waarschuwing + AI-instructie). Document-Studio doet opstellen/formatteren/in-uitlezen/toon, géén 'humanize om detector te misleiden'. Claude bouwt evasion niet. |
| G-DOC-2 | A | Vaste ondersteund-lijst, rest netjes geweigerd |
| G-DOC-3 | A | Eén veilige inlees-manier voor alle uploads |
| G-DOC-4 | A | Stoppen tot ontbrekende info aangevuld is |
| G-DOC-5 | A | Meerdere taken; versie vastgezet bij koppelen |
| G-IMG-1 | A | Voorlopig eigen netwerk; later internet-pad documenteren |
| G-IMG-2 | A (+ notitie 2026-06-22) | Gewone aan/uit-mini-app — maar uitzondering op "modules in v2": image-builder zit in v1, ná de AI-implementatie-laag (ADR 0016). Interviewer/Designer/Marketing/Document blijven v2 |
| G-IMG-3 | A | Sjablonen voor iedereen; AI-pad beheerder-only |
| G-MOD-1 | **B** · eigenaar | Alle 11 voorgestelde extra modules parkeren, nu niets erbij |
| G-MOD-2 | **A** (gewijzigd 2026-06-22, was B) | Gedeelde, cross-module leesbare data vanaf het ontwerp — modules in v2, data-uitwisseling vanaf ontwerp (bv. Designer leest Interviewer-resultaten, Marketing leest codebase-info) |
| G-MOD-3 | A | Eén gedeelde totale limiet voor alle tools |
| G-MOD-4 | A | Eén gedeelde beurtregeling voor alle tools |
| G-MOD-5 | A | Eén vaste kostenmelding bij alle tools |

---

## Vision-verfijning 2026-06-22

Scope-verfijning door de eigenaar, doorgevoerd in de ADR's (zie ADR 0016 + bijgewerkte 0006/0010/0013) en hierboven in de rijen.

1. **Tool-modules blijven v2, maar zijn een GROOT idee achter het product.** Interviewer voorop: features/lange termijn uitschetsen, nieuwe features bedenken, verbetervoorstellen doen. Gefaseerd, **niet geschrapt**.
2. **Cross-module data-uitwisseling vanaf het ONTWERP.** Niet meer "eerst gescheiden, later koppelen". De modules zelf komen pas in v2, maar het ontwerp ondersteunt cross-module data vanaf het begin (bv. Designer leest Interviewer-resultaten, Marketing leest codebase-info). → **G-MOD-2 gewijzigd B→A** (gedeelde, cross-module leesbare data), aantekening "modules in v2, data-uitwisseling vanaf ontwerp".
3. **Live preview / live server blijft buiten v1 (post-v1).** Bevestigd, geen wijziging.
4. **Image-builder MAG in v1, maar pas ná een AI-implementatie-laag.** Nieuw v1-kern-deliverable: een **AI-implementatie-laag** die PER rol/tool het concrete AI-mechanisme + autorisatie vastlegt (voorbeeld eigenaar: "Designer → Claude Code CLI (PTY); Interviewer → API-call met auth-methode X"). Gevolgen: **G-SCOPE-3 A→B** (per-project image-/project-laag in v1, gated op de AI-laag); image-builder is de **uitzondering** op "modules pas in v2" (Interviewer/Designer/Marketing/Document blijven v2 — zie G-IMG-2-notitie). Nieuwe **ADR 0016**.
   - **Subscription-vs-API-afwijking (bewust, eigenaar akkoord):** de docs hadden een harde regel "alles op subscription via interactieve PTY, nooit API/SDK". Besluit: de **kern-orchestratie blijft op subscription-PTY**; de AI-implementatie-laag mag **per tool een ander mechanisme** kiezen; een tool dat een API gebruikt draait op de **eigen API-key van de gebruiker** (consistent met "geen billing: alles via subscription óf API", ADR 0014). Vastgelegd als bewuste afwijking in ADR 0016.
5. **Token-usage-blokkering GEPARKEERD** ("we moeten nog iets verzinnen, voor nu niet meenemen"). De hard-blokkeer-logica bij token-/budget-limiet hoort NIET in de huidige scope. → **G-19-1, G-19-2, G-19-3 en G-QUOTA-1 geparkeerd**. Een eenvoudige informatieve verbruik-weergave mag blijven, maar GEEN blokkeer-logica nu (budget/usage-ADR 0010 bijgewerkt).

