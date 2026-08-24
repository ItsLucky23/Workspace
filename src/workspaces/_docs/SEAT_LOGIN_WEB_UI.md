# Seat-login via de web-UI (owner-richting 2026-08-24 — NOG NIET GEBOUWD)

**Wens (letterlijk):** "we willen dalijk kunnen inloggen via de browser … bij subscription setup een
terminal krijgen en daarop die login-flow doorlopen … het project moet gewoon installen en runnen zijn
buiten enkele env values; géén extra stap dat iemand ook nog op de server moet inloggen; liever een
web-UI met een beetje hulp via de terminal."

## Wat dit vervangt

Vandaag zijn de seat-logins host-side handwerk (docs/HOSTING.md §Claude auth, lesson 0023):

- Claude-seat: `claude` CLI op de host met `CLAUDE_CONFIG_DIR=<WS_AUTH_DIR>` (prod: `/var/lib/workspaces/auth`).
- Codex/pi-seat (ADR 0322): `pi` CLI op de host met `PI_CODING_AGENT_DIR=<WS_AUTH_DIR>/pi-agent`;
  de orchestrator projecteert `auth.json` → `<WS_AUTH_DIR>/pi-auth.json` per turn
  (`server/orchestrator/codingAgents/piAgent.ts`, newest-expires-wins copy-back).

## Ontwerpschets (te toetsen bij de bouw)

1. **Waar in de UI:** de bestaande subscription/seat-setup-sectie (aibehavior → Backends / readiness-
   `SetupNotice`, ADR 0284): een "Log in"-knop per seat zodra de seat niet-geauthenticeerd is.
2. **Mechaniek:** een kortlevende, doel-gebonden PTY — het orchestrator-host-proces spawnt UITSLUITEND
   het vaste login-commando (`claude /login` resp. `pi auth login …`) met de juiste config-dir-env, en
   streamt die PTY naar de bestaande XtermTerminal-component. Geen shell, geen vrije argv: het commando
   is een servervaste constante per seat. De flows zijn device-code/URL-gebaseerd, dus een read-only
   terminal + één invoerveld volstaat.
3. **Autorisatie:** superadmin-only (`WS_SUPERADMIN_EMAILS`-laag), audit-event bij start/succes.
   Invariant 4 (assistant nooit host-level) blijft intact: dit is een USER-actie via een control-API-op
   (B-23: enqueue → Conductor spawnt), niet iets dat een LLM kan aanroepen.
4. **Vereist op de host:** `claude` + `pi` CLIs geïnstalleerd (base-image heeft ze al; de HOST kreeg ze
   op 2026-08-24 ook) en `PI_CODING_AGENT_DIR` gezet waar `ProtectHome=true` bij kan (zie boven).
5. **Nieuwe op:** past niet in de frozen 7+6 read/propose-surface als assistant-verb en hoeft dat ook
   niet te zijn — dit is een user-initiated `[control-API]`-write zoals elke andere (invariant 2 en 3
   botsen niet; wél een rij in `tests/effectMatrix.mts`).

## Openstaand bij de bouw

- Verloopdetectie: `claude auth status` / `pi auth check --provider … --json` als readiness-probe
  (lesson 0023: versie-check zegt niets), periodiek + vóór elke ticket-run tonen in de setup-checklist.
- PTY-levensduur/timeout + wat er gebeurt als de flow halverwege sluit.
- Multi-instance: login-PTY moet op de LEADER draaien (invariant 5) of instance-pinned zijn.
