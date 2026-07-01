# SELF_HOST_INSTALLER — the one-command self-host stack (compose + first-run bootstrap)

> **The missing front door.** Every other ops doc assumes the stack is *already up*: [08_DEPLOYMENT.md] describes how the two systems run and stay alive, [07b_CONTAINER_RUNTIME.md] describes what a ticket container *is*, [DR_RUNBOOK.md] describes how to restore one, and [SETUP_AND_PREREQUISITES.md] enumerates the non-code things a human must provide. **None of them ships a way to actually bring the whole thing up.** For a product whose entire threat model is "trusted small-group, **self-hosted**" (B-26), the install path is not a nicety — it is the product surface. This doc is the **one-command stack** (a `docker compose` profile bringing up every service on the `workspaces-net` bridge) plus the **first-run bootstrap script** (first workspace+owner, VAPID keys, the managed Claude-token projection login, DNS/TLS prompts) and the **upgrade path**. It is the operator-facing companion to [08_DEPLOYMENT.md] (run model), [07b] (container facts the compose realizes), [FORGE_ABSTRACTION.md] (the built-in git server + CI that the *full* profile adds), and [MIGRATION.md] (the code-level fresh-repo port — this doc assumes the built+installed image MIGRATION produces). Cites architecture as `[01 §x]`…`[07 §x]` / `[07b §x]` / `[08_DEPLOYMENT §x]` / `[DR_RUNBOOK §x]` / `[FORGE_ABSTRACTION §x]` / `[CONTROL_API]` / `[04b §x]`; codes via [REFERENCE_CODES]. Carries **Q-INSTALL-\***. Last updated: 2026-06-04.
>
> **No new verbs.** Installation is pure infra/operator bring-up — compose services + a first-run script + a managed-token login. Nothing here adds, renames, or relaxes a structured-channel verb. The frozen surface ([02 §2]: 7 worker + 6 assistant, all `read|propose`, none write) is untouched; the first-run script's only *writes* (seed the first workspace+owner) go through the same path everything else does — a `[control-API]` Conductor action (B-23), here run head-less by the bootstrap as the seed step ([MIGRATION §5]), never an LLM verb and never a write path around the Conductor.
>
> **This doc edits no existing file.** It is the new install backbone the README / quick-start cites as `[SELF_HOST_INSTALLER §N]`.

---

## 0. One-paragraph summary

A self-hosted Workspaces install is **one `docker compose up` against a single `.env` plus one interactive `bootstrap.sh` run**. Compose brings up every service on the user-defined **`workspaces-net`** bridge ([07b §5], the same bridge ticket containers join so Caddy can dial by DNS name): the **single supervised orchestrator** (`restart: unless-stopped`, the only writer, acquires `lease:orchestrator` on boot — [08_DEPLOYMENT §2]), **N web-app replicas** behind the `app.` Caddy pool ([08_DEPLOYMENT §1]), **MongoDB (Atlas Local)** for `$vectorSearch` RAG ([SETUP §3], G10), **Redis** (lease + adapter + `seq` + queue), **Caddy** as the TLS edge driven by its admin API ([07b §5.3], B-11), the **host egress forward-proxy** that every ticket container's traffic is forced through ([07b §6], Q-CT-EGRESS), and — **only in the full profile** ([FORGE_ABSTRACTION §7/§8]) — the **built-in git server + CI**, which the **minimal profile skips** because external-forge mode (GitLab today / GitHub later) uses the forge's own repo hosting and pipelines. The **bootstrap script** runs *once* against the up stack: it does the host **`claude login`** that the managed-token-projection auth depends on ([07b §2], the load-bearing billing decision [01 §1]), generates **VAPID** keys (web-push, B-34), prompts for the **DNS/TLS** track ([07b §5.4]), and seeds the **first workspace + owner** ([MIGRATION §5]). Upgrades are **pull a new image tag → compose up → the orchestrator's boot reconcile + `resumeAll()` heals state** ([08_DEPLOYMENT §2.2]); the data tier is backed up/restored per [DR_RUNBOOK]. **Recommendation: ship `docker compose` as the v1 installer** (every prereq is already a container per [07b]); a Kubernetes/Helm path is a documented future (`Q-INSTALL-ORCH`).

---

## 1. The two install artifacts (and the boundary between them)

