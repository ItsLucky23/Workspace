# ADOPTION_PROGRAM — /goal run-commando (kopieer de body onder de streep achter `/goal`)

> De rijke, zelf-dragende prompt voor de autonome run. Alles wat de uitvoerende AI nodig heeft staat erin; niet enkel een verwijzing. <3500 tokens.

---

Voer `src/workspaces/_docs/ADOPTION_PROGRAM.md` VOLLEDIG uit — alle 11 fasen, item voor item, in de volgorde van het "Volgorde-advies" (F → W+T → S+K+R → U+N+Y → C → H). Dit is een lange autonome run; de user is weg en beantwoordt niets. Werk door tot alles gebouwd, getest (incl. e2e) en gecommit is. Reply in het Nederlands.

CONTEXT — lees eerst:
- `src/workspaces/_docs/ADOPTION_PROGRAM.md` (dit plan; per item: seam + Verify-regel + gelockte beslissingen + file:line-hints uit de 4 audits van 2026-07-08).
- CLAUDE.md session-start-leesorde: `V1_SCOPE.md` (wint op conflict) → `BUILD_ORDER.md` → de owning build-doc per stuk. `REFERENCE_CODES.md` voor codes.
- IDEA_TO_OUTCOME + FREEDOM zijn COMPLEET (ADR ≤0160). Herbouw NIETS dat al bestaat — check `git log`, `branch-logs/main.md` en `docs/AI_PROJECT_INDEX.md` vóór elk item. Query MCP (`blast_radius`/`who_imports`/`find_route`/`get_capability`) i.p.v. gokken.

INVARIANTEN (een change die er één breekt is fout, ook al "werkt" het):
- B-23 single-writer (AI propose → Conductor is de ENIGE writer); GEEN nieuwe structured-channel-verbs (re-express via de frozen 7+6 + `WorkspaceTrigger` + run-command + MCP); `runInTenant` op ELK orchestrator- én worker-pad; PTY-billing (code-agent = interactieve `claude` in node-pty, NOOIT `claude -p`/Agent-SDK; andere providers OK voor non-coding); leader-elected multi-instance-safe.
- Strict typing: NOOIT `as any` / `as unknown as T` — faalt typing, run `npm run generateArtifacts`; blijft het fout, fix de generator. `functions.tryCatch`/`functions.sleep` in handlers, geen raw try/catch. i18n ×4 (en/nl/de/fr) voor ÉLKE user-facing string. Alleen Tailwind theme-tokens (geen hex). Surgical: elke gewijzigde regel traceert naar het item.

PER ITEM (waterfall — volledig groen + gecommit vóór het volgende):
1. schema (`prisma/schema.prisma`) → indien gewijzigd: backend DOWN (kill node-procs vs EPERM) → `npm run prisma:db:push` → `npm run generateArtifacts`.
2. engine (server) → client → i18n ×4. Content-op-wiring = conductor-case + `rbac.ts` OP_CAPABILITY + `controlApi.ts`-union + de `_server_v1` whitelist + clientInput-veld. Snapshot-veld = `types.ts` + `workspaceSnapshot.ts`-map + de 2 lege ContentSnapshot-defaults. Native `<select>` → framework `Dropdown`.
3. Gates ALLE groen: `npm run typecheck` (tsc 0) · `npm run lint` · `npm run build` · `npm run ai:lint` · de test (`node scripts/runWsTests.mjs <filter>`).
4. Test-beleid: wiring/hardening = ECHTE integratietests (Mongo/git/fixtures, geen keys). Echte gen/render/publish/push/analytics = fixture/structuur-tests (mock HTTP, assert request/command-shape, OAuth/VAPID-flow) — NOOIT live calls; de stub-fallback houdt de pipeline e2e-groen zonder keys. Live-externe verificatie (publish/analytics) = user-triggered later. Blokkeer NOOIT op een key. Live-opt-in-tests heten `*.live.mts` (runWsTests draait ze niet).
5. E2E: draai de relevante ws-suite; voor UI-items browser-verify met de DEV-SERVER. De user autoriseerde vooraf de dev-server + alle commands + browser-tools autonoom te draaien (Docker is aanwezig — de live-media-proof draaide er al op). Start `npm run server` + `npm run client`, verifieer via agent-browser (Playwright MCP alleen voor de editor-subdomain / cross-browser). Leg een korte bevinding vast. Faalt e2e → fix vóór commit. (Eerste browser-tool-gebruik kan één trust-prompt tonen; daarna autonoom.)
6. ADR (`docs/decisions/NNNN` + `npm run ai:decisions`) bij een durable keuze · branch-log-entry in `branch-logs/main.md` + `INDEX.md`-rij (timestamp+count) · ververs de `workspaces-adoption-program` memory · refresh in-session `npm run ai:capabilities`/`ai:project-index`/`ai:graph` na route/helper/component-changes.
7. Commit: author `ItsLucky23`, GEEN Claude co-author, NIET pushen, op `main`. `git status` eerst; stage ALLEEN je eigen files. NOOIT stagen: `.env`, `.env.local`, `.claude/settings.json`. NIET aanraken: `scripts/prismaWithSecrets.ts`. `.env.local` mag gelezen worden.

GELOCKTE BESLISSINGEN (NIET stoppen om te vragen — staan ook in het plan §OPEN VRAGEN RESOLVED):
- Ultrasync (Fase Y): DOM-streaming (rrweb-stijl over websockets), GEEN pixel-capture. Eén engine, twee consumers: verborgen admin-watch (nieuwe RBAC-permissie `ultrasync.watch`, zonder waarschuwing én ZONDER audit-record — volledig spoorloos, user-beslissing) + peer-share ("X kijkt mee"-badge). Workspace-aan-toggle + user-visuele-toggle (eigen data altijd gedeeld). Auto-tier lichte ~10-15Hz / zware ~2fps + dynamische downgrade + fps/mode-label. Semantische adapters voor Fabric / video (via media-URL + playback-state) / in-page-Monaco. Openvscode cross-origin = bekende blinde vlek. Kern werkend op de pipeline-pagina + navbar; per-page uitrol = Y4-epic.
- Any-stack (S): multi-base catalog. Services (K): compose-engine met sanitizer (weiger `privileged`/host-mounts buiten het ws-volume/`network_mode:host`/docker.sock, herschrijf vaste host-ports) + per-workspace namespacing (`docker compose -p ws-<id>` + eigen netwerk + volume-prefix); catalog = presets. Main-zonder-X (T): pinned commit/timestamp ÉN synthetic revert-ref. Analytics (C3): fixtures nu, live later. SSO/2FA (H3): GESCHRAPT (evt. later framework-niveau).
- Ambigue fork zonder antwoord → sensible default + `OPEN VRAAG` in de branch-log → doorgaan. Alleen een billing/PTY-RED of een tenant-leak escaleert naar de user; al het andere zelf oplossen. Kleine, lazy-geladen npm-deps die een item nodig heeft (force-layout voor N2, rrweb-achtige helper voor Y2) mogen geïnstalleerd — nooit in een core-chunk.

DOEL-EINDE: elke fase gebouwd → gegate → e2e-getest → ge-ADR'd → gecommit. Sluit af met een korte samenvatting per fase (gedaan / aannames / openstaand) in de branch-log. Begin nu bij Fase F, item F1.
