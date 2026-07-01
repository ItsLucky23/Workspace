# 07b — Container runtime (build-grade): images · auth · isolation · networking · egress · capacity · pty-agent

> **The marquee runtime, made concrete.** The container layer is the single largest greenfield surface in Workspaces and was the vaguest area in the review — named across `[01 §7]`, `[07 §A/§B]`, `SETUP §1–2`, and `B-12/B-26/B-31`, but never assembled into one build-grade model, with several fragments contradicting each other (`[REVIEW] Container deep-dive`). This doc is that assembly. It is the runtime-layer companion to `[07]` (which gives the launch/teardown *sequence*) — here we spell out **what a container actually is**, how it is **built**, **authenticated**, **isolated**, **networked**, **egress-filtered**, **admitted under capacity**, and **recovered after a crash**. Feature docs cite this as `[07b §x]`; `[07 §A]` step 6/7 expands into `[07b §3/§8]`. Prereq: `[01 §7]`, `[07]`, `[04b §7]` (the `AgentSession` runtime row), `SETUP §1/2/5`. Codes resolve via `REFERENCE_CODES.md`. Last updated: 2026-06-04.
>
> **Authority.** Every section traces to a LOCKED `Q-CT-*` / `Q-NET-*` / `Q-SEC-*` decision in [`REVIEW_AND_OPEN_QUESTIONS.md`](./REVIEW_AND_OPEN_QUESTIONS.md) (all accepted 2026-06-04; `Q-SEC-CLAUDEMOUNT` signed off in the popup round). The `→` markers carry the originating `Q-*` id inline. The **managed-token-projection auth spike is a HARD P2 prerequisite** — no P2 container work starts until it passes against the running CLI (`[07b §2.6]`, gated by the P0.5 CLI spike, `Q-ENG-SPIKE`).
>
> **No new verbs.** This is a runtime/infrastructure doc. Nothing here adds, renames, or relaxes a structured-channel verb. The frozen surface (`[02 §2]`: 7 worker + 6 assistant verbs, all read|propose, none write) is untouched; every container lifecycle action (launch, pause, reclaim, teardown, rebuild) is a **Conductor action behind `[control-API]`** (an authenticated `_api` route → `preApiExecute` RBAC → enqueue, `Q-ENG-CONTROL-API`), never an LLM verb (B-23).

---

## §0. The disposable unit, in one paragraph

A **ticket** that enters an `aiEnabled` stage gets **ONE container** (`Q-CT-UNIT`), bound for its life to a `DEV-####` git checkout cloned into a container-owned volume (`Q-CT-WORKTREE`). The container is built from a three-layer image stack (base → per-project → per-ticket runtime, `[07b §1]`), authenticated against the Max subscription by **managed token projection** (a read-only `.credentials.json` + minimal `.claude.json` mounted into a per-container `CLAUDE_CONFIG_DIR`, refreshed by ONE host loop — never a whole-`~/.claude` bind-mount, `[07b §2]`). It joins a single `workspaces-net` bridge so Caddy can dial it **by DNS name** with no host port publishing (`[07b §5]`); its egress is forced through a **host forward-proxy** that enforces the stage's domain allow-list (`[07b §6]`). It runs hardened (cap-drop ALL, non-root, no-new-privileges, pids/mem/cpu/disk limits, `[07b §7]`) and is only admitted by the **CapacityManager** when the host has budget (`[07b §8]`). Inside it, a **pty-agent** owns the `claude` PTY + durable scrollback, surviving orchestrator crashes (`[07b §9]`). A **stage transition** is a NEW PTY in the SAME container with freshly-rendered `.claude` config; the container is removed only at **ticket teardown** (`[07 §A]` back-half). Every image tag + CLI version is stamped onto the `AgentSession` row for audit (`[07b §10]`, `[04b §7]`).

---

## §1. Image & toolchain — the three-layer model

`B-12`/`[01 §7]` use "per-project image" and "devcontainer" interchangeably — they are different mechanisms; we pick the **Dockerfile path** and drop the devcontainer framing (`Q-CT-IMG`). Three layers, each with a distinct build trigger, owner, and tag scheme.

| Layer | Tag | Built by | Trigger | Lifetime |
|---|---|---|---|---|
| **L1 base** `workspaces/base:<semver>` | semver, hand-bumped | release pipeline (operator) | base Dockerfile change / CLI pin bump | months |
| **L2 per-project** `workspaces/proj-<projectId>:<contentHash>` | content-hash of `.workspaces/Dockerfile` + lockfile | orchestrator via Docker API | repo `.workspaces/Dockerfile` or lockfile change, **Admin-gated** (`Q-CT-DOCKERFILE-TRUST`) | until next project-image change |
| **L3 per-ticket** (runtime container, no image tag) | `docker run` of L2 | orchestrator, per `[07 §A]` step 6 | ticket activation / stage promotion | ticket life (removed at teardown) |

### 1.1 L1 base — `node:22-bookworm-slim` (`Q-CT-NODEPTY`, `Q-CT-CLIPIN`)
`FROM node:22-bookworm-slim` — **glibc, NOT Alpine/musl**. Two hard reasons: node-pty's native build (the pty-agent runs container-side, `[07b §9]`) and the glibc DB clients (`psql`/`mysql`/`mongosh`/`redis-cli`, D24). Baked into L1:

