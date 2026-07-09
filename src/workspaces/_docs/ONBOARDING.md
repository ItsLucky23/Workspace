# Workspaces — Onboarding (nieuwe teams & admins)

> H6 (ADOPTION). Van nul naar een draaiende AI-orchestratie in ~10 minuten. Voor de **operator/admin** die een
> workspace opzet en het team uitnodigt. Zie `V1_SCOPE.md` voor wat er ships en `BUILD_HANDOFF.md` voor de architectuur.

## 1. Een workspace aanmaken

1. Log in en klik **New workspace**. Kies de **module** bij aanmaak (Dev / Content / Design) — dit gate't de
   navigatie en slaat de repo/Dockerfile-prompt over voor niet-Dev-modules (ADR 0097).
2. Elke workspace is een **tenant**: alle data (tickets, secrets, containers) is rij-geïsoleerd via `runInTenant`.
   Niks lekt tussen workspaces.

## 2. Je team uitnodigen (RBAC)

- **Settings → Members → Invite** met een e-mail + rol. De invite krijgt een tijd-gelimiteerde token; de invite-mail
  gaat automatisch uit (no-op als e-mail niet geconfigureerd is — deel dan de link handmatig).
- **Rollen** zijn een capability-matrix (`workTickets`, `editPipeline`, `workspaceSettings`, …). Maak eigen rollen via
  **Settings → Roles**. De **owner** kan ownership overdragen.
- Elke governance-actie (rol wijzigen, secret zetten, member verwijderen) landt in de **audit-log** (H1) — zichtbaar
  voor `workspaceSettings`-rollen. Secret-VALUES worden nooit gelogd.

## 3. Een repo koppelen (Dev-module)

- **Settings → Repository**: koppel een GitLab/GitHub-repo (of start greenfield — dan genereert de eerste ticket de
  scaffold). Meerdere projecten per workspace worden per-project gerouteerd (webhook-issues → het juiste project).
- Secrets/tokens zet je onder **Settings → Environment**. Secret-waarden zijn versleuteld at rest; alleen de KEYS
  verschijnen in een export (H4).

## 4. De pipeline instellen

- **Pipeline**: stages zijn configureerbaar (refine → plan → code → test → review → final). Voeg stages toe, verwijder
  ze, of versleep om te herordenen — dit **persisteert** (R1). Per stage stel je model, effort, prompts en een
  Definition-of-Done in.
- Een **test-stage** vuurt automatisch de ingebouwde CI (`.workspaces/ci.yml`); een RODE run blokkeert de advancement
  (R2). Zet een stage op **gate for approval** om een mens te laten goedkeuren vóór de volgende stage.

## 5. Je eerste ticket

1. Maak een ticket met een korte omschrijving. De pipeline drijft het door de stages; de AI stelt **non-blocking
   vragen** (werkt door met aannames) of **blocking vragen** (parkeert tot je antwoordt) — beantwoord ze vanaf je
   telefoon.
2. Jij bent de **man-in-the-middle**: de AI *stelt voor*, jij *keurt goed*, de **Conductor** *voert uit* (B-23,
   single-writer). Destructieve acties vragen altijd een expliciete bevestiging.

## 6. Kosten & eerlijkheid

- **Usage** toont tokens/tijd per ticket en **per gebruiker** (H2). Zet per-model-prijzen als je per-token API
  betaalt (op het Max-abonnement is de kost 0 — je ziet volume).
- Bij vol capaciteit draint de wachtrij **eerlijk** (round-robin per workspace, H5) — één druk project verhongert de
  rest niet.

## 7. Content & Design (optionele modules)

- **Content**: script → stem → render → publiceren (YouTube/TikTok), met **inplannen** (C1) en **audience-analytics**
  terug naar de ideator (C3).
- **Design/Studio**: AI-gegenereerde assets, brand-kit, en de **UI-review** ("unfuck the UI": upload screenshots +
  vink problemen aan → redesigns, U1).

## Volgende stappen

- `V1_SCOPE.md` — wat ships (wint bij conflict).
- `BUILD_HANDOFF.md` → `BUILD_ORDER.md` — de architectuur en bouwvolgorde.
- De negen staande invarianten staan in `CLAUDE.md` (§ Workspaces) — lees ze vóór je code raakt.