A complete install is exactly two operator artifacts. Keeping them separate is the whole design — compose is **declarative and idempotent** (re-run safe), the bootstrap is **imperative and once-only** (it logs in, mints keys, seeds a tenant). Conflating them (a compose that "logs in on boot") would re-run the once-only steps on every restart and break the managed-token single-login invariant ([07b §2.2]).

| Artifact | Form | Idempotent? | What it does | Cites |
|---|---|---|---|---|
| **`docker-compose.yml` + `.env`** | declarative stack on `workspaces-net` | **yes** — `compose up` re-converges; the orchestrator's boot reconcile heals drift | stands up all long-running services (§3); the orchestrator/web-app **run model** is [08_DEPLOYMENT]'s, realized here as compose units | [08_DEPLOYMENT §1/§2], [07b §5/§6] |
| **`bootstrap.sh` (first-run)** | interactive script, run ONCE post-`up` | **no** — guarded by a `bootstrapped` marker (§5.6); re-running is a no-op + a warning | host `claude login`, VAPID keygen, DNS/TLS prompt, seed first workspace+owner | [07b §2], [MIGRATION §5], B-34 |

**Boundary rule (`Q-INSTALL-BOOTSTRAP-SPLIT`, default below):** anything that must hold *one* value for the life of the install (the host Claude login, the VAPID keypair, the first owner) lives in **bootstrap**; anything that must hold *whenever a container is running* (the services, their wiring, the bridge, the proxy) lives in **compose**. The orchestrator container's *own* boot sequence ([08_DEPLOYMENT §2.2]) is neither — it is image code the orchestrator runs each start; compose only supervises it (`restart: unless-stopped`) and bootstrap only seeds the data it reconciles against.

---

## 2. Prerequisites the operator brings (everything else is in the stack)

[SETUP_AND_PREREQUISITES.md] is the exhaustive list; this section is the **install-time subset** — the few host-level things compose cannot containerize.

| Prereq | Why it can't be in compose | Cite |
|---|---|---|
| **Docker engine + the daemon socket** | the orchestrator container drives the **Docker API** to launch ticket containers ([07b §1.3]); on Windows 11 this is **Docker Desktop + WSL2** ([01 §7], [SETUP §2]). The orchestrator mounts the daemon socket (§3.1 caveat). | [SETUP §2], Q-NET-DOCKER |
| **A Max-subscription Claude account** | the host `claude login` the managed-token projection rests on ([07b §2.2]) is **interactive** and account-bound — bootstrap runs it, but the *account* is the operator's. **`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`apiKeyHelper` MUST be unset** or sessions bill API credits not the subscription ([01 §1], [SETUP §1]). | [01 §1], [07b §2] |
| **A wildcard DNS record + (public track) a scoped DNS-provider token** | ACME **DNS-01** issues `*.<domain>` for the dynamic per-ticket `dev-<id>.` subdomains ([07b §5.4], Q-NET-TLS); the token is a secret the operator holds. The LAN/air-gapped track skips this (internal CA). | [07b §5.4], Q-NET-TLS |
| **Host with the reference budget** | the CapacityManager is sized to a **reference host 8 vCPU / 32 GB / NVMe** ([07b §8.1]); compose can't manufacture RAM. The minimal profile (chat-only PoC) runs far lighter. | [07b §8] |

Everything else — Mongo, Redis, Caddy, the egress proxy, the base ticket image, and (full profile) the git server + CI — is **a container in the stack**, which is exactly why `docker compose` is the right installer granularity (§7).

---

## 3. The compose stack — services on `workspaces-net`

One user-defined bridge, **`workspaces-net`** ([07b §5.1]), is the spine: every service here joins it, and so does every *ticket* container the orchestrator later launches, so Caddy resolves both by Docker-embedded DNS name with **no host port publishing** ([07b §5.2]). The boot-order dependency graph ([08_DEPLOYMENT §3]) is encoded as compose `depends_on` + healthchecks: **stores → docker+bridge+proxy → Caddy → the two tiers → (runtime) ticket containers**.

### 3.1 Service inventory

