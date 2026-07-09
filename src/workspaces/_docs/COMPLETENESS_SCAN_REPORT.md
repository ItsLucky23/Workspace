# Workspaces — Completeness Scan Report

## 1. Executive verdict

> **Coverage: 21/21 feature clusters** — 18 in the main workflow run + 3 re-scanned afterward (see the Addendum at the bottom: pipeline-editor, secrets/integrations, navigation/onboarding/i18n). Net critical count is **8** and there is a **high-severity secrets-in-snapshot leak** surfaced by the re-scan.

**The software is not complete. The backend is real; the product is not.** Across 21 feature clusters and ~250 audited features, the orchestration engine, Conductor single-writer, tenancy, git/forge, CI, RAG, media generation, deploy/promote and spend plumbing are almost all genuinely implemented and, in many cases, unit-tested. What is missing is the last mile that turns those engines into a usable product: **UI entry points, AI reachability, and truthful controls.**

Three systemic failures dominate:

- **Dead-wired features — built server-side, zero user entry point.** Whole marquee capabilities are 100% unreachable from the app: time-travel / arbitrary-ref preview (`timeTravelPreview_v1` / `openRefPreview_v1`, no `.tsx` caller), the knowledge-graph Obsidian view (`knowledgeGraph_v1`, no consumer), the entire compose service-stack + preset gallery + database layer (`service-provision`, `listServicePresets`, `db-*`), audit log, GDPR export, PAT management, output templates, scheduled publishing, per-platform publish variants, the audience-metrics feedback loop, and the `copilot-propose` "AI-drives-UI" op. In each case the code runs; nothing calls it.

- **The content pipeline does not flow, and the emergency stop does not stop.** Two failures are outright *critical*: (a) the 6-stage content board is inert — `content-advance` has **zero producers** anywhere, so every piece is stuck at `idea` and 5 of 6 columns are permanently empty (`server/content/runPipeline.ts` never writes `stageId`); (b) workspace-wide **Pause-all is a no-op** (`src/workspaces/page.tsx:335` discards the confirm result) and **Resume-all has no UI at all**, so if the engine ever pauses, the product offers no way to un-pause it — on a phone-first product whose whole premise is a human kill-switch.

- **The AI can barely drive the app it is supposed to drive.** UI↔AI parity is **~3.6%**: `validateChatAction` exposes exactly 5 proposable ops (bulk-move / assign / add-comment / create-ticket / create-content) against ~138 `OP_CAPABILITY` control ops (`server/ai/workspaceChat.ts:48` vs `server/control/rbac.ts:46-185`). The "you write a ticket, the AI does it, you approve" promise holds for five board actions and nothing else — no content generation, no publish, no deploy, no sprint/pipeline/trigger/MR/preview/budget op is AI-proposable.

Layered on top are **real security defects** (redacted-push decision ignored so private ticket bodies hit the lock screen; RBAC privilege-escalation via `role-create`/`role-update` with no cap-ceiling; `change-role` not enforcing `promoteAdmin`; single-notification `mark-read` unscoped by `userId`), a scatter of **dead no-op buttons** that erode trust, and **i18n gaps** (missing de/fr board keys, English editor chrome, German mojibake).

**Bottom line:** this is a deep, largely-honest engine wrapped in an incomplete, in-places-deceptive shell. It is not shippable to a non-expert user today. The good news is that most fixes are UI-wiring and AI-catalog work against contracts that already exist — not new backend.

---

## 2. Per-cluster feature tables

Legend — **Cmpl** (completeness): complete / partial / stub / needs-live / missing. **UI** (uiReachable) & **AI** (aiReachable): yes / no / partial / na / intentional-exception (IE). **UX** (uxClarity): clear / unclear / confusing / na.

### Board & tickets
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| quick-add (create ticket) | complete | yes | yes | clear |
| ticket-edit (title/desc/labels/priority) | complete | yes | no | clear |
| add-comment | complete | yes | yes | clear |
| archive (single) | complete | yes | no | clear |
| bulk-move | complete | yes | yes | clear |
| bulk-status | complete | yes | no | clear |
| bulk-assign | complete | yes | yes | clear |
| bulk-sprint | complete | yes | no | clear |
| bulk-archive | complete | yes | no | clear |
| sprint-create | complete | yes | no | unclear |
| sprint-edit (activate/rename/dates) | **partial** | **no** | no | **confusing** |
| finding-to-ticket | complete | yes | IE | clear |
| finding-dismiss | complete | yes | IE | clear |
| ticket-link-artifact | complete | yes | no | clear |
| ticket-unlink-artifact | complete | yes | no | clear |
| Card menu: pause/resume agent | **stub** | yes | na | **confusing** |
| Card menu: Add reference | **stub** | yes | na | **confusing** |
| Board header: Pause all | **stub** | yes | na | **confusing** |
| answerInput (needs-input) | needs-live | yes | IE | clear |
| Board filters (view only) | complete | yes | na | clear |
| Live board/backlog render | complete | yes | na | clear |

### Agent runtime & live control
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Live container terminals | needs-live | yes | na | unclear |
| Pause ticket agent | complete | yes | no | clear |
| Resume ticket agent | complete | yes | no | clear |
| Kill ticket agent | needs-live | yes | IE | clear |
| Pause ALL (kill switch) | complete | **no** | no | **confusing** |
| Resume ALL | complete | **no** | no | **confusing** |
| Answer AI question | needs-live | yes | IE | clear |
| Advisory-question resolution | **partial** | **no** | na | **confusing** |
| Time-travel / preview open/close | needs-live | yes | no | clear |
| preview-up / preview-down ops | **missing** | na | na | na |
| Capacity admission | complete | no | na | na |
| Crash-recovery watchdog | complete | na | na | na |
| PTY billing / in-container turn | needs-live | na | na | na |
| Workspace-AI reach of runtime controls | complete | na | no | na |

### Repo & git / GitLab / forge / time-travel
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Link repo (bare clone) | needs-live | yes | IE | clear |
| Save git config | complete | yes | no | clear |
| Workspace GitLab/GitHub settings | needs-live | yes | IE | unclear |
| GitLab token Verify | **stub** | yes | na | **confusing** |
| Manual forge resync (gitlab-resync) | complete | **no** | **no** | na |
| Per-project forge connect | needs-live | yes | IE | clear |
| Forge issue poller | needs-live | na | na | na |
| Forge webhook ingestion | needs-live | **no** | na | unclear |
| Push-on-approval + open MR/PR | needs-live | partial | na | clear |
| Time-travel preview (commit/revert/as-of) | complete | **no** | **no** | **confusing** |
| Open arbitrary ref preview | complete | **no** | **no** | na |
| Server-side merge/revert + greenfield init | needs-live | partial | no | clear |

### Code editor & preview
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Live in-container VS Code editor | needs-live | yes | IE | clear |
| Editor profile + edit-lock guard | needs-live | yes | na | clear |
| In-app Monaco "Changes" diff | **partial** | yes | na | **unclear** |
| App preview (open-preview) | needs-live | yes | no | clear |
| Close preview (preview-down) | **partial** | **no** | no | na |
| Save dev command | complete | yes | no | clear |
| Time-travel / ref preview | needs-live | **no** | **no** | **confusing** |
| Dev-only editor harness | complete | no | no | na |