- `build-essential` + `python3` — node-gyp toolchain for node-pty (built **at L1 build time**, never at container start).
- `git`, `gh` (GitLab/clone + MR ops), `curl`, `ca-certificates`.
- DB clients `psql` / `mysql` / `mongosh` / `redis-cli` (the B-O8 tiers reach DBs through these CLIs, `[07b §6.3]`).
- A non-root **`agent`** user (uid/gid baked; everything below runs as `agent`, `[07b §7]`).
- The **Claude CLI pinned to an EXACT version** — never `@latest` (`Q-CT-CLIPIN`). The pin is a build-arg recorded into the image label `org.workspaces.cli-version`; CLI upgrades gate behind an L1 semver bump + a `--resume`/hook smoke test (`[07b §10]`, the P0.5 spike re-run, `Q-ENG-SPIKE`).
- The pty-agent program itself (`[07b §9]`) + its `node-pty` dependency, prebuilt.

> The L1 Dockerfile is part of the orchestrator repo; the operator builds + pushes it (single local daemon v1; registry → P4, `Q-CT-DOCKERFILE-TRUST`).

### 1.2 L2 per-project — Dockerfile `FROM base`, content-hash-tagged (`Q-CT-IMAGESEL`, `Q-CT-DOCKERFILE-TRUST`)
Most projects need only L1 (P1 PoC is chat-only and never builds an L2). A project with a bespoke toolchain (.NET / Go / Rust / a pinned Java) supplies a repo file **`.workspaces/Dockerfile`** that MUST begin `FROM workspaces/base:<semver>`. The orchestrator:

1. Reads `.workspaces/Dockerfile` at activation (or on a project-config change).
2. Computes a **content hash** over `(Dockerfile bytes + the project lockfile)` → the L2 tag.
3. If the tag is absent locally, builds via the Docker API (local daemon only, v1).
4. **Pre-warms the dependency layer** into L2 (`Q-CT-NODEMODULES`): the project's `npm ci` / `dotnet restore` / `go mod download` runs at L2 **build** time, not per container — so L3 container start does no dependency install. The lockfile is part of the content hash, so a lockfile bump rebuilds L2 exactly once.

**Trust posture (`Q-CT-DOCKERFILE-TRUST`):** arbitrary `FROM`/`RUN` is a supply-chain surface whose blast radius is the daemon holding the projected subscription token (`[07b §2]`). Mitigations: the Dockerfile is a **repo file** (versioned, reviewable, not a UI free-text field); authoring/changing it is **Admin-gated** (B-08, `[control-API]`), NOT B-26's blanket "trusted group" acceptance; builds are local-daemon-only (no remote registry pull of project images in v1). `Project.baseImageRef` (+ optional `dockerfilePath`) selects the image; default = the framework L1 base (`[04b §13]`). Per-project images are a **P2** concern — lane F's P1 scope is "L1 base + provisioning skeleton" only.

### 1.3 L3 per-ticket runtime
`docker run` of the resolved L2 (or L1) image with: the cloned worktree volume (`[07b §4]`), the boot env-file (`[07b §6.3]`), the RO auth mount (`[07b §2]`), the hardening flags (`[07b §7]`), and the `workspaces-net` attach (`[07b §5]`). Then `[07 §A]` step 6 renders `.claude/settings.json` + `.mcp.json` + `CLAUDE.md` from `PipelineStageCfg` (per `CLAUDE_SETTINGS_MAP §2`, re-stated interactive per E7) and runs the ordered `StageProcess` commands; step 7 attaches the `claude` PTY via the pty-agent. **No new verbs** — rendering is deterministic config emission, not a protocol surface.

---

## §2. Auth — managed token projection (CRITICAL; the load-bearing, currently-incorrect part)

Every prior doc said "mount `~/.claude`" as self-evident. It is incomplete and partly wrong, and the **entire subscription-billing premise rests on it** (`[01 §1]`: interactive PTY on the Max subscription; headless `-p`/SDK meter a separate pool). `Q-CT-AUTH` resolves this; `Q-SEC-CLAUDEMOUNT` signs off the residual risk.