| Service | Image | Profile | `restart` | Role / cite |
|---|---|---|---|---|
| **`orchestrator`** | `workspaces/orchestrator:<tag>` | both | `unless-stopped` | The **single supervised writer** ([08_DEPLOYMENT §2]). `restart: unless-stopped` **is** its supervisor; on boot it acquires `lease:orchestrator` → Caddy reconcile → `resumeAll()` → leased workers ([08_DEPLOYMENT §2.2]). Joins `workspaces-net`; **mounts the Docker daemon socket** (it launches ticket containers, [07b §1.3]) and the **host `~/.claude`-derived projected auth dir** (read by the one refresh loop, [07b §2.2]). **Never** replicated (G16). |
| **`web-app`** | `workspaces/web-app:<tag>` | both | `unless-stopped` | **N stateless replicas** ([08_DEPLOYMENT §1]); compose `deploy.replicas: N` (≥2 for HA, 1 acceptable for the minimal PoC). Truth in Mongo+Redis; the **Redis socket adapter** fans room broadcasts across replicas. `/readyz` gates `app.` pool membership; `/healthz` gates restart. **No host-bound state** — no Docker socket, no PTY, no worktrees. |
| **`mongo`** | `mongodb/mongodb-atlas-local:<pin>` | both | `unless-stopped` | **Atlas Local** — required for `$vectorSearch` RAG; a vanilla `rs0` does **not** serve it (G10, B-24, [SETUP §3]). Volume-backed; the search indexes are **rebuilt on orchestrator boot** (`createSearchIndexes`), not stored ([DR_RUNBOOK §4a]). |
| **`redis`** | `redis:<pin>` | both | `unless-stopped` | lease (G8/G16) + socket adapter + per-ticket `seq` `INCR` (G2) + bullmq queue (G1) + presence (G13). **AOF `appendfsync everysec`** on for the ≤1 s RPO ([DR_RUNBOOK §5]). Volume-backed. |
| **`caddy`** | `caddy:<pin>` (with the DNS-provider plugin on the public track) | both | `unless-stopped` | the TLS edge ([07b §5.3/§5.4], B-11). The orchestrator drives its **admin API** to POST/DELETE `dev-<id>` routes by `@id` ([07b §5.3]); `app.` is the only LB pool, `term.`/`dev-` are single-upstream (G16). Admin API reachable only on `workspaces-net` (not host-published, §6). |
| **`egress-proxy`** | `workspaces/egress-proxy:<tag>` (squid/mitmproxy) | both | `unless-stopped` | the **host forward-proxy** every ticket container's `HTTP(S)_PROXY` points at; enforces each stage's domain allow-list and blocks token exfil ([07b §6], Q-CT-EGRESS). The bridge has **no direct external route** except via this proxy. |
| **`git-server`** | `workspaces/git-server:<tag>` | **full only** | `unless-stopped` | **built-in forge** repo hosting ([FORGE_ABSTRACTION §7.1]). **Skipped in minimal** (external GitLab/GitHub owns the repo). See §4 + `Q-INSTALL-GITHOST`. |
| **`ci-runner`** | (none — reuses `orchestrator`) | **full only** | n/a | built-in CI is **not a separate service** — a pipeline = a sequence of container jobs the **orchestrator** runs on [07b] under the same lease ([FORGE_ABSTRACTION §8]). The full profile only *enables* it (a flag); it adds **no new long-running container** (Rule 7b). External-runner (Woodpecker/Drone/forge-native) is the pluggable alt, pointed at by config, not stood up by this compose. |
| **`embeddings`** | `workspaces/embeddings:<tag>` (nomic/BGE/jina-code) | both (P2+) | `unless-stopped` | self-hosted RAG embeddings — no cloud embedding cost (B-18, [SETUP §3]). Allow-listed on the egress proxy. Omit until RAG is built (P2). |

> **Ticket containers are NOT in the compose file.** They are launched *at runtime* by the orchestrator via the Docker API ([07b §1.3], [07 §A] step 6), joined to `workspaces-net`, hardened per [07b §7], and torn down at ticket end. Compose stands up the **infrastructure they run on**, never the disposable units themselves. The L1 base image ([07b §1.1]) is built/pulled by the operator (§5.5), referenced by the orchestrator, not a compose service.

### 3.2 The `depends_on` / health ordering (mirrors [08_DEPLOYMENT §3])