### Docker images, services & databases
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| generateDockerfile (AI) | needs-live | yes | no | clear |
| getDockerfile | complete | yes | na | clear |
| saveDockerfile | complete | yes | na | clear |
| buildProjectImage (L2) | needs-live | yes | no | clear |
| Base-image catalog (S1/S2) | needs-live | na | na | na |
| setDevCommand | complete | yes | no | clear |
| project-create | complete | yes | no | clear |
| project-from-template | needs-live | yes | no | clear |
| service-create / -delete | complete | yes | no | clear |
| service-provision (compose, K1) | **partial** | **no** | **no** | na |
| service presets (K2) | **partial** | **no** | **no** | na |
| service-teardown | **partial** | **no** | **no** | na |
| composeSanitize | complete | no | na | na |
| serviceEnv / network (K3) | complete | na | na | na |
| db-connect | **partial** | **no** | **no** | na |
| db-migrate-create | **partial** | **no** | **no** | na |
| db-migrate-apply | **partial** | **no** | **no** | na |
| db-introspect | **partial** | **no** | **no** | na |

### CI & merge-request review
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Built-in CI runner (ci-run) | needs-live | **no** | partial | unclear |
| CI merge/promote gate | complete | partial | na | unclear |
| CI status / checks surfacing | **partial** | **no** | na | **confusing** |
| Security & dependency scanning | needs-live | **no** | na | **confusing** |
| Open/refresh MR (mr-create) | complete | yes | IE | clear |
| Line-anchored review comments | complete | yes | IE | clear |
| Approve MR (mr-approve) | complete | yes | IE | clear |
| Merge MR (mr-merge) | needs-live | yes | IE | unclear |
| Rollback merged MR | needs-live | yes | IE | clear |
| Resolve/unresolve thread | complete | yes | IE | clear |
| AI MR review (mr-review) | needs-live | **partial** | partial | **confusing** |
| AI root-cause / rollback | needs-live | partial | partial | **confusing** |
| Plan-critique | needs-live | partial | partial | **confusing** |
| CI admin red-override | complete | **no** | IE | confusing |
| Accept AI rollback | complete | yes | IE | clear |
| Interviewer finding→ticket/dismiss | complete | yes | IE | clear |

### Deploy & environments (LIVE-deferred)
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| env-deploy | needs-live | yes | **no** | clear |
| env-teardown | needs-live | yes | IE | clear (⚠ no confirm) |
| env-promote (ladder+gates) | needs-live | yes | **no** | clear |
| build-export (image/bundle/webhook) | needs-live | **partial** | no | clear |
| demo env + auto-redeploy (D3) | needs-live | **no** | **no** | na |
| Build download route | needs-live | yes | na | clear |
| External deploy webhook (D4) | needs-live | partial | na | unclear |
| Boot self-heal env routes | needs-live | na | na | na |

### RAG, sources & knowledge graph
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| RAG code index + retrieve | complete | yes | yes | clear |
| Embeddings (Gemini + local) | complete | na | yes | na |
| Context docs / Sources | complete | yes | yes | **unclear** |
| Knowledge graph / Obsidian (N1) | **partial** | **no** | na | na |
| Product self-knowledge RAG | complete | yes | yes | clear |
| Secondary corpora | complete | na | yes | na |

### Settings, RBAC, members, audit & export
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Members list + change-role | complete | yes | IE | clear (⚠ RBAC) |
| Remove member | complete | yes | IE | clear (⚠ no owner-guard) |
| Invite member + email | needs-live | yes | IE | clear |
| Revoke invite | complete | yes | IE | clear |
| Accept invite | complete | yes | IE | clear |
| Create custom role | complete | yes | IE | clear (⚠ no ceiling) |
| Edit RBAC matrix (role-update) | complete | yes | IE | clear (⚠ escalation) |
| Transfer ownership | complete | yes | IE | clear |
| Rename workspace | complete | yes | IE | clear |
| Delete workspace | complete | yes | IE | clear |
| Module gating (save-sections) | complete | yes | IE | clear |
| Autonomy level | complete | yes | IE | clear |
| AI instruction/lang/model | complete | yes | IE | clear |
| Per-feature AI provider override | complete | yes | IE | unclear |
| Audit log view (H1) | complete | **no** | **no** | na |
| Workspace data export (H4/GDPR) | complete | **no** | **no** | na |
| Personal Access Tokens (X3) | **partial** | **no** | IE | na |
| Account settings page | needs-live | yes | na | clear (⚠ stubs) |

### Triggers, automation & custom tasks
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Trigger create/edit | complete | partial | **no** | unclear |
| Trigger enable/disable | complete | yes | no | clear |
| Trigger delete | complete | yes | IE | unclear (no confirm) |
| Trigger run-now | complete | partial | no | clear |
| Event-driven firing | **partial** | na | na | na |
| Cron scheduler | complete | yes | no | clear |
| Approval gate | complete | yes | na | clear |
| Action: notify | complete | yes | no | clear |
| Action: webhook | complete | yes | no | **confusing** |
| Action: emit-signal | complete | yes | no | unclear |
| Action: start-stage | complete | yes | no | clear |
| Action: invoke-agent-role | complete | partial | no | clear |
| Action: run-command | **stub** | **no** | IE | na |
| Action: invoke-workspace-ai | **stub** | **no** | na | na |
| Agent-role registry | complete | yes | na | clear |
| Custom AI tasks | needs-live | yes | no | clear |
| Output templates | **partial** | **no** | **no** | na |

### Spend, budgets & capacity
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Token usage tracking + Usage page | complete | yes | na | clear (cost always 0) |
| Per-user spend attribution | **stub** | **no** | na | **confusing** |
| Token budget cap/alert + ops | **stub** | **no** | **no** | na |
| Media EUR-budget (enforced) | needs-live | yes | no | clear |
| Pause-all / resume-all | complete | **no** | **no** | **confusing** |
| Capacity manager / fair draining | complete | no | na | na |

### Workspace-AI (chat, copilot, AI-drives-UI)
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| AI chat interpreter | complete | yes | yes | clear |
| Proposable: bulk-move | complete | yes | yes | clear |
| Proposable: assign | complete | yes | yes | clear |
| Proposable: add-comment | complete | yes | yes | clear |
| Proposable: create-ticket | complete | yes | yes | clear |
| Proposable: create-content | complete | yes | yes | clear |
| Multi-step intake plan | complete | yes | yes | clear |
| RAG code grounding | needs-live | yes | yes | clear |
| Product-knowledge grounding | needs-live | yes | yes | clear |
| Single-writer safety (B-23) | complete | yes | na | clear |
| AI-drives-UI copilot (copilot-propose) | **stub** | **no** | **no** | **confusing** |
| UI↔AI op-parity | **partial** | yes | **partial** | **unclear** |
| Chat empty/starter/tabs | complete | yes | na | clear |
| Time-travel guidance via chat | **partial** | yes | no | unclear |
| Chat error/loading states | complete | yes | na | clear |

