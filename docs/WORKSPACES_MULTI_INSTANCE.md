# Running Workspaces multi-instance (Deel B)

> The engine is already multi-instance-**safe** (Deel A, ADR 0015): leader-elected background loops,
> a per-workspace cross-instance write-lease, cross-instance dedup, and an atomic signal seq. This
> doc is the **run recipe** — going from one instance to N is config + ops, not a code change.

## Model

Workspaces is a single LuckyStack service (`system` — all of `src/_api` + `src/_sync`), so
"multi-instance" means running **N identical `system` backends** behind the reverse proxy you
already run (Caddy or nginx — see `HOSTING.md`), which load-balances HTTP and pins each WebSocket to
one backend. The LuckyStack **router** (`deploy.config.ts` / `services.config.ts`) is for splitting
*different* services onto *different* backends; it is **not** needed for N identical instances.

Cross-instance correctness is handled by Redis (already a hard dependency): the write-lease + dedup
serialise authoritative writes per workspace across instances, and the socket.io Redis adapter fans
a broadcast on one instance out to sockets connected to the others.

## Steps

1. **Run N backends on distinct ports** (same host or several hosts), each with `WS_MULTI_INSTANCE=1`:
   ```bash
   WS_MULTI_INSTANCE=1 npm run server -- default 4100
   WS_MULTI_INSTANCE=1 npm run server -- default 4101
   # …one per instance
   ```
   `WS_MULTI_INSTANCE=1` attaches the socket Redis adapter (cross-instance realtime fan-out). All
   instances MUST share the same Redis and Mongo (they already do via `.env`).

2. **Point the reverse proxy at all of them, with sticky WebSockets.** A socket connection is
   stateful, so the *upgrade* must stay on one backend — sticky by client IP (or a cookie). Broadcasts
   still reach every instance via the Redis adapter, so stickiness is only for the live connection.

   **nginx:**
   ```nginx
   upstream workspaces_app {
       ip_hash;                 # sticky: a client keeps hitting the same backend (WS-safe)
       server 127.0.0.1:4100;
       server 127.0.0.1:4101;
   }
   server {
       listen 443 ssl;
       server_name workspace.keetlerop.nl;
       # …ssl…
       location / {
           proxy_pass http://workspaces_app;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   **Caddy:**
   ```caddy
   workspace.keetlerop.nl {
       reverse_proxy 127.0.0.1:4100 127.0.0.1:4101 {
           lb_policy ip_hash          # sticky by client IP (WS-safe)
       }
   }
   ```

3. **Set `WS_COOKIE_DOMAIN`** to the wildcard parent (e.g. `.workspace.keetlerop.nl`) so the session
   cookie — and edge-auth on the per-ticket editor/preview subdomains — works across subdomains and
   across whichever instance serves a request.

## What's automatic once N are running

- **Background loops** (GitLab issue sync, editor eviction) run on the **leader only** — no N× work.
- **Authoritative writes** are serialised **per workspace across instances** (the write-lease); unrelated
  workspaces still run in parallel.
- **Re-sends** are deduped across instances (the idempotency marker).
- **Realtime** deltas broadcast on any instance reach clients on all of them.

## Caveats

- A transient Redis blip can briefly drop + re-elect leadership (TTL-bounded ~15s) — background loops
  pause, then resume. Authoritative writes are unaffected (each takes its own short-lived lease).
- The container/editor host (Docker) is currently one host. Running worker containers across several
  hosts (a real container scheduler) is a separate, later concern from backend multi-instance.
- Per-ticket subdomain routes (editor/preview) live in the proxy the backend talks to; with several
  backend hosts, point them all at the same proxy admin (Caddy) or shared nginx conf dir.
