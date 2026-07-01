# Stap 1 — P0.5-spike: waaraan het moet voldoen

> **Wat dit is.** De allereerste bouwstap (ADR 0005). Vóór er iets van de engine/containers gebouwd wordt, bewijzen we met een klein test-harnas tegen de echte `claude`-CLI dat onze kern-aannames kloppen. Resultaat = een ingevulde gelukt/niet-gelukt-tabel (`SPIKE_RESULTS.md`).
>
> **Gouden regel:** rood op **billing** of **PTY** → **escaleren**, niet stilletjes terugvallen op de betaalde API. (Test op het échte server-besturingssysteem — G-SPIKE-3.)

## De checks

| # | Wat we bewijzen | Gelukt als… | Blokkeert? |
|---|---|---|---|
| 1 | **Billing — subscription-PTY** | een interactieve `claude`-sessie in een nep-terminal telt op het **Max-abonnement**, niet op de betaalde API-pot | **JA** (kern-aanname) |
| 2 | **Billing — API-pad (dual-support)** | een API-call met auth-methode draait op de **eigen API-key** van de gebruiker (ADR 0016) | Ja voor dual-support; de v1-kern kan desnoods door op alleen subscription |
| 3 | **Hooks / gebeurtenis-seintjes** | lifecycle-seintjes (start / na-tool / stop) komen in interactieve modus binnen via de http-hook | **JA** (anders is het systeem stuurloos) |
| 4 | **Turn-end detectie** | de Stop-hook markeert betrouwbaar het einde van een beurt (zodat een slot vrijkomt) | **JA** (hangt aan #3) |
| 5 | **Context-cyclus (compact→clear+handoff)** | `/compact` behoudt de sessie-id; `/clear` + een handoff-doc dat meteen heringelezen wordt werkt; de "2× compact → clear" test slaagt (ADR 0017) | **JA** voor de token-opt-laag |
| 6 | **Verbruik per beurt uitlezen** | tokens/verbruik per beurt zijn af te lezen (uit hook-payload of `/usage`); zo niet → expliciet een ruwe schatting (advisory) | Nee — bepaalt alleen hoe nauwkeurig de verbruik-weergave is |
| 7 | **Resume na crash** | `--resume <sessionId>` pakt een sessie weer op na een herstart van de hoofdmotor | **JA** (robuustheid) |
| 8 | **Veilig inloggen (managed token projection)** | een container-`claude` logt in op het abonnement zónder dat meerdere tegelijk de credentials corrumperen | **JA** (containers) |

## Beoordelingsregels
- Markeer per rij: **GELUKT** / **GELUKT-MET-WORKAROUND** / **NIET-GELUKT**.
- **Max aantal workarounds** bewaken (G-SPIKE-1): te veel gestapelde workarounds = de facto niet-gelukt, ook al lijkt elke rij los "gelukt".
- Pin de geteste **CLI-versie** vast en noteer het **server-OS** per rij (G-SPIKE-3/-4).
- Alle blokkerende rijen groen → door naar de rest van de bouw. Rood op #1/#3/#7/#8 → eerst oplossen of escaleren.

## Waar dit op leunt
- **ADR 0005** — spike = stap 1 (volgorde).
- **ADR 0016** — dual-support (subscription-PTY + API per feature).
- **ADR 0017** — configureerbare context-cyclus (compact→clear+handoff, per model).
- **`P0_CLI_SPIKE.md`** — de uitgebreide technische spike-spec (deze pagina is de samenvatting).