### Notifications, realtime, presence & PWA push
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Notification bell + badge | complete | **partial** | na | clear (no mobile) |
| mark-read (single+all) | complete | yes | IE | clear (⚠ scope) |
| Web Push subscribe/unsubscribe | needs-live | yes | na | clear |
| Redacted-push posture | **missing** | **no** | na | na |
| Per-type push opt-out | needs-live | yes | na | clear |
| Notification/push producers | needs-live | yes | yes | clear |
| Ticket presence (#17) | complete | yes | na | clear |
| Activity-presence CORE (Y1) | **stub** | **no** | na | na |
| Realtime snapshot delta-merge | complete | yes | yes | clear |
| Activity feed page | complete | yes | na | clear |
| PWA installability | needs-live | yes | na | clear |

### Content pipeline core
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Content board (stages + budget) | complete | yes | na | **unclear** |
| Content piece detail (gen console) | complete | yes | na | clear |
| content-from-brief (only live create) | complete | **no** | yes | unclear |
| content-create (add to project) | complete | **no** | **no** | na |
| **content-advance + stage machine** | complete | **no** | **no** | na |
| content-archive | complete | **no** | **no** | na |
| content-unarchive | complete | **no** | **no** | na |
| content-unpublish | needs-live | **no** | **no** | na |
| content-run-pipeline | needs-live | yes | **no** | clear |
| content-refine-range | needs-live | yes | no | clear |
| content-regenerate | needs-live | yes | no | clear |
| contentControl _sync (write path) | complete | yes | partial | na |

### Content generation (script/voice/image/video/3d/audio)
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Script generation | needs-live | yes | **no** | clear |
| Voiceover (TTS) | needs-live | yes | **no** | clear |
| Image generation | needs-live | yes | **no** | clear |
| Video generation + stitch | needs-live | yes | **no** | clear |
| 3D model generation | **partial** | **partial** | **no** | **unclear** (broken live) |
| Audio (music/sfx) | needs-live | yes | **no** | clear |
| Avatar generation | needs-live | **no** | **no** | na |
| Reference-video analysis (F2.3) | needs-live | **no** | **no** | na |
| Full pipeline "make a video about X" | needs-live | yes | **no** | clear |
| Short-form hook/captions | **partial** | yes | **no** | clear (stub hook) |
| Assistant-driven gen (copilot) | **stub** | na | **no** | na |

### Publishing, scheduling & channels/accounts
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Connect account (OAuth) | needs-live | yes | IE | clear |
| Disconnect account | complete | partial | IE | clear |
| Publish render (immediate) | needs-live | yes | **no** | clear |
| Scheduled publishing | **partial** | **no** | **no** | na |
| Multi-account routing | **partial** | **no** | **no** | na |
| Channel create/delete | complete | yes | **no** | clear |
| Channel edit | **partial** | **no** | **no** | na |
| Unpublish/retract | **partial** | **no** | **no** | na |
| Publish job status visibility | **partial** | **no** | na | **confusing** |
| Per-platform publish variant | **partial** | **no** | **no** | na |
| Audience metrics + feedback loop | **stub** | **no** | **no** | na |
| Scheduled tasks page (cron) | complete | yes | partial | clear |

### Content settings, brand & style libraries
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Brand/product context | complete | yes | **no** | clear |
| Media provider keys | needs-live | yes | IE | clear |
| Gemini text-provider key | needs-live | yes | IE | clear |
| Per-feature media model override | complete | yes | IE | clear |
| Media €-budget cap/alert | complete | yes | IE | clear |
| Style library create/save | complete | yes | no | clear |
| Style library delete | complete | yes | no | clear |
| Style preview asset (M1/M4) | **partial** | **no** | **no** | unclear |
| Reference library add/delete | complete | yes | no | clear |
| Channel create/delete | complete | yes | no | clear |
| Channel edit (name/platform/style) | complete | **no** | **no** | **confusing** |
| Channel brand-voice edit | complete | yes | no | clear |
| Social account disconnect | complete | yes | IE | clear |
| Content analytics/insights | needs-live | yes | na | clear |
| Brand-kit export/import | complete | **no** | **no** | na |
| Style-set export/import | complete | **no** | **no** | na |
| Cross-workspace asset copy | complete | **no** | **no** | na |
| AI reach of content-config | complete | na | **no** | na |

### Design, Studio, Designer & marketing
| Feature | Cmpl | UI | AI | UX |
|---|---|---|---|---|
| Studio brief CRUD | complete | yes | no | clear |
| Studio designer-kind gen | needs-live | yes | partial | clear |
| Studio marketer-kind gen | needs-live | yes | partial | clear |
| Studio marketing visuals/video | needs-live | yes | **no** | clear |
| Studio regenerate + refine | complete | yes | no | clear |
| Central Brand Library | complete | yes | no | clear |
| Brand promote | complete | yes | no | clear |
| Brand kit export/import (R3) | **partial** | **no** | **no** | na |
| Studio→AgentRole bridge | complete | yes | yes | clear |
| Marketing page | complete | partial | na | unclear |
| Designer Themes + AI gen | needs-live | yes | no | clear |
| Designer Styles + AI gen | needs-live | yes | no | clear |
| Designer Animations + AI gen | **partial** | yes | no | clear (no save) |
| Designer Typography | complete | yes | na | clear |
| Designer Components gallery | complete | yes | na | clear |
| Designer Gallery (looks) | complete | yes | no | clear |
| Designer Use-in-project → design-doc | complete | yes | no | clear |
| Interviewer planning chat | needs-live | yes | na | clear |
| Interviewer findings gen | needs-live | **partial** | yes | **unclear** |
| Interviewer finding→ticket/dismiss | complete | yes | no | clear |
| Module gating (Studio/Designer nav) | complete | yes | na | unclear |

---

## 3. Top gaps, ranked by severity, grouped by pillar

### 🟥 CRITICAL

**Completeness**
- **Content board is functionally inert.** `content-advance` has zero producers; `server/content/runPipeline.ts:30-77` never writes `stageId`; only producer `conductor.ts:1453-1463` is unreachable. Pieces stick at `idea`; 5/6 columns permanently empty. *(Content pipeline core)*
- **Token budget is dead-wired.** `enforcement` field written only at seed (`seedWorkspace.ts:73`), never read in `server/`; `spent` never increments because `costEstimate` needs a per-model price that is empty on the Max subscription (`record.ts:42`). Nothing ever pauses on spend; `resume-spend` resets a zero. *(Spend)*

**UI**
- **Pause-all does nothing.** `src/workspaces/page.tsx:335` opens `menuHandler.confirm` but discards the boolean; `ctx.pauseAll()` never called. The primary emergency stop is decorative. *(Agent runtime / Board / Spend — same root bug)*
- **Resume-all has no UI entry point anywhere.** `ctx.resumeAll` (`WorkspacesProvider.tsx:1086`) has zero callers and there is no paused banner — a paused workspace is unrecoverable from the app. *(Agent runtime / Spend)*
- **Time-travel (marquee) is 100% unreachable.** `timeTravelPreview_v1` / `openRefPreview_v1` fully built + tested; grep across all `.tsx`/`.ts` finds no caller. Ticket detail only has `openPreview(HEAD)`. *(Repo & git / Code editor)*

**UX**
- **No way to resume + no paused signal.** `workspacePaused` is broadcast live but only used to disable one button (`board/[ticketId]/page.tsx:202`); the user gets no "why is nothing running?" signal and no recovery path. *(Spend / Agent runtime)*

### 🟧 HIGH

**Completeness**
- **sprint-edit orphaned** — conductor case (`conductor.ts:707-712`) + RBAC exist, but no sync route, no provider method, no UI; and the case writes only name+active, not dates. A created sprint can never be activated/renamed/dated; snapshot hardcodes `start/end/daysLeft=null` (`workspaceSnapshot.ts:491`). *(Board)*
- **5 of 8 trigger events never fire** — `stage.on_complete`, `stage.on_signal`, `stage.on_approval`, `ticket.merged`, `suggestion.accepted` are never emitted; 3 are selectable in the UI, so users build triggers that silently never fire (`AutomationPanel.tsx:18`). *(Triggers)*
- **Privilege escalation** — `role-create`/`role-update` gated only on `editPipeline`, write perms (incl. ownerActions bits) via `boolArr` with no cap-ceiling and no built-in-role immutability (`conductor.ts:738-754`). *(Settings/RBAC)*
- **`change-role` doesn't enforce `promoteAdmin`/`demoteAdmin`** — gated only on `manageMembers`; `CAP.promoteAdmin` referenced by no op at all. Any member-manager can grant `ownerActions`. *(Settings/RBAC)*
- **Redacted-push decision (Q-SEC-NOTIF-PUSH) unimplemented** — `fullBodyOptIn` stored+typed, never read; `webPush.ts:67` always sends full body; `sw.js:14` renders it raw. Private ticket bodies hit the lock screen. *(Notifications)*
- **Every content-from-brief spawns a new Project** — no way to add a piece to an existing project/channel; `content-create` (the fix) is dead-wired (`conductor.ts:1671-1678`). *(Content pipeline core)*
- **Scheduled publishing code-complete but unreachable** — server honors `scheduledAt` end-to-end, but the sync `clientInput` has no `scheduledAt` field and no UI sends it (`contentControl_server_v1.ts:29-52`). Doc drift: `ADOPTION_PROGRAM.md:63` marks C1 ✅. *(Publishing)*
- **Every publish goes PRIVATE + title-only** — `publishVariants` (caption/hashtags/privacy) has no UI writer; default privacy `private` (`publishOAuth.ts:112`). A publishing tool silently posting private. *(Publishing)*
- **Multi-account routing dead** — server threads `accountId` throughout, but OAuth start carries only `ws`, no picker, and the snapshot mis-parses per-account keys so a per-account connection never registers as connected (`workspaceSnapshot.ts:356`). *(Publishing)*
- **Audience-metrics feedback loop (C3) dead-wired** — `ingestPublishMetrics`/`topPerformers` built + tested, zero callers; no metrics ever reach UI or the ideator (`publishMetrics.ts:50,66`). *(Publishing)*
- **3D live path broken** — `content-gen-3d` sends only a prompt but fal triposr needs `image_url`; with real keys the job always errors (`conductor.ts:1621`, `fal.ts:82`). *(Content generation)*
- **Designer Animations have no save path** — `useInProject` handles only theme|style; generated/edited animations lost on reload (`state.tsx:79`, `page.tsx:129`). *(Design/Studio)*

**UI**
- **Whole engines with zero UI:** compose service-stacks + K2 preset gallery + K3 (`service-provision`/`listServicePresets`), the entire DB layer (`db-connect/migrate/introspect`), audit log (`auditLog_v1`), GDPR export (`workspaceExport_v1`), PAT management (no `listPats` route), Output Templates, knowledge-graph N2 view, demo-host (D3), portable brand-kit / style-set export/import, channel-edit. Each: backend real, no button. *(Docker/DB, Settings, Triggers, RAG, Deploy, Content settings, Publishing)*
- **AI MR review / plan-critique / root-cause have no MR/ticket-scoped trigger** — only dispatchable via cron `invoke-agent-role` with no `ticketKey`/`mrId`, so they return "No MR/ticket to review". `mrAction('review')` never called. *(CI & MR)*
- **No CI checks/status/security-findings UI** — latest `PipelineRun`/jobs never read into snapshot; MR panel has no checks section; scanner findings gate prod-promote but are invisible. *(CI & MR)*
- **`invoke-agent-role` can't be an EVENT trigger** — `AutomationPanel` ACTIONS omit it; only cron exposes it, blocking the intended B-4 path. *(CI & MR / Triggers)*
- **AI root-cause has no symptom input** — Scheduled form writes `params.focus`; role reads `params.symptom` (`scheduled/page.tsx:110` vs `rootCauseRole.ts:45`). *(CI & MR)*

**AI** *(all trace to `workspaceChat.ts:48`, the closed 5-op enum)*
- **~3.6% write-action parity** — 5 proposable ops vs ~138 control ops. No AI path to content-gen, publish, deploy/promote, sprint/stage/pipeline, triggers, MR, service/DB, budget, brand/style. The "AI does it, I approve" promise holds for 5 board actions only. *(Workspace-AI, and echoed in Docker/DB, Deploy, Content, Publishing, Triggers, Design)*
- **AI-drives-UI copilot (`copilot-propose`) dead end-to-end** — no emitter, `asSugType` drops `copilot`→`maintenance`, projection omits `patch`, accept has no copilot branch, `SuggestionCard` has no applier. *(Workspace-AI / Content)*

**UX**
- **env-teardown is destructive with no confirm** — absent from `CONFIRM_REQUIRED`; button fires immediately (`settings/page.tsx:294`). Violates B-23. *(Deploy)*
- **Notification bell is desktop-only** — `MobileChrome` has no notif surface; a phone-first user can't see/clear in-app notifications (`MobileChrome.tsx:23-38`). *(Notifications)*
- **No create affordance on content board** — no "New content piece" button; only AI create-content path (`content/page.tsx:69-96`). *(Content pipeline core)*
- **Piece detail can't advance/archive/publish-lifecycle** — shows stage text, no control (`[pieceId]/page.tsx:259-279`). *(Content pipeline core)*

### 🟨 MEDIUM (selected — ~35 total)
- ws-term middleware gated off in prod → Terminals page attaches nothing on self-hosted deploy (`workspacesTerminal.ts:35-36`).
- Advisory questions dead-wired (`answerInput` never forwards `advisoryIndex`).
- `preview-up`/`preview-down` vestigial ops (no conductor case).
- Dockerfile-gen + image-build target the *first* project, not the active one.
- Monaco "Changes" panel shows an "unsaved" counter that can never persist (no `onSave`).
- Editor chrome hardcoded English (VsCodeEmbed/CodeEditorPanel/FileExplorer).
- CI-red/running/stale merge blocks collapse to a generic "merge failed" toast; CI events mislabeled `ai-message`.
- `allowMergeOnRedCI` has no settings toggle → a wedged runner blocks all merges.
- Prod Deploy button bypasses the promote ladder's gates.
- `webhook` trigger action coerced to `notify` in snapshot; no SSRF hardening.
- No owner-protection on `change-role`/`remove-member` server-side.
- Single-notification `mark-read` unscoped by `userId`.
- Fake "who's viewing" AvatarStack (`members.slice(0,3)`), dead Y1 presence engine.
- Chat is ephemeral client-only + stateless per message (no history, no follow-ups).
- Multi-cap budget schema unused; media enforcement uses static estimate not real charge.
- `channel-edit` orphaned + `defaultStyleId` dropped from snapshot fold.
- `retrieveChannelBrand` indexed but never retrieved (wasted work).
- Studio/Designer/Interviewer generation not AI-proposable; thumbnail/videoScript excluded from agent-role KINDS_FOR.

### 🟦 LOW (selected — ~35 total)
- Dead card-menu "Add reference" button; no drag-to-move on kanban.
- 9 missing de/fr board i18n keys; `scheduled.runNow` untranslated de/fr; German mojibake in publish title.
- Stale "Dummy data" header comments across board/backlog/sources/usage (doc drift, misleads AI).
- `run-command` + `invoke-workspace-ai` declared trigger actions with no executor.
- Custom tasks run with no vars → templated placeholders render empty.
- Trigger delete has no confirm on either surface.
- geminiTemperature stored as unclamped string; provider rows show raw slugs.
- `rename-workspace`/`role-create` skip `recordAudit`; delete-workspace audit dies with its tenant.
- Push url hardcoded `/`; settings push toggle not reconciled with real subscription; no install-prompt.
- Migration base-image `:latest` vs `:0.1.0` drift; repoStore token via argv.
- IG/LinkedIn inconsistent between connect list and channel dropdown.

---

## 4. UI ↔ AI parity

**This is a first-class product goal — every action should be reachable via BOTH UI and AI — and it is where the product is weakest.** `OP_CAPABILITY` spans ~138 ops (`rbac.ts:47-184`); the AI prompt exposes exactly **5** (`workspaceChat.ts:48`) → **~3.6% parity**. The automation executor adds only 4 non-content actions (`executor.ts:36`). The `copilot-propose` op that was built to bridge the gap is dead (no emitter, no consumer).

### Reachable via BOTH UI and AI (the entire overlap — 5 ops + finding flow)
`bulk-move`, `assign`, `add-comment`, `create-ticket`, `create-content`, plus the multi-step intake plan and RAG/product-knowledge grounding. That is the complete set of write actions a user can drive by chat.

### UI-only (reachable by clicking, **not** AI-proposable) — the vast majority
Essentially every non-board write op, including: `ticket-edit`, all `bulk-*` except move/assign, sprint-create, archive, artifact link/unlink, pause/resume/kill ticket, save git-config, forge settings/connect, save-dev-command, Dockerfile gen/build, project-create/from-template, all MR ops (create/comment/approve/merge/rollback/resolve), env-deploy/promote/build-export, all RBAC/member/role/ownership/rename/delete ops, autonomy/sections/AI-provider settings, all trigger ops, custom tasks, all content-gen ops (script/voice/image/video/audio), content-run-pipeline/refine/regenerate, publish, channel create/delete, brand/style/reference library ops, all Studio/Designer generation. **Intentional exceptions** (correctly UI-only): destructive ops (kill, delete-workspace, transfer-ownership, remove-member, env-teardown), OAuth connect (AI holds no creds), and secret writes (media/provider keys) — these are deliberately AI-excluded and should stay so.

### AI-only (proposable by chat, **no dedicated UI entry**)
- **`content-from-brief`** — the *only* live content-create path is the AI's `create-content` proposal (`WorkspacesProvider.tsx:850`); there is **no** "New piece" button. A user without the chat cannot create content at all.

### Reachable via NEITHER (built backend, no UI and no AI — the dead-wired tier)
This is the largest correctness problem after the critical no-ops. All fully implemented server-side, callable by nothing:
- **Board:** `sprint-edit`.
- **Agent runtime:** `pause-all`/`resume-all` (backend complete, UI broken/absent), advisory-question resolution, `preview-up`/`preview-down`.
- **Repo/git:** `gitlab-resync`, time-travel / arbitrary-ref preview.
- **Code editor:** time-travel/ref preview, `close-preview`/`preview-down`.
- **Docker/DB:** `service-provision`, `service-teardown`, service presets (K2), `db-connect`, `db-migrate-create`, `db-migrate-apply`, `db-introspect`.
- **CI:** `ci-allow-red` admin override.
- **Deploy:** demo-host (D3) create/toggle/pin.
- **RAG:** knowledge-graph N2 view.
- **Settings:** audit log, GDPR export, PAT issue/list/revoke.
- **Triggers:** Output Templates, `run-command`, `invoke-workspace-ai`.
- **Spend:** token-budget `raise-cap`/`edit-budget`/`resume-spend`, per-user attribution.
- **Workspace-AI:** `copilot-propose`.
- **Notifications:** Y1 activity-presence engine.
- **Content pipeline:** `content-advance`, `content-create`, `content-archive`, `content-unarchive`, `content-unpublish`.
- **Content generation:** avatar generation, reference-video analysis (F2.3).
- **Publishing:** scheduled publishing, multi-account routing, `channel-edit`, unpublish/retract, per-platform publish variant, audience-metrics loop.
- **Content settings:** style preview (M1/M4), brand-kit / style-set export-import, cross-workspace asset copy.
- **Design:** brand-kit export/import routes.

### The parity fix (systemic, not per-feature)
The frozen-verb invariant (#2) constrains **entities**, not how many existing ops the AI may propose. Replace the hardcoded 5-op enum with a **generated op-catalog** derived from `OP_CAPABILITY` + a per-op propose-schema, so every `read|propose`-safe op becomes proposable — still `validate → gate → Conductor`-executed, keeping single-writer + confirm-on-destructive intact. That single change lifts AI parity from ~3.6% toward ~90% and is the highest-leverage move for the phone-first "AI does it, I approve" thesis. In parallel, every "reachable via NEITHER" op above needs a UI entry point; wiring `copilot-propose` end-to-end covers the AI half of many at once.

---

## Appendix — Completeness critic (audit-of-de-audit)

Grounded against the actual `ControlOp` union (`src/workspaces/_functions/controlApi.ts`, ~130 ops) and the cluster list. Here is what the audit is missing.

# Gaps in the audit — run-next checklist

## A. Clusters named but with ZERO verified features (audit blind spots)
- [ ] **Pipeline & stages editor** — named cluster, but *no* verified item. The ops `stage-create`, `stage-delete`, `stage-reorder`, `save-stage-config`, `skill-toggle` are entirely unaudited. Verify the stage-graph CRUD, per-stage config/prompts, agent-role-per-stage, stage-lock/pause/resume, and reordering.
- [ ] **Modules, navigation, onboarding & i18n coverage** — named cluster, only "module gating" leaked in elsewhere. Unverified: **workspace creation** (`create-workspace` op absent from list!), first-run/onboarding flow, empty-workspace guided setup, nav module-gating end-to-end, and actual i18n string coverage (is every JSX string translated? RTL?).

## B. Control-ops in the registry NOT represented in verified list
- [ ] `create-workspace` — workspace creation / first-run (only rename/delete/transfer verified)
- [ ] `save-integration` / `remove-integration` — third-party integrations (distinct from env secrets, which only cover `save-env`; `remove-env` also unverified)
- [ ] `ui-review-create` — visual/UI review flow (`uiReviewCreate_server_v1.ts`) — completely absent
- [ ] `skill-toggle` — agent-skill registry enable/disable
- [ ] `scan-index` — manual RAG reindex trigger (distinct from `indexWorkspace`)
- [ ] `accept-suggestion` — accepting an AI suggestion (distinct from chat-plan accept)
- [ ] `content-import-asset` — bring an existing asset into a piece
- [ ] `content-reorder-beats`, `content-save-scenes` — the **timeline/scene editor** write path (only generation ops were verified)
- [ ] `content-decompose-video` — scene decomposition (distinct from reference-video analysis)
- [ ] `content-save-audio-mix` — **audio mixing** (voice gain / ducked music) — no audio-mix verification at all

## C. Cross-cutting concerns under-covered
- [ ] **Accessibility** — entirely absent. Keyboard nav, focus-trap in `MenuHandler` sheets, screen-reader labels, contrast (ironic given Designer has a contrast tool).
- [ ] **Mobile / phone-first** — the product's core premise is phone approvals, yet no responsive/mobile-viewport verification of board, approvals, chat, editor.
- [ ] **Offline / PWA depth** — only installability verified. Missing: service-worker update flow, offline queue/resync, push-while-offline delivery, stale-cache handling.
- [ ] **Empty / loading / error states** — verified only for chat. Board, content console, editor, settings, usage pages unaudited for the three non-happy states.
- [ ] **Tenant-isolation as a *test*, not a feature** — `runInTenant` is listed as a feature but never adversarially probed: cross-workspace leak attempts, `composeSanitize` bypass, leader-election / write-lock / cross-instance dedup under contention (ADR 0015).
- [ ] **Security surface** — no verification of: `preApiExecute` RBAC enforced on *every* op, control-API rate-limiting/idempotency abuse, SSRF from webhook/`emit-signal` actions, secret encryption-at-rest, PAT scope enforcement, egress sandboxing of agent containers, origin-exempt route hardening (build-download, forge webhook, invite-accept).
- [ ] **Error handling / failure paths** — media-budget **refund on failed generation**, partial-failure of `content-run-pipeline`, trigger/cron dead-letter + retry, provider-outage fallback (lesson 0011), `tryCatch` coverage on background workers.
- [ ] **Realtime correctness** — seq-merge ordering, reconnect resync, concurrent-edit conflict, optimistic-merge rollback (listed as "delta-merge" feature but not stress-verified).

## D. Whole feature-areas absent for a self-hosted build/manage platform
- [ ] **Media/blob storage lifecycle** — where generated assets live, storage quotas, orphaned-asset GC, retention. A media platform with no storage-management audit is a hole.
- [ ] **Backup / restore / disaster recovery** — of Prisma data + media blobs + bare repos. Export (H4) is not backup.
- [ ] **Operator / self-host plane** — install/first-boot, platform upgrades & schema migrations, superadmin console, health checks, version/license. (Distinct from per-workspace settings.)
- [ ] **Observability for the operator** — Sentry wiring, logs/metrics/traces, build/deploy/CI **log viewers** (only live terminals verified).
- [ ] **Container resource governance** — CPU/mem limits, orphan-container reaping, disk-pressure handling, idle-preview teardown.
- [ ] **Global search** — across tickets/content/code/knowledge. None present.
- [ ] **Ticket richness** — dependencies/subtasks/relations, attachments on tickets & comments, estimates, templates, intra-stage ordering.
- [ ] **Right-to-erasure / PII** — GDPR beyond export: deletion, PII-in-logs, redaction posture beyond push.
- [ ] **SSH / git-transport** — SSH key mgmt is hinted in account settings but repo-over-SSH auth path unverified.
- [ ] **Command palette / keyboard shortcuts** — expected in a power-user dev tool; absent.

**Highest-priority re-runs:** the two zero-verified clusters (A) — pipeline/stages editor and onboarding/workspace-creation/i18n — plus the timeline+audio-mix content ops (B) and the phone-first + accessibility + tenant-leak probes (C), since those touch the product's stated core invariants.
---

# Addendum — 3 re-scanned clusters (were StructuredOutput-failures in the main run)

> These three clusters hit the schema retry-cap in the main workflow and were re-run as free-form audits. **Coverage is now 21/21 clusters.** They add ~21 gaps, including **1 new critical** (German locale systemically mojibaked) and a **high-severity security leak** (internal `__`-namespaced secrets — provider API keys + OAuth token JSON — decrypted into the snapshot and shown in the Env tab, and secrets broadcast to every member regardless of capability). Net critical count is now **8** (the original 7 + German mojibake); the snapshot secret-leak is the top security item to fix alongside the redacted-push defect.

## Pipeline & stages editor

The per-stage **config editor** (the 10 tabs → `save-stage-config`) is genuinely end-to-end complete: UI Save → `syncRequest` → RBAC (`editPipeline`) → Conductor `updateMany` → realtime delta → client upsert, and every composite (commands/network/hooks/model/processes/skillKeys) is persisted (`conductor.ts:1698-1726`) and rendered into the real container run (`renderStage.ts:93-116`). **But the three structural controls are broken at the wiring layer**: `Add stage`, `Delete stage`, and the reorder arrows only mutate local React state — the fully-built, integration-tested server ops `stage-create` / `stage-delete` / `stage-reorder` are never called from any client code. So a user who adds, deletes, or reorders a stage loses that edit on the next snapshot/refresh, and "Save stage" on a freshly-added stage is a silent no-op (its React id is no DB `key`, so `updateMany` matches zero rows). The Workspace-AI cannot touch the pipeline (not in `validateChatAction`) — a defensible governance choice. i18n complete (124 identical `workspaces.pipeline.*` keys across en/nl/de/fr).

### Feature table
| Feature | Cmpl | UI | AI | UX | Evidence |
|---|---|---|---|---|---|
| Edit + save stage config (10 tabs) | complete (needs-live run) | yes | IE | clear | page.tsx:599,728; conductor.ts:1698-1726; renderStage.ts:93-116 |
| Add stage (`stage-create`) | partial — server done+tested, UI unwired | no (React state only) | no | confusing | page.tsx:614-619; conductor.ts:1729-1746 |
| Delete stage (`stage-delete`) | partial — server done+tested, UI unwired | no (React filter only) | no | confusing | page.tsx:621-626; conductor.ts:1748-1752 |
| Reorder stage (`stage-reorder`) | partial — server done+tested, UI unwired | no (arrows mutate state) | no | confusing | page.tsx:601-612; conductor.ts:1756-1760 |
| Toggle skill/context-doc (`skill-toggle`) | complete | yes (via Sources/Workspace page) | no | clear | provider:1038; conductor.ts:1693-1697 |
| Per-stage skillKeys (Context tab) | complete | yes | no | clear | page.tsx:126-145 |
| "Validate with AI" button | stub — no AI, local heuristics | yes | na | confusing | page.tsx:628-645 |
| RBAC gate (`editPipeline`) | complete | na | na | na | rbac.ts:145-149 |

### Confirmed gaps
- **[high][ui] Add stage never persists** — `addStage` only `setStages(...)`; never calls `stage-create`; vanishes on refresh; later `Save stage` silently no-ops. where: page.tsx:614-619; conductor.ts:1723,1729-1746 — fix: add `stageCreate` to Provider (`syncRequest workspaces/stageCreate {key,name,kind}`) + delta-upsert; `addStage` fires it (create-then-edit).
- **[high][ui] Delete stage never persists** — confirm dialog then only filters React state; `stage-delete` unreachable; stage returns on next snapshot. where: page.tsx:621-626 — fix: add `stageDelete` to Provider + refetch, call after confirm.
- **[high][ui] Reorder never persists** — `move()` reindexes React state only; `stage-reorder` never called; `save-stage-config` ignores `order`. where: page.tsx:601-612 — fix: add `stageReorder` to Provider (`{order: stageKeys}`) + refetch from `move`; add real drag.
- **[medium][ux] "Validate with AI" is not AI** — synchronous local heuristic, no model/server call; label misrepresents. where: page.tsx:628-645 — fix: rename "Check pipeline"/"Lint stages" or route through a real AI review op.
- **[low][ai] Workspace-AI cannot edit the pipeline** — not in `validateChatAction`. where: workspaceChat.ts:83-124 — fix: optional; if desired expose read-only pipeline advice or gated proposal.

### Bold UX / new-feature ideas
- Real **drag-and-drop reordering** (dnd-kit) with optimistic move + `stage-reorder` on drop.
- "Add stage" as a **template picker** (Refine/Plan/Code/Test/Review/Custom) → server-creates a preconfigured stage keyed off `kind`.
- Turn "Validate with AI" into a genuine **AI pipeline critique** (reuse `plan-critique`) flagging blind stages, missing DoD, over-broad write access.
- **"Unsaved structural changes" banner** so the silent-loss failure mode is visible until ops are wired.
- Per-stage **"drives the container as: …" preview** (rendered CLAUDE.md + append-system-prompt + allow/ask/deny) so a non-expert sees what their config produces.


## Env secrets & integrations

The write path is solid: all four ops (`save-env`, `remove-env`, `save-integration`, `remove-integration`) go UI → per-action `_sync` → `dispatchControlSync` (RBAC = `workspaceSettings`) → single-writer Conductor, secret values encrypted at rest via AES-256-GCM (`secretBox`, fail-closed). Reachable in settings UI, consumed downstream (env→containers via `resolveWorkspaceEnv`; integrations→agent `.mcp.json` with decrypted creds). AI cannot write env/integrations — correct intentional-exception; audit log never stores secret VALUES. **But the READ side leaks secrets:** `buildSnapshot` decrypts *every* secret env value and ships it to *every* member (membership-only gate, no capability check), and — unlike `serviceEnv.ts` which filters them — does NOT strip internal `__`-namespaced rows, so provider API keys (`__provider_key_*`) and OAuth token JSON (`__publish_*`) surface as revealable rows in the Env tab.

### Feature table
| Feature | Cmpl | UI | AI | UX | Evidence |
|---|---|---|---|---|---|
| save-env (encrypted at rest) | complete | yes | IE | unclear | saveEnv_server_v1.ts:20; conductor.ts:544-559,551; workspace/page.tsx:228-262; rbac.ts:69 |
| remove-env | complete | yes | IE | unclear | removeEnv_server_v1.ts:19; conductor.ts:561-566 |
| save-integration (MCP tool) | complete | yes | IE | clear | saveIntegration_server_v1.ts:22; conductor.ts:810-822; stageRunner.ts:179-196 |
| remove-integration | complete | yes | IE | clear | removeIntegration_server_v1.ts:19; conductor.ts:824-827 |
| Secret encryption at rest | complete | na | na | na | crypto/secretBox.ts:43-51 |
| Env injection into containers | complete | na | na | na | container/serviceEnv.ts:24-34,30 |
| Integration→MCP cred injection | complete | na | na | clear | stageRunner.ts:186-195 |
| Secret READ/display (snapshot decrypt) | partial | partial | na | confusing | workspaceSnapshot.ts:276,493; membership-only :236,252 |
| AI-triggered env write | missing (by design) | na | IE | na | ai/workspaceChat.ts:83-124 |

### Confirmed gaps
- **[high][ui/security] Internal `__`-namespaced secrets leak into the snapshot + render in the Env tab.** `resolveWorkspaceEnv` skips `key.startsWith('__')` (serviceEnv.ts:30) but the snapshot does NOT — workspaceSnapshot.ts:276 returns every row and :493 decrypts all. `__provider_key_*` (real API keys) + `__publish_*` (full OAuth token JSON) appear as revealable rows. where: server/read/workspaceSnapshot.ts:276,493 — fix: filter `!e.key.startsWith('__')` in the envVars map (and query where), mirroring serviceEnv.ts:30.
- **[medium][security] Decrypted secrets broadcast to every member regardless of capability.** Writes require `workspaceSettings` but the read snapshot decrypts all secret values (workspaceSnapshot.ts:493) and snapshot_v1.ts:20 gates only on `login`; buildSnapshot checks membership only. A workTickets-only member receives plaintext secrets. fix: mask secret rows in the snapshot (send value:'' when secret) + add an on-demand `reveal-env` read op gated on CAP.workspaceSettings.
- **[low][ux] Deleting a stored secret/integration has no confirm.** Trash button calls removeEnvVar/removeIntegrationTool immediately; neither in CONFIRM_REQUIRED (controlApi.ts:138-140); irreversible. fix: add to confirm set or wrap in menuHandler.confirm.
- **[low][ui/ux] Forbidden writes fail silently for non-settings members.** Env/Integrations tabs always shown; saveEnvVar/removeEnvVar are fire-and-forget void syncRequest with no error surfacing; a member lacking workspaceSettings can edit fields but sync returns auth.forbidden silently. fix: hide settings tabs when role lacks workspaceSettings + surface the sync error.
- **[low][security] No rate-limit on the four env/integration `_sync` routes.** fix: add a sensible rateLimit to the settings write syncs.

### Bold UX / new-feature ideas
- **On-demand reveal instead of eager decrypt** — ship secrets masked; a `reveal-env` op decrypts one value on click, gated on workspaceSettings + written to the audit log (access trail for "who viewed the API key").
- **A distinct "Connected integrations / accounts" surface** reading `__publish_*` / `__provider_key_*` as friendly connection cards (connected/disconnected + rotate) so internal creds are managed deliberately, not leaked raw or invisible.
- **Secret-type + validation hints per field** (URL/token/JSON kind → validate on save, mask/format), plus inline "toggle secret" on existing rows (today secret↔plaintext requires delete+re-add).
- **"Where is this used?" backlink** per env var (which integrations via field.envVarId + services consume it) before allowing delete.


## Modules, navigation, onboarding & i18n

A low-knowledge user can navigate the app **only partially** — the answer diverges sharply by language and device. Structure is genuinely good: workspace creation forces a module choice with explained cards (`ModulePicker`), module→section gating hides irrelevant nav, a grouped nav rail + ⌘K palette + an ever-present Workspace-AI (product-knowledge RAG) give real discovery, and a redirect guard stops landing on a gated blank page. But four verified defects undercut the goal: (1) the **entire primary navigation is hardcoded English** in *all* locales; (2) the **German locale is systemically mojibaked** (~416 broken umlauts); (3) **Designer & Scheduled are largely untranslated in de/fr**, and de/fr **miss 9 board keys**; (4) **mobile is degraded** (dead FAB, dead workspace-switcher, near-empty bottom bar for Content/Design). So: low-knowledge English desktop → yes; non-English or mobile → only partially.

### Feature table
| Feature | Cmpl | UI | AI | UX | Evidence |
|---|---|---|---|---|---|
| Workspace create + module choice | complete | yes | partial | clear | Shell.tsx:320-344; ModulePicker.tsx:11-32 |
| Zero-workspace onboarding | complete | yes | na | clear | Onboarding.tsx:16-67; WorkspacesShell.tsx:66 |
| Module/section nav gating | complete | yes | no | clear | modules.ts:28-67; Shell.tsx:131; WorkspacesShell.tsx:45-50 |
| Post-create section toggles | complete | yes | no | clear | workspace/page.tsx:712-746 |
| Desktop nav rail + groups | complete | yes | na | unclear (i18n) | labels hardcoded Shell.tsx:56-75,104,136 |
| Mobile bottom bar | partial | partial | na | confusing | Shell.tsx:735-751; FAB noop WorkspacesShell.tsx:23,102 |
| Mobile drawer + header | partial | partial | na | confusing | MobileChrome.tsx:50-53; workspace btn no onClick :31-34 |
| ⌘K search/command palette | partial | yes | na | unclear | SearchPalette.tsx:85-94 (dev-biased) |
| Workspace-AI explain "what's possible" | complete | yes | yes | clear | aiChat_v1.ts; workspaceChat.ts:46-61,143-150 |
| Workspace-AI trigger/navigate | partial | yes | partial | clear | no navigate op WorkspacesProvider.tsx:844-851 |
| Studio/brand reachability (Design module) | partial | partial | partial | unclear | Studio only via marketing (Content-gated) modules.ts:30-31 |
| Global i18n coverage | partial | na | na | confusing | see below |

### Confirmed gaps
- **[critical][ux/i18n] German locale systemically mojibaked** — ~416 double-encoded umlauts app-wide (de.json:4 "spÃ¤ter", :8 "PrÃ¼fe", :9 "GerÃ¤t geÃ¶ffnet"). fix: re-save de.json as proper UTF-8 (repair Ã¼/Ã¶/Ã¤→ü/ö/ä).
- **[high][i18n/ui] Entire primary navigation is English-only in every locale** — rail labels, group headers, mobile drawer + bottom bar rendered without translate; no workspaces.nav.* keys exist. where: Shell.tsx:56-75,104,136,751; MobileChrome.tsx:50-53 — fix: add workspaces.nav.<id> + workspaces.navGroup.<g> keys to all 4 locales, translate at render.
- **[high][ux/i18n] Dutch mojibake incl. the create-workspace subtitle** — ~23 spots: nl.json:741 "EÃ©n project, Ã©Ã©n workspace â…", :347/:387/:698. fix: repair Ã©→é, Ã¯→ï, â→—.
- **[high][i18n] de/fr miss 9 board keys** (New-ticket modal + filters): newTicketTitle, newTicketTitlePlaceholder, newTicketStage, allSprints, filterStatus, filterAssignee, allStatuses, allAssignees, clearFilters (page.tsx:222-239,257-290). fix: add the 9 keys to de.json/fr.json.
- **[medium][i18n] Designer + Scheduled largely untranslated in de/fr** — de: 47 Designer + 19 Scheduled English; fr: 58 + 22. fix: translate workspaces.designer.* + workspaces.scheduled.* for de/fr.
- **[medium][ui] Mobile bottom bar collapses to one button for Content/Design + dead FAB** — board/terminals/activity are Development-gated; center "+" wired to noop. where: Shell.tsx:735-740; WorkspacesShell.tsx:23,102 — fix: seed bottom bar from enabled sections (module-aware); implement or remove FAB.
- **[medium][ui] Mobile workspace button dead → no switch/settings on phone** — caret but no onClick; workspace-settings not in drawer. where: MobileChrome.tsx:31-34,50 — fix: wire to a switcher sheet + add settings to drawer.
- **[medium][ux] Mobile drawer ignores module gating** — renders all NAV_ITEMS unfiltered; gated taps bounce via redirect. where: MobileChrome.tsx:50 — fix: apply isSectionEnabled filter (as Shell.tsx:131).
- **[medium][ux] ⌘K palette dev-biased + module-unaware** — hardcoded Board/Backlog/Terminals/Pipeline/Sources/Usage; no Content/Designer/Marketing/Scheduled. where: SearchPalette.tsx:85-94 — fix: build actions from enabled NAV_ITEMS.
- **[low][ui] Design-only workspace cannot reach Studio/brand** — Studio only via marketing (Content); Design = ['designer','interviewer']. fix: expose a Studio/brand section under Design.
- **[low][ai] Workspace-AI can explain but not navigate/toggle modules** — no navigate op (frozen surface). acceptable per invariant #2; add a text-level "open Settings → Modules" hint.

### i18n coverage
- **en**: 1604 keys, clean (reference). **nl**: complete keys, well-translated, but real mojibake on é/ï + broken em-dash (incl. create-workspace subtitle nl.json:741). **de**: 9 keys missing (board), 72 English-leaked (Designer 47 + Scheduled 19), 416 broken umlauts — worst locale. **fr**: 9 keys missing, 87 English-leaked (Designer 58 + Scheduled 22), encoding clean. **All locales**: primary nav has NO translation keys.

### Bold UX / new-feature ideas
- **First-run guided tour** keyed off chosen modules: AI panel auto-opens with a 3-step "here's your Board / how the pipeline drives a ticket / where to approve" walkthrough.
- **"Take me there" AI action**: a read-only navigate/focus-section proposal so "use the Marketing module" actually routes there (no write verb).
- **Module-aware, translated command palette + bottom bar** generated from enabled NAV_ITEMS (⌘K + phone bar reflect this workspace, in the user's language).
- **A locale-lint CI gate** (missing-key + mojibake + identical-to-en ratio) wired into ai:lint — would have caught all four i18n defects.
- **Per-module "what can I do here?" empty states** naming concrete actions + the AI shortcut.