### 2.1 The three concrete failure modes a naive bind-mount hits
1. **macOS Keychain leak-of-nothing.** On macOS the OAuth token lives in the **login Keychain** (service `claude-code`), NOT in `~/.claude/.credentials.json`. A bind-mount of `~/.claude` captures **nothing** — the container `claude` has no token and silently fails to bill against the subscription. In-scope because `[01 §7]` promises host-OS-agnosticism.
2. **Refresh race → fleet corruption.** The access token is short-lived; the CLI **rewrites `.credentials.json` on refresh**. ~N concurrent containers (`[07b §8]`: ~8 active, up to ~16 resident) sharing one **writable** file **race and corrupt it** → a fleet-wide auth outage, not a single-session failure.
3. **JSONL session leak + `--resume` corruption.** Mounting the whole dir exposes `projects/*.jsonl` (every prior session's full transcript) into every container, and `claude --resume` reads those JSONLs — concurrent writers across containers corrupt resume state (`[01 §4]` resume promise breaks).

### 2.2 The required model — managed token projection (`Q-CT-AUTH`)
```
host (orchestrator)                          per-ticket container (L3)
┌───────────────────────────┐                ┌──────────────────────────────┐
│ claude login   (ONCE)      │                │ CLAUDE_CONFIG_DIR=/auth        │
│   → normalize token to a   │   read-only    │ /auth/.credentials.json  (RO)  │
│     file the orch OWNS      │  ───mount──▶   │ /auth/.claude.json       (RO)  │
│   (export from Keychain     │                │  (NO projects/*.jsonl)         │
│    on macOS)                │                │                                │
│ ONE refresh loop:           │  re-project    │ claude  ─ never refreshes ─    │
│   refresh → re-project into │  ──on refresh▶ │   reads RO creds, bills on     │
│   every live container      │                │   the Max subscription         │
└───────────────────────────┘                └──────────────────────────────┘
```
- **Login once, on the host.** The orchestrator runs `claude login` a single time and **normalizes** the resulting token into a file it owns (on macOS this means **exporting from the Keychain**; on Linux it reads `~/.claude/.credentials.json` directly). Mode (1) is solved at the source.
- **Mount ONLY a projected, read-only `.credentials.json` + a minimal `.claude.json`** into each container's own **`CLAUDE_CONFIG_DIR`** (e.g. `/auth`). NEVER bind-mount the whole `~/.claude`. The projected `.claude.json` carries only what interactive `claude` needs to start — **no `projects/` JSONL history** (mode 3 solved: each container's `--resume` reads only its OWN session, persisted to the worktree-volume `CLAUDE_CONFIG_DIR`, not a shared host dir).
- **ONE host-side refresh loop.** A single loop on the host owns token refresh; on each refresh it **re-projects** the new token into every live container's RO mount (atomic write-rename so a half-written file is never read). **No container ever refreshes** → no writer race (mode 2 solved). The mount is RO **from the container's view**; the host re-projection is the only writer.

### 2.3 Where `--resume` session JSONLs actually live
Per-session transcripts (`<sessionId>.jsonl`) are written into the **container's own writable `CLAUDE_CONFIG_DIR`** (on the worktree volume, `[07b §4]`), NOT the host. So `claude --resume <claudeSessionId>` (`[04b §7]`, `Q-CT-RESUME`) reads a private file; crash-recovery survives because the volume survives (`--restart unless-stopped`, `[07b §9]`). The RO auth mount and the RW session dir are **separate paths** under the same `CLAUDE_CONFIG_DIR` (creds RO-mounted, `projects/` writable on the volume).

### 2.4 Residual-risk sign-off (`Q-SEC-CLAUDEMOUNT`, signed off 2026-06-04)
The mounted subscription token + B-26 "light isolation" means a **compromised dependency** in the worktree (the accepted B-26 risk) could read the projected `.credentials.json` and attempt exfiltration. Mitigations layered (all documented; residual accepted by sign-off):
- **Minimal RO projection** — only `.credentials.json` + a stripped `.claude.json`, never the full dir.
- **`denyRead` on the auth path from the Bash tool** — the rendered `.claude/settings.json` denies the agent's own `Bash`/`Read` access to `$CLAUDE_CONFIG_DIR/.credentials.json` (defense in depth; the CLI process still reads it).
- **Egress proxy blocks exfil domains** (`[07b §6]`): a stolen token can't be POSTed anywhere outside the stage allow-list.
- **Hardening** (`[07b §7]`): non-root, cap-drop ALL, no host network.
- **Residual:** a sophisticated in-process exploit of `claude` itself could still use the live token within the allow-list. Accepted under B-26 (trusted small-group, self-hosted) with sign-off; a future per-workspace `@luckystack/secrets` mint (P4) narrows it further.

### 2.5 Host-side reasoning roles (`Q-CT-HOSTROLES`)
Refine/Plan roles (`AgentRole.needsWorkspace=false`) have no worktree and no integration creds. They still need subscription auth, so they run in a **minimal RO container** (no worktree volume, no DB creds, egress allow-list = Anthropic only) with the **same projected RO auth mount**. They do NOT get host-unrestricted access (rejected option). `containerId`/`worktreePath` on their `AgentSession` row stay null only for the worktree; `containerId` IS set (the minimal RO container). → `[04b §7]`.

### 2.6 The spike — a HARD P2 prerequisite (`Q-CT-AUTH`, gated by `Q-ENG-SPIKE`)
**No P2 container work begins until this passes against the running 2026 CLI.** The P0.5 CLI spike (`P0_CLI_SPIKE.md`) MUST verify, with a committed pass/fail table:
- Interactive PTY `claude` with `CLAUDE_CONFIG_DIR=/auth` + a RO `.credentials.json` actually authenticates and **bills the Max subscription** (not a metered pool).
- A re-projected (refreshed) token is picked up by an already-running container's next turn **without** the container writing the file.
- `--resume <id>` works reading a container-local `projects/` (no shared host JSONLs).
- macOS Keychain export yields a token the Linux container accepts.

