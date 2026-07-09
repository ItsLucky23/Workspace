# ADOPTION_PROGRAM — /goal run-commando (kopieer de body onder de streep achter `/goal`)

> De rijke, zelf-dragende prompt voor de autonome run. Alles wat de uitvoerende AI nodig heeft staat erin; niet enkel een verwijzing. Body = 3466 tekens (< de /goal-limiet van 4000; doel was <3500).

---

Voer `src/workspaces/_docs/ADOPTION_PROGRAM.md` VOLLEDIG uit — alle 11 fasen, item-voor-item, volgorde F → W+T → S+K+R → U+N+Y → C → H. Autonome run; user weg, beantwoordt niets. Werk door tot alles gebouwd, e2e-getest, gecommit. Reply NL.

LEES EERST: het plan (per item: seam + Verify + beslissingen + file:line-hints) + `V1_SCOPE.md` (wint) + `BUILD_ORDER.md`. IDEA_TO_OUTCOME + FREEDOM zijn COMPLEET (ADR ≤0160): herbouw NIETS dat bestaat — check git log, branch-log, AI_PROJECT_INDEX + MCP vóór elk item.

INVARIANTEN (breken = fout): B-23 single-writer (AI propose → Conductor = enige writer); GEEN nieuwe structured-verbs (re-express via frozen 7+6 + triggers/run-command/MCP); `runInTenant` op elk orchestrator/worker-pad; PTY-billing (code-agent = interactieve `claude` in node-pty, nooit `claude -p`/Agent-SDK; andere providers OK non-coding); leader-elected. NOOIT `as any`/`as unknown as T` — faalt → `generateArtifacts`, blijft fout → fix de generator. `functions.tryCatch`/`sleep`, geen raw try/catch. i18n ×4 (en/nl/de/fr) élke user-facing string. Alleen theme-tokens. Surgical.

PER ITEM (groen + gecommit vóór het volgende):
1. schema gewijzigd → backend DOWN (kill node vs EPERM) → `prisma:db:push` → `generateArtifacts`.
2. engine → client → i18n×4. Content-op = conductor-case + rbac + controlApi-union + `_server_v1`-whitelist + clientInput; snapshot = types.ts + workspaceSnapshot.ts + 2 lege defaults; `<select>`→`Dropdown`.
3. Gates ALLE groen: `typecheck` (tsc 0) · lint · build · ai:lint · `node scripts/runWsTests.mjs <filter>`.
4. Tests: wiring = echte integratie (Mongo/git/fixtures, geen keys); gen/render/publish/push = fixture/structuur (mock HTTP, assert shape, OAuth/VAPID) — NOOIT live; stub houdt e2e groen. Blokkeer NOOIT op een key. Live-opt-in = `*.live.mts`.
5. E2E: relevante ws-suite; UI-items browser-verify — `npm run server`+`client` → agent-browser (user autoriseerde dev-server+commands+browser autonoom; Docker aanwezig; Playwright MCP enkel editor-subdomain), bevinding vastleggen. Faalt → fix vóór commit.
6. ADR (`docs/decisions/NNNN` + `ai:decisions`) bij durable keuze · branch-log + INDEX-rij · ververs `workspaces-adoption-program` memory · refresh `ai:capabilities`/`ai:project-index`/`ai:graph` na route/helper/component.
7. Commit: author `ItsLucky23`, GEEN Claude co-author, NIET pushen, `main`. `git status` eerst; stage ALLEEN eigen files. NOOIT: `.env`/`.env.local`/`.claude/settings.json`. NIET aanraken `scripts/prismaWithSecrets.ts`.

BESLISSINGEN (honor plan §OPEN VRAGEN RESOLVED — niet stoppen om te vragen): Y=DOM-streaming (rrweb-stijl, GEEN pixel-capture); verborgen admin-watch (RBAC `ultrasync.watch`, geen waarschuwing én GEEN audit-record) + peer-share (badge); workspace-aan + user-visuele-toggle; auto-tier ~10-15Hz/~2fps + downgrade + label; adapters Fabric/video(media-URL+playback)/in-page-Monaco; openvscode cross-origin = blinde vlek; kern op pipeline+navbar, rest = Y4. S=multi-base catalog. K=compose-engine + sanitizer (weiger privileged/host-mounts/network_mode:host/docker.sock, herschrijf host-ports) + per-workspace namespacing; presets. T=pinned commit ÉN synthetic revert-ref. C3=fixtures nu, live later. H3=GESCHRAPT. Ambigu → default + `OPEN VRAAG` branch-log → door. Alleen billing/PTY-RED of tenant-leak escaleert. Kleine lazy npm-deps OK (nooit core-chunk).

Begin nu bij Fase F (F1). Sluit af met een samenvatting per fase (gedaan/aannames/openstaand) in de branch-log.