```
mongo (healthy) ─┐
redis (healthy) ─┴─▶ egress-proxy ─▶ caddy ─┬─▶ web-app   (joins app. pool on /readyz=200)
                                            └─▶ orchestrator (acquireLease → reconcile → resumeAll)
                                                     │  (full profile)
                                                     └─▶ git-server
```

- **Stores first.** `web-app /readyz` and the orchestrator boot **both block on Mongo+Redis reachability** ([08_DEPLOYMENT §3]); compose `depends_on: { condition: service_healthy }` enforces it.
- **Egress proxy + bridge before the orchestrator** — ticket containers route egress only through the proxy ([07b §6]); the orchestrator dials the Docker API and joins the bridge.
- **Caddy tolerates absent upstreams** — it health-checks the `app.` pool and `dev-` routes are added at runtime, so Caddy starting before the tiers is fine ([08_DEPLOYMENT §3]).
- **The two tiers are mutually independent at boot** — the web-app does not wait on the orchestrator and vice-versa; only *agent execution* depends on the orchestrator (the SPOF, [08_DEPLOYMENT §4]).

**No new verbs.** Compose is process/infra topology; it spawns the surfaces [08]/[07b] already specify.

---

## 4. Minimal vs full profile — what the forge mode toggles

The single biggest install fork is **forge mode** ([FORGE_ABSTRACTION §6], per-workspace but install-shaped here because the built-in services are stack-level). Compose **profiles** (`--profile minimal` / `--profile full`) gate the forge services. The default workspace's `forgeMode` ([FORGE_ABSTRACTION §6]) and the profile **should agree** — bootstrap sets both from one prompt (§5.4).

| | **Minimal profile** (`--profile minimal`) | **Full profile** (`--profile full`) |
|---|---|---|
| **Forge mode** | external — `gitlab` (today) / `github` (future); the forge owns repo + MR + CI ([FORGE_ABSTRACTION §5/§9]) | **built-in** — Workspaces owns repo + MR + CI ([FORGE_ABSTRACTION §7/§8]) |
| **`git-server`** | **skipped** — repo is the external forge's | **up** — a lightweight **git-server container** (Gitea-core / Soft Serve) on `workspaces-net` ([FORGE_ABSTRACTION §7.1] DECISION 2026-06-04 = option B; the orchestrator keeps the write lease so merges stay serial) |
| **Built-in CI** | **off** — CI is the forge's native pipeline (GitLab CI / GitHub Actions, [FORGE_ABSTRACTION §8]) | **on** — pipeline = container jobs on the orchestrator ([FORGE_ABSTRACTION §8]); external-runner is the pluggable alt |
| **Webhook ingest** | Caddy origin-exempt `/hooks/<forge>` route up ([07 §C], G6/G7) | in-process git hooks; no inbound HTTP webhook needed ([FORGE_ABSTRACTION §7.2]) |
| **Source-of-truth** | `forge` (B-29) | `workspaces` ([FORGE_ABSTRACTION §4]) |
| **Best for** | a team putting Workspaces **on top of** an existing GitLab/GitHub project (stays first-class) | a team that wants **no external forge** — the all-in-one |
| **Host budget** | lighter | heavier (git server + CI job containers draw the **same shared CapacityManager budget**, [07b §8.2] — not a separate ceiling) |

**Both profiles share** the orchestrator, web-app, Mongo, Redis, Caddy, and the egress proxy — the forge mode swaps only *which adapter the Conductor calls* ([FORGE_ABSTRACTION §1]), and at the stack level whether `git-server` is up. **The minimal profile is the recommended starting point** (`Q-INSTALL-PROFILE-DEFAULT`): most v1 teams already have a GitLab project (B-29), and built-in mode is the opt-in all-in-one, not the default.

**No new verbs.** Profiles toggle which forge *adapter/service* is present; every forge write stays a `[control-API]` → Conductor action ([FORGE_ABSTRACTION §12]).

---

## 5. The first-run bootstrap script (once-only)

`bootstrap.sh` runs **after** `compose up` reports the stores + orchestrator healthy. It is **imperative and idempotent-guarded** (§5.6): each step is skipped if already done. It performs the four once-only setup acts compose deliberately does not (§1).

### 5.1 Host `claude login` → projected-auth dir (`Q-INSTALL-AUTH-LOGIN`)

The load-bearing step. The managed-token-projection auth ([07b §2]) requires a **single host login** whose token the orchestrator's one refresh loop owns and re-projects RO into each container:

1. Bootstrap runs **`claude login`** interactively on the host, with `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`apiKeyHelper` **asserted unset** (it aborts with an explicit error if any is set — subscription-billing guard, [01 §1]).
2. It **normalizes** the result into the orchestrator-owned auth dir (on macOS: **export from the login Keychain**, service `claude-code`, since the token is not in `~/.credentials.json` there — [07b §2.1] mode 1; on Linux: read `~/.claude/.credentials.json`).
3. That dir is the volume the `orchestrator` service mounts; the orchestrator's refresh loop projects RO `.credentials.json` + a minimal `.claude.json` into each ticket container's `CLAUDE_CONFIG_DIR` ([07b §2.2]). **Bootstrap never touches a container** — it only establishes the host login the orchestrator projects from.
4. **Gate:** the **P0.5 / P2 auth spike** ([07b §2.6], Q-CT-AUTH/Q-ENG-SPIKE) must have passed for the pinned CLI version before a real install relies on container billing; bootstrap prints the spike's pass/fail expectation and the pinned CLI version ([07b §1.1], Q-CT-CLIPIN) so a mismatch is caught at install, not at first turn.

### 5.2 VAPID keys (web-push, B-34)

Generate a **VAPID keypair** for PWA web-push notifications (needs-input / merge / AI-suggestion / container-failure triggers, B-34) and write the public/private pair into the stack secret store (§6) — `web-app` reads the public key for the service-worker subscription, the orchestrator signs pushes with the private key. **Push bodies are REDACTED by default** with full body in-app behind auth (B-34, Q-SEC-NOTIF-PUSH) — bootstrap sets the redaction default, not full-body opt-in.

### 5.3 Email adapter (optional)

Prompt for `RESEND_API_KEY` **or** `SMTP_*` (B-34, `@luckystack/email`); if neither, email falls to **console-only** (a valid PoC state, [SETUP §7]) — bootstrap records which and warns that email notifications are disabled until configured.

### 5.4 DNS / TLS track + forge mode (`Q-INSTALL-DNS-PROMPT`)

One combined prompt sets the two install-shaping choices:

- **TLS track** ([07b §5.4], Q-NET-TLS): **PUBLIC** (ACME **DNS-01 wildcard** for `*.<domain>` — operator supplies the DNS record + scoped DNS-provider token, which bootstrap writes to the Caddy env) **or** **LAN/air-gapped** (Caddy **internal CA** + a note to point local DNS `*.<domain>` at the host). DNS-01 (not HTTP-01) because per-ticket subdomains are dynamic ([07b §5.4]).
- **Forge mode** (§4): external (minimal profile) — prompt for the GitLab base URL + per-workspace token (B-07, stored encrypted, [FORGE_ABSTRACTION §6]) and the webhook secret; or built-in (full profile) — print the clone URL to add as a remote. Bootstrap asserts the chosen mode matches the compose profile that was brought up and errors loudly on mismatch (e.g. built-in mode but `git-server` not running).

### 5.5 Base image build/pull

Build or pull the **L1 base image** (`node:22-bookworm-slim`: node-pty + glibc DB clients + the **exact-pinned** Claude CLI + the pty-agent, [07b §1.1]) and stamp its `org.workspaces.cli-version` / `org.workspaces.base-semver` labels into the orchestrator's expected-image config. **Single local daemon in v1; a registry is P4** ([07b §1.1], Q-CT-DOCKERFILE-TRUST). Per-project L2 images are built lazily by the orchestrator at activation ([07b §1.2]), not by bootstrap.

### 5.6 Seed first workspace + owner (and the idempotency marker)

The only **data** write bootstrap performs: seed the **first workspace + owner account** from the prototype's constant shapes ([MIGRATION §5] — `seed.ts` becomes the Prisma seed script: workspace, project, the 7-stage pipeline, the owner member). This is a **`[control-API]` Conductor action run head-less by the bootstrap** ([CONTROL_API §9] user-direct creation path), **not** an LLM write and **not** a bypass of the Conductor (B-23). On completion it writes a **`bootstrapped` marker** (a Mongo doc / a Redis key under the tenant prefix); re-running `bootstrap.sh` reads the marker, skips every step, and prints "already bootstrapped — nothing to do."

**Bootstrap correct when:** host `claude login` normalized into the orchestrator-owned auth dir with the API-key guard asserted; VAPID pair minted (redacted-push default); DNS/TLS track + forge mode chosen and matched to the profile; L1 base image present + CLI-pin stamped; first workspace+owner seeded via the Conductor; `bootstrapped` marker set. **No new verbs** anywhere in the script.

---

## 6. Secrets at install time

Install-time secrets follow the running-system posture ([07b §6.3], Q-SEC-CREDLIFETIME) so the install doesn't open a hole the runtime closes:

- **The `.env` holds only non-secret config + pointers** (`DNS`, `PROJECT_NAME`, `SERVER_IP`, replica count, the chosen profile/forge mode). **Real secrets** (the DNS-provider token, the per-workspace forge token (B-07), the VAPID private key, DB credential pairs) go into a **stack secret store** (compose `secrets:` / a mounted secrets dir), **never** the committed `.env` and **never** `--env` on a container command line (so they don't appear in `docker inspect`, [07b §6.3]).
- **Per-ticket container creds** are injected at runtime by the orchestrator via a **tmpfs env-file**, `denyRead` from the Bash tool ([07b §6.3]) — bootstrap establishes the *encrypted-at-rest* credential pairs (B-O8 ro/rw tiers), the orchestrator decrypts only at container boot. Bootstrap never bakes a credential into an image.
- **Caddy admin API + Redis + Mongo are reachable only on `workspaces-net`**, not host-published — the bridge is the trust boundary. Only `app.`/`term.`/`dev-*.<domain>` are exposed, through Caddy's TLS edge.
- **`@luckystack/secrets`** is the **P4 upgrade** ([07b §6.3], Q-SEC-SECRETS-PKG / project secrets-package design): v1 install uses app-owned encryption + the stack secret store; a future per-workspace mint narrows the token blast radius further.

**No new verbs.** Secret handling is orchestrator/host infra; the agent reaches DBs/integrations through CLI clients (B-O8), never a verb.

---

## 7. Why `docker compose` is the v1 installer (`Q-INSTALL-ORCH`)

Every Workspaces prerequisite is **already a container** ([07b]): the orchestrator is a container on `workspaces-net` (Q-NET-DOCKER), the ticket runtime is Docker, the stores/proxy/edge are containers. The install granularity that matches that reality is **`docker compose`**:

- **It is the smallest thing that expresses the dependency graph** ([08_DEPLOYMENT §3]) — `depends_on` + healthchecks encode stores→proxy→edge→tiers directly.
- **It reuses the exact bridge the runtime needs** — `workspaces-net` is a compose network; ticket containers the orchestrator launches join the *same* compose-created bridge ([07b §5.1]), so dial-by-name works with zero extra wiring.
- **`restart: unless-stopped` IS the supervisor** [08_DEPLOYMENT §2.1] calls for — no separate systemd/k8s needed for v1.
- **It is a single artifact a stranger can read** — matching the external-installer-first north-star (a stranger installs + configures without forking).

**Recommendation: `docker compose` for v1; document a Kubernetes/Helm path as a future option** (`Q-INSTALL-ORCH`). The single-instance orchestrator (G16, never replicated) maps awkwardly onto k8s Deployments (it wants a 1-replica StatefulSet + the lease as the real guard), and the Docker-socket-mount + host-bound state ([08_DEPLOYMENT §0]) are anti-patterns there — so k8s is a real future for the *web-app tier scaling* but not a v1 need given the trusted-small-group scale (B-26). Options weighed in §10.

---

## 8. Upgrade & migration path

An upgrade is **declarative on the stack, self-healing on the orchestrator** — it leans entirely on [08_DEPLOYMENT §2.2]'s boot reconcile so there is no bespoke upgrade dance:

1. **Back up first** ([DR_RUNBOOK §4/§5]) — the Mongo dump + Redis AOF are the rollback floor; the append-only event-log is restore-priority-1 ([DR_RUNBOOK §6]). **Never upgrade an un-backed-up production stack.**
2. **Pull the new image tag(s)** (`workspaces/orchestrator:<new>`, `workspaces/web-app:<new>`) and bump them in `.env`/compose. **Web-app first, rolling** — replicas are stateless and fungible ([08_DEPLOYMENT §1]); the `app.` pool drops a draining replica and adds the new one on `/readyz`.
3. **Recreate the orchestrator** — on `compose up` it restarts, **re-acquires `lease:orchestrator`**, runs the **Caddy↔state reconcile** and **`resumeAll()`** ([08_DEPLOYMENT §2.2]): surviving ticket containers (`--restart unless-stopped`) are **re-attached, not re-launched**, so an upgrade costs reconnect + ring-buffer replay, not re-provisioning. Graceful `SIGTERM` releases the lease so the new process acquires immediately ([08_DEPLOYMENT §2.2]).
4. **Schema migrations** are Prisma migrations shipped *in* the new image and run by the orchestrator on boot **before** it accepts work (it blocks on `/readyz`/`verifyBootstrap`); the code-level fresh-repo port + schema-evolution rules live in [MIGRATION] — this doc only sequences *when* (between step 2 and `resumeAll`).
5. **CLI-version upgrades gate behind an L1 base semver bump + the `--resume`/billing smoke test** ([07b §10], Q-CT-CLIPIN) — **never an unattended `@latest`**; the new L1 tag is pulled (§5.5) and the orchestrator's expected-image config bumped as part of the upgrade.
6. **Rollback** = re-pin the previous image tags + `compose up`; if a schema migration ran, restore from the step-1 backup ([DR_RUNBOOK §9]) — forward-only migrations make the backup the rollback path, by design.

**Recommendation (`Q-INSTALL-UPGRADE-COORD`): pin every service to an explicit tag (never `:latest`) and bump tags as a set per release**, so an upgrade is reproducible and a rollback is a one-line re-pin. Floating tags would make `resumeAll()` re-attach against an unpredictable image — exactly the non-reproducibility the audit log (B-36) exists to prevent.

**No new verbs.** Upgrade is image-tag + compose-recreate; the boot reconcile is deterministic Conductor/host code ([08_DEPLOYMENT §2.2], B-23).

---

## 9. Install checklist — the stack is correctly installed when…

- [ ] **One `docker compose up`** (with `--profile minimal` or `--profile full`) brings every service up on **`workspaces-net`** with the [08_DEPLOYMENT §3] `depends_on`/health ordering (stores→proxy→edge→tiers). (§3)
- [ ] **Orchestrator** is a single `unless-stopped` container that mounts the Docker socket + the projected-auth dir and, on boot, acquires `lease:orchestrator` → Caddy reconcile → `resumeAll()` ([08_DEPLOYMENT §2.2]); **never replicated** (G16). (§3.1)
- [ ] **Web-app** is `N` stateless replicas behind the `app.` Caddy pool with the Redis adapter attached; `/readyz` gates pool membership ([08_DEPLOYMENT §1]). (§3.1)
- [ ] **Mongo Atlas Local + Redis (AOF everysec)** are volume-backed; search indexes rebuild on orchestrator boot ([DR_RUNBOOK §4a]). (§3.1)
- [ ] **Caddy** edge driven by its admin API on the bridge; DNS-01 wildcard (public) or internal CA (LAN) per the bootstrap prompt ([07b §5.4]). (§3.1, §5.4)
- [ ] **Egress forward-proxy** up; the bridge has no direct external route except through it ([07b §6]). (§3.1)
- [ ] **Minimal profile** skips `git-server`/built-in-CI and uses the external forge; **full profile** runs the built-in git server + container-job CI, matching the workspace `forgeMode` ([FORGE_ABSTRACTION §6/§7/§8]). (§4)
- [ ] **Bootstrap (once)**: host `claude login` normalized into the orchestrator auth dir with the API-key guard asserted ([07b §2]); VAPID pair minted (redacted-push default, B-34); DNS/TLS track + forge mode chosen + matched to the profile; L1 base image present with CLI pin stamped ([07b §1.1]); first workspace+owner seeded via the Conductor ([MIGRATION §5]); `bootstrapped` marker set. (§5)
- [ ] **Secrets** live in the stack secret store / tmpfs env-files, never the committed `.env` or `--env` ([07b §6.3]). (§6)
- [ ] **Upgrade** = back up → pull tags (web-app rolling, orchestrator recreate → reconcile/`resumeAll`) → boot-time Prisma migration → pinned-tag rollback path ([08_DEPLOYMENT §2.2], [DR_RUNBOOK §9]). (§8)
- [ ] **No new verbs anywhere** — install/bootstrap/upgrade are infra + the seed-via-Conductor write (B-23); the frozen verb surface is untouched. (header)

---

## 10. Open questions (Q-INSTALL-\*) — defaults recommended, user to confirm/override

| id | Question | Recommendation | Why | Options |
|---|---|---|---|---|
| `Q-INSTALL-ORCH` | What is the v1 install orchestrator format? | **`docker compose` for v1; document Kubernetes/Helm as a future option.** | Every prereq is already a container ([07b]); compose expresses the [08_DEPLOYMENT §3] dependency graph + reuses `workspaces-net` with zero extra wiring; `restart: unless-stopped` is the supervisor [08] wants. The single-instance orchestrator (G16) + Docker-socket-mount map awkwardly onto k8s; the trusted-small-group scale (B-26) doesn't need it yet. | (A) docker compose [rec]; (B) k8s/Helm now; (C) a bespoke install CLI wrapping compose; (D) Nomad/Swarm |
| `Q-INSTALL-PROFILE-DEFAULT` | Which profile is the default / quick-start? | **Minimal (external GitLab forge).** | Most v1 teams already have a GitLab project (B-29, [FORGE_ABSTRACTION §5]); built-in mode is the opt-in all-in-one. Minimal is lighter on the reference host and skips the git-server/CI operational surface. | (A) minimal [rec]; (B) full; (C) no default — force an explicit `--profile` |
| `Q-INSTALL-BOOTSTRAP-SPLIT` | Where is the compose/bootstrap line drawn? | **Once-per-install state (Claude login, VAPID, first owner) in bootstrap; whenever-running state (services, bridge, proxy) in compose; the orchestrator's own boot sequence is image code compose only supervises.** | A compose that "logs in on boot" would re-run the once-only steps each restart and break the single-login managed-token invariant ([07b §2.2]). | (A) the split above [rec]; (B) everything in one entrypoint script; (C) a compose `init` one-shot service |
| `Q-INSTALL-AUTH-LOGIN` | How does bootstrap establish the host Claude login? | **Interactive `claude login` in bootstrap, API-key-guard asserted, normalized into the orchestrator-owned auth dir (Keychain export on macOS).** | The managed-token projection rests on a single host login the orchestrator's one refresh loop owns ([07b §2]); the API-key guard preserves subscription billing ([01 §1]). | (A) interactive login in bootstrap [rec]; (B) operator runs `claude login` manually then bootstrap detects it; (C) headless device-code flow |
| `Q-INSTALL-DNS-PROMPT` | Public DNS-01 vs LAN internal-CA at install? | **Prompt once; default to PUBLIC DNS-01 wildcard when a domain+token are supplied, LAN internal-CA otherwise.** | Per-ticket `dev-<id>.` subdomains are dynamic → DNS-01 (not HTTP-01) is required for the public track ([07b §5.4]); air-gapped installs need the internal-CA fallback. | (A) prompt, default-by-input [rec]; (B) always public; (C) always internal CA, document public as an upgrade |
| `Q-INSTALL-GITHOST` | Where does the full-profile built-in git live in the stack? | **A `git-server` container serving bare repos on the orchestrator host volume (mirrors [FORGE_ABSTRACTION §7.1] option A/B seam).** | Bare repos on the host reuse the lease + host-volume backup ([DR_RUNBOOK]); a thin server container gives a clean clone/serve protocol surface without a heavy forge. Inherits the same `Q-FORGE-GITHOST` fork. | (A) bare repos served by the orchestrator/`term.` [rec, ties to FORGE option A]; (B) a dedicated git-server container [FORGE option B]; (C) embedded in-process JS git server [FORGE option C] |
| `Q-INSTALL-UPGRADE-COORD` | How are service versions coordinated across an upgrade? | **Pin every service to an explicit tag; bump tags as a set per release; web-app rolling then orchestrator recreate→reconcile.** | Floating `:latest` makes `resumeAll()` re-attach against an unpredictable image and breaks audit reproducibility (B-36); set-bumping makes rollback a one-line re-pin. | (A) explicit pinned tags, set-bumped [rec]; (B) `:latest` + manual coordination; (C) a release-manifest file the installer reads |