If any fails → **escalate, do not route to headless** (`-p`/SDK is the rejected billing path, E1; metered-burst stays P4-optional only, `Q-MP-BILLING`).

**No new verbs.** Auth is host-side infra; the agent never sees a verb for it.

---

## §3. Isolation unit — one container per ticket, one PTY per stage (`Q-CT-UNIT`)

`[01 §3.1]` (per-stage, torn down at stage end), `[01 §4]` (containers survive), and DH5 (one frozen `commitHash` per ticket) contradict. Resolution:

- **ONE container per `ticketId`**, bound to its persistent `DEV-####` worktree volume for the ticket's life.
- **A stage transition is a NEW `claude` PTY process in the SAME container**, started with **freshly-rendered `.claude` config** (`settings.json`/`.mcp.json`/`CLAUDE.md` for the new stage). The re-render IS the settings boundary `[01 §3.1]` wanted — without recreating the container.
- **The container is removed only at ticket teardown** (`[07 §A]` back-half). Reword `[01 §3.1]`'s "torn down at stage end" to "**the PTY process is killed at stage end; the container is removed only at ticket teardown.**"
- **No concurrent stages per ticket in v1** — one live PTY per container at a time. (Concurrent stages would need either multiple PTYs sharing a worktree, a data hazard, or multiple containers per ticket, which breaks the frozen-`commitHash` unit — both deferred.)

State mapping on the `AgentSession` row (`[04b §7]`): the old stage's PTY row goes `stopped`; a new row (or a re-keyed `sessionKey = worker:{ticketId}:{newStageId}`) is created `ready→busy` in the same `containerId`. The `claudeSessionId` is per-PTY (a fresh `claude` invocation), so each stage has its own resumable session.

**No new verbs.** Stage promotion is a `[control-API]` Conductor action (`[07 §A]` step 1).

---

## §4. Worktree → container — clone into a volume (`Q-CT-WORKTREE`)

`[07 §A]` step 5 creates the worktree with `git worktree add` on the HOST but runs `claude` INSIDE the container at that path — **a silent footgun**: git worktrees use a `.git` *gitdir pointer* back to the main repo's `.git/worktrees/<name>`; a naive bind-mount of just the worktree dir has a dangling pointer and **breaks git on the first real command** (commit/branch/status).

**Resolution: `git clone --branch DEV-#### --single-branch` into a clean container-owned volume.** Self-contained, no gitdir pointer, matches the disposable model:
- The clone target is a **named Docker volume** mounted at the worktree path (e.g. `/work`), so the checkout + the container-local `CLAUDE_CONFIG_DIR/projects/` (session JSONLs, `[07b §2.3]`) both survive `--restart` (`[07b §9]`).
- `--single-branch` keeps the clone lean (no full ref history fan-out); the branch name encodes the ticket prefix (`DEV-####`).
- The **frozen `commitHash`** (DH5) is captured on the host mirror at `[07 §A]` step 3 and the clone is checked out at it — code state + RAG snapshot share the hash. `main` advancing doesn't move the ticket until re-activation.
- `git worktree add` on the host mirror is **retired** for the container path (the host mirror is still pulled at step 2 to read HEAD; the *checkout* the agent edits is the clone).

A disk quota on the volume is part of the hardening table (`[07b §7]`). Worktree teardown removes the volume with the container at ticket teardown.

**No new verbs.** Pure orchestrator git mechanics.

---

## §5. Networking — containerized orchestrator + dial-by-name (`Q-NET-DOCKER`, `Q-NET-TLS`, `Q-NET-CADDY`)

`[07 §B]` dials `${container.ip}:5173` with no network-mode. On **Docker Desktop / WSL2** (the user's Windows 11 box, `[01 §7]`) the bridge subnet is **NOT routed to the host**, so a host-process Caddy can't reach `container.ip` — it fails on the one known platform.

### 5.1 The bridge + dial-by-name
- **Run the orchestrator itself as a container** on a single user-defined bridge **`workspaces-net`**. Every ticket container, the Caddy edge container, and the forward-proxy (`[07b §6]`) join `workspaces-net`.
- **Caddy dials by container DNS NAME** on the fixed in-container port — `dev-<ticketId>` → `reverse_proxy <containerName>:5173`. **No host port publishing**, identical on Linux and WSL2 (Docker's embedded DNS resolves container names on a user-defined bridge).
- **Host-process fallback** (only if the orchestrator can't be containerized): host-published ephemeral ports + a **Redis-leased port allocator** into `PreviewDeployment.port`. The leased allocator prevents two containers grabbing the same host port under the single-instance lease (G8/G16).

### 5.2 The DEV 2-port model (G14) and what Caddy targets
A LuckyStack project in DEV runs two processes: **Vite** (`vite --host`, fixed **:5173**, browser-facing, proxies `/api`,`/sync`,`/auth`,`/uploads`,`/socket.io`(ws) + health to the **Node backend :80**). The `dev-<ticketId>` edge MUST target **Vite :5173**, never :80 — proxying the backend breaks HMR (`/@vite/client`) + the socket.io handshake. A build-only PROD-mode preview stage is single-port (B-13, `[07b §11]`).

### 5.3 Caddy routes — crash-safe by `@id` + boot reconcile (`Q-NET-CADDY`)
The orchestrator drives Caddy's admin API:
- **POST a route WITH an explicit `@id route-dev-<ticketId>`** on container start; **DELETE by that id** on teardown. (Current `[07 §B]` POSTs *without* an id but DELETEs *by* id — it can remove the wrong route; this fixes it.)
- A **boot-time Caddy↔state reconcile under the Redis lease** (G8/G16): on orchestrator boot, list Caddy routes, list live containers / `PreviewDeployment` rows, and add/remove to converge — so a crash mid-POST/DELETE self-heals.

| Subdomain | Upstream | LB? | When |
|---|---|---|---|
| `app.<domain>` | the scaled web-app pool | **yes** (LB pool, the only one) | static (boot) |
| `term.<domain>` | the single-instance orchestrator | **no** — single upstream (G16: WS pins to orchestrator) | static (boot) |
| `dev-<ticketId>.<domain>` | the ticket container's Vite **:5173** | **no** — single upstream | per-container POST/DELETE by `@id` |

`term.`/`dev-` are **never** load-balanced (G16: terminal/preview WS are point-to-point host-bound state); only `app.` is an LB pool.

### 5.4 TLS — two tracks (`Q-NET-TLS`)
- **PUBLIC:** Caddy + ACME **DNS-01 wildcard** for `*.<domain>` (operator supplies the DNS record + a scoped DNS-provider token; `SETUP §5`). DNS-01 (not HTTP-01) because per-ticket subdomains are dynamic and HTTP-01 would hit rate limits + need each name reachable.
- **LAN / air-gapped:** Caddy **internal CA** + local DNS resolving `*.<domain>` to the host. Document both in `SETUP §5`.

**No new verbs.** Caddy route lifecycle is orchestrator infra, auditable in the event-log (`[07 §B]`).

---

## §6. Egress & the forward-proxy (CRITICAL — `Q-CT-EGRESS`, P2 prerequisite)

The per-stage egress allow-list (B-26, `StageNetworkCfg`) has **NO implementation**: Docker has no native domain allow-list, and the only previously-named mechanism — the Claude-CLI `sandbox.network.allowedDomains` — is a **headless-mode** feature the PTY pivot may invalidate. So:

### 6.1 The host forward-proxy is the enforcement point
- A **host-level forward-proxy** (squid or mitmproxy) runs as a container on `workspaces-net`.
- Each ticket container is started with **`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`** pointing at the proxy and **no direct default route** off `workspaces-net` (the bridge's external egress is blocked except via the proxy; enforced by the bridge's iptables/`--internal`-style posture + the proxy as the only NAT path).
- The proxy enforces **each stage's domain allow-list** (from `PipelineStageCfg` / `StageNetworkCfg`): Anthropic API (always), the GitLab host, the self-hosted embedding endpoint, `npm`/package registries as the stage permits — everything else denied + logged.
- **The CLI sandbox (`allowedDomains`) is defense-in-depth ONLY**, never the sole control — it may not apply in interactive PTY mode (the P0.5 spike notes this; the proxy is authoritative regardless).

### 6.2 Why this also protects auth
The proxy is the same mechanism that blocks token exfiltration (`[07b §2.4]`): a compromised dependency that reads the projected `.credentials.json` cannot POST it to an attacker domain — the allow-list denies it. This is the layered mitigation that makes the `Q-SEC-CLAUDEMOUNT` sign-off acceptable.

### 6.3 Boot env injection (G15) via a tmpfs env-file (`Q-SEC-CREDLIFETIME`)
At container boot (`[07 §A]` step 6) the orchestrator injects, **via a tmpfs-mounted env-file, never `--env` on the command line** (so creds never appear in `docker inspect`/process listings):
- `DNS=https://dev-<ticketId>.<domain>` (+ extra origins) — so `config.ts` derives the right `backendUrl`/CORS/OAuth/email links; without it CORS fail-closes (403) and OAuth points at the wrong host (G15).
- `DATABASE_URL` / `REDIS_*` — the stage's **B-O8 tier** ro/rw DB credential pair (long-lived per-tier DB users, stored **encrypted** app-side, decrypted only at boot into the tmpfs env-file, `denyRead` from the Bash tool, `Q-SEC-CREDLIFETIME`). NOT baked into the image, NOT in `.claude/settings.json`. The GitLab PAT lives in a server-side MCP tool (P4 minting deferred), never in the container env.
- `NODE_ENV=development`.
- `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` (`[07b §6.1]`).

The tmpfs env-file is unmounted/zeroed on container stop. App-owned encryption v1; `@luckystack/secrets` is a P4 upgrade (`Q-SEC-SECRETS-PKG`).

**No new verbs.** Egress + secret injection are orchestrator-side; the agent reaches DBs/integrations through the CLI clients (B-O8), never a verb.

---

## §7. Hardening table — concrete numbers (`Q-CT-LIMITS`, `Q-SEC-CLAUDEMOUNT`)

B-26 names "reasonable container hygiene" but never lists it. **NEVER `docker run` without explicit limits.** Threat model = trusted small-group, self-hosted (B-26): no gVisor/Firecracker-class isolation, but every container carries the full table below. Reference host = 8 vCPU / 32 GB (`[07b §8]`).

| Control | Setting | Why |
|---|---|---|
| **Capabilities** | `--cap-drop ALL` + minimal add-back (only what node/git/build needs; typically none beyond defaults already dropped) | strip ambient privilege |
| **Privilege escalation** | `--security-opt no-new-privileges` | block setuid escalation |
| **User** | non-root **`agent`** (baked in L1, `[07b §1.1]`); `--user agent` | no root in container |
| **User namespaces** | rootless Docker / `userns-remap` where the host supports it | container-root ≠ host-root |
| **PIDs** | `--pids-limit 512` | fork-bomb ceiling |
| **Memory** | `--memory 3g` (`--memory-swap 3g`, no swap burst) | OOM containment; sizes the resident cap (`[07b §8]`) |
| **CPU** | `--cpus 2` | fair share; ~8 active on the reference host |
| **Disk** | quota on the worktree volume (e.g. 10g per ticket; storage-driver `--storage-opt size=` or a quota'd mount) | a runaway build/log can't fill the host |
| **Network** | join `workspaces-net` only; egress via the forward-proxy; **no `--network host`**, no extra published ports | `[07b §5]`/`[07b §6]` |
| **Restart** | `--restart unless-stopped` | survive orchestrator crash for `resumeAll` (`[07b §9]`) |
| **Seccomp/AppArmor** | Docker default profiles (not loosened) | baseline syscall filtering |
| **Auth mount** | RO `.credentials.json`; `denyRead` from Bash | `[07b §2.4]` |
| **FS** | worktree volume writable; image layers RO; tmpfs for the env-file | `[07b §6.3]` |

**No new verbs.** Hardening is `docker run` flags the orchestrator sets.

---

## §8. Capacity & scaling — the CapacityManager admission gate (`Q-CT-CAPACITY`, `Q-CT-HOSTSPEC`, `Q-PREVIEW-COST`)

`[01 §6]` caps only concurrent ACTIVE TURNS (~4); there is **no cap on RESIDENT containers**, and the preview cap (~20, D86) is independent — worst case ~40 heavy containers on one box with no host sizing. `[07 §A]` is non-transactional past `docker run` (a partial-launch OOM orphans worktree + route).

### 8.1 Reference host & three distinct caps (`Q-CT-HOSTSPEC`)
Fix a **reference host: 8 vCPU / 32 GB / NVMe** → roughly **~8 active** turns or **~12–16 mostly-paused** resident containers. Stop overloading the single number "20"; publish three separate, measured caps:

| Cap | Meaning | Reference value |
|---|---|---|
| `MAX_ACTIVE_TURNS` | concurrent executing turns (a turn holds a slot, released on the Stop hook, `Q-ENG-TURNEND`) | ~4–8 |
| `MAX_RESIDENT` | resident containers (active + paused) before admission reclaims/queues | ~12–16 |
| `previewConcurrencyCap` | a **SUB-limit inside one shared budget** (not independent), hard-ceiling ~20, re-derived from measured per-PROD cost | `Workspace.previewConcurrencyCap`, D86 |

### 8.2 The admission gate (`Q-CT-CAPACITY`)
The **CapacityManager** mediates every container launch (`[07 §A]` step 6) under the Redis lease:
```
admit(request):
  if residentCount < MAX_RESIDENT and ramHeadroom > watermark:
     launch()                              # idempotent / rollback-safe (§8.3)
  else:
     victim = oldestPausedOrIdle()         # D87: reclaim before reject
     if victim: reclaim(victim); launch()
     else: enqueue(request)                # queue, do not hard-reject
```
- **Reclaim before reject** (D87): over `MAX_RESIDENT` or under a RAM watermark, pause+remove the **oldest paused/idle** container (its `AgentSession` → `paused`, container kept for `--resume` only if within the idle window, else `stopped` + volume retained for re-clone), THEN admit.
- **`previewConcurrencyCap` is a sub-limit in ONE shared budget** — previews and worker containers draw from the same resident pool, not two independent ceilings that over-subscribe the host (`Q-PREVIEW-COST`).
- **Queue, never hard-reject** when nothing is reclaimable — the request waits and a `Notification` informs the user (B-34).

### 8.3 Idempotent / rollback-safe launch
`[07 §A]` step 6 must be transactional past `docker run`: on a partial-launch failure (OOM, image-pull error) the orchestrator rolls back the worktree volume + any POSTed Caddy route + the `AgentSession` row, so no orphan survives. Launch is idempotent (re-running for the same `(ticketId, stageId)` either reuses the live container or cleanly recreates).

### 8.4 node_modules strategy (`Q-CT-NODEMODULES`)
Prefer the **pre-warmed dependency layer baked into L2** (`[07b §1.2]`) over per-container `npm ci` (slow, repeated) or a shared host symlink (arch/libc coupling, breaks isolation). A small warm-pool of ready L2 containers, LRU'd against `MAX_RESIDENT`, keeps only the `claude` start on the critical path (`[01 §6]` warm-vs-cold).

**No new verbs.** Admission/reclaim are `[control-API]` Conductor actions; the user sees queue/pause notifications, not a protocol surface.

---

## §9. The pty-agent — in-container, durable scrollback, crash-resume (`Q-CT-PTYAGENT`, `Q-CT-RESUME`)

B-31 wants a per-container pty-agent that survives an orchestrator restart, but `[01 §4]` puts the ring-buffer in the **in-memory `ManagedSession`** — which **cannot survive a crash**, contradicting the "ring-buffer reseeds the browser view" resume promise.

### 9.1 The model
- The **pty-agent is a process INSIDE each L3 container** (baked into L1, `[07b §1.1]`). It owns **node-pty** + a **durable scrollback** (a bounded ring-buffer persisted to the worktree volume, so it survives a container `--restart` and an orchestrator crash).
- It listens on a **`127.0.0.1`-published port** the orchestrator reads via `docker inspect` and stores as `AgentSession.ptyAgentUrl` (`[04b §7]`).
- The orchestrator **relays** the pty-agent over the existing **`/pty` namespace, reusing the `ws-term:*` protocol** (`ws-term:start`/`input`/`out`/`resize`/`kill`/`exit`) so the `XtermTerminal` client (`src/workspaces/_components/XtermTerminal.tsx`) stays **byte-identical** — only the backend changes (the dev host-shell bridge `server/hooks/workspacesTerminal.ts` is the *seam to reuse*, its host-shell backend is *replaced*, `Q-PROD-TERMINAL`; a hard prod boot-guard crashes if the dev host-shell flag is set without the container backend).
- The orchestrator's ring-buffer becomes a **cache, rebuilt by replay** from the pty-agent's durable scrollback on reconnect. The pty-agent is the source of truth for scrollback, not the orchestrator's memory.

### 9.2 Crash-resume re-association (`Q-CT-RESUME`)
- **Persist `containerId` + `worktreePath` + `ptyAgentUrl` + `claudeSessionId` on the `AgentSession` row** (`[04b §7]`).
- `--restart unless-stopped` (`[07b §7]`) keeps the container + its pty-agent alive across an orchestrator crash.
- On boot, **`resumeAll()`** reads `AgentSession` rows in `{ready, busy, paused}`, and for each: re-resolves the container by stored `containerId`, re-attaches the pty-agent at `ptyAgentUrl` (replaying scrollback into the rebuilt cache), **re-mints `channelTokenId`/`hookTokenId`** (`Q-ENG-TOKEN-LIFECYCLE`), and — if a turn was mid-flight — `claude --resume <claudeSessionId>`. Surviving terminals reseed the browser view with no lost scrollback.
- The SSH capability-gate (B-05) still guards the `/pty` namespace; the sessionId resolves to a container, not a host shell.

**No new verbs.** The pty-agent speaks `ws-term:*` (a transport, not a structured-channel verb); the structured channel is unchanged.

---

## §10. Image lifecycle, versioning & reproducibility (`Q-CT-IMGLIFECYCLE`, `Q-CT-CLIPIN`)

The event-log is the audit priority (B-36): a builder must be able to answer **"which CLI + which image built this MR."**

- **Version stamping.** The resolved **L2 image tag** (`baseImageRef`) + the **exact CLI version** (`cliVersion`) are stamped onto **every `AgentSession`** and rideable into `TicketEvent.metadata` (`[04b §6/§7]`). The L1 image carries `org.workspaces.cli-version` + `org.workspaces.base-semver` labels.
- **Tag scheme** (`[07b §1]`): semver the L1 base, content-hash the L2 per-project, pin the CLI exactly.
- **Rebuild triggers.** L2 rebuilds on `.workspaces/Dockerfile` or lockfile change (content-hash miss). An **`images rebuild` `[control-API]` control** lets an Admin force a rebuild; a **B-34 notification** fires when a Dockerfile change is detected (the next activation will build).
- **CLI upgrades** gate behind an L1 semver bump + a re-run of the P0.5 hook/`--resume`/billing smoke test (`Q-ENG-SPIKE`) — never an unattended `@latest`.

**No new verbs.** `images rebuild` is a `[control-API]` action.

---

## §11. Preview deployments — cost & queue (`Q-PREVIEW-COST`)

Preview ("Open preview" → a live `dev-<ticketId>.<domain>` app) reuses the container machinery:
- **Same base image, reuse the worktree at the frozen `commitHash`** (DH5); build then run in the background. PROD-mode preview is **single-port** (B-13) vs DEV's 2-port (`[07b §5.2]`).
- **building → live** when PROD `/readyz` returns 200; a build **timeout** fires a `Notification` (B-34).
- **Re-derive the cap from measured per-PROD cost** (a full app stack is heavier than a chat container; the real number is likely well below 20). `previewConcurrencyCap` (~20) is a **hard ceiling only**, drawn from the **same shared CapacityManager budget** as worker containers (`[07b §8.2]`) — not an independent allocation.
- `PreviewDeployment { port, status, commitHash, … }` tracks each (port only on the host-fallback path, `[07b §5.1]`; dial-by-name otherwise).

**No new verbs.** Preview up/down are `[control-API]` Conductor actions (doc 23).

---

## §12. Build checklist — the container layer is correct when…

- [ ] **Auth** is managed token projection: `claude login` once, RO `.credentials.json` + minimal `.claude.json` per-container `CLAUDE_CONFIG_DIR`, ONE host refresh loop, no whole-`~/.claude` mount, no container ever refreshes (`[07b §2]`). **The P2 auth spike passed** against the live CLI (`Q-CT-AUTH`/`Q-ENG-SPIKE`).
- [ ] **Three-layer images**: `node:22-bookworm-slim` L1 (node-pty + glibc DB clients + **exact-pinned** CLI baked), content-hash L2 (FROM base, Admin-gated, dep-layer pre-warmed), L3 runtime (`[07b §1]`).
- [ ] **One container per ticket, one PTY per stage**, re-rendered `.claude` per stage, container removed only at ticket teardown, no concurrent stages v1 (`[07b §3]`).
- [ ] **Worktree = `git clone --single-branch` into a volume** at the frozen `commitHash`, never a worktree bind-mount (`[07b §4]`).
- [ ] **Containerized orchestrator on `workspaces-net`; Caddy dials by DNS name** (Vite :5173); `@id` routes + boot reconcile under the lease; DNS-01 wildcard / internal-CA TLS (`[07b §5]`).
- [ ] **Host forward-proxy enforces per-stage egress**; CLI sandbox is defense-in-depth only; boot env via tmpfs env-file, never `--env` (`[07b §6]`).
- [ ] **Full hardening table applied** — cap-drop ALL, no-new-privileges, non-root, pids 512 / mem 3g / cpu 2 / disk quota, `--restart unless-stopped`, no host network (`[07b §7]`). Never `docker run` without limits.
- [ ] **CapacityManager** admits under `MAX_RESIDENT` + RAM watermark, reclaims oldest paused/idle else queues; `previewConcurrencyCap` a sub-limit in one shared budget; launch idempotent/rollback-safe; reference host 8 vCPU/32 GB (`[07b §8]`).
- [ ] **In-container pty-agent** owns node-pty + durable scrollback on a `127.0.0.1` port relayed over `/pty` (`ws-term:*` reused, `XtermTerminal` byte-identical); `resumeAll()` re-associates by stored `containerId`/`worktreePath`/`ptyAgentUrl`, re-mints tokens (`[07b §9]`).
- [ ] **Image tag + CLI version stamped** on every `AgentSession`/`TicketEvent`; `images rebuild` control + B-34 notification on Dockerfile change (`[07b §10]`).
- [ ] **Preview** reuses the base image at the frozen commit, single-port PROD mode, cap re-derived from measured cost, shared CapacityManager budget (`[07b §11]`).
- [ ] **`runInTenant` wraps the pty-agent relay + the CapacityManager + the reconcile loop** (every non-`/api` worker, `Q-SEC-RUNINTENANT`, `[04b §11c]`).
- [ ] **No new verbs anywhere** — every container lifecycle action is a `[control-API]` Conductor action, never an LLM verb (B-23).

---

## §13. Cross-reference index

| This doc | Expands / fixes | Cited by |
|---|---|---|
| §1 three-layer image | `B-12` (drops devcontainer), `[01 §7]`, `SETUP §2` | 23, SETUP |
| §2 managed-token auth | `[01 §7]` "mount ~/.claude" (corrected), `[01 §1]` billing | SETUP §1, `[04b §7]` |
| §3 isolation unit | `[01 §3.1]`/`[01 §4]`/DH5 (reconciled) | 03, 05 |
| §4 clone-into-volume | `[07 §A]` step 5 (corrected) | 07, 23 |
| §5 networking/Caddy/TLS | `[07 §B]` (dial-by-name, `@id`), G14/G15/G16, B-11 | 04, 23, SETUP §5 |
| §6 egress/forward-proxy | B-26 `StageNetworkCfg` (implemented), G15, `Q-SEC-CREDLIFETIME` | 04, 17, SETUP |
| §7 hardening table | B-26 (enumerated) | 16, 17, 23 |
| §8 CapacityManager | `[01 §6]` (resident cap added), D86/D87 | 19, 23, 24 |
| §9 pty-agent | B-31, `[01 §4]` (durable scrollback), G5, `Q-PROD-TERMINAL` | 14, 24 |
| §10 image lifecycle | B-36 audit, `Q-CT-CLIPIN` | 20, SETUP |
| §11 preview | B-13, D86 | 23 |

**Self-check:** No new verbs introduced. No write verb granted to any LLM session — every launch/pause/reclaim/teardown/rebuild is a `[control-API]` Conductor action (B-23). The managed-token-projection auth spike is a HARD P2 prerequisite (gated by the P0.5 CLI spike, `Q-ENG-SPIKE`). The subscription-billing path is preserved (interactive PTY only; never headless to "fix" auth, E1). This doc edits no existing file.
