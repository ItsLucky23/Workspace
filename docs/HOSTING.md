# Hosting & the preview reverse-proxy

How to host Workspaces and expose each ticket's running app at a preview URL. The reverse
proxy is **pluggable — Caddy or nginx**, your choice; both are zero-downtime.

---

## 1. The hosting model

- Host the app under a subdomain of your domain, e.g. **`workspace.keetlerop.nl`**.
- Each ticket's container can run the project's dev server; it's exposed at a **per-ticket
  subdomain** of that host, e.g. `feature-dev-1240.workspace.keetlerop.nl`. The subdomain is
  derived from the ticket's branch (see the per-workspace **Workflow** settings → branch
  strategy), lower-cased into a valid DNS label.
- This needs a **wildcard DNS record** `*.workspace.keetlerop.nl` → your host, and a **wildcard
  TLS cert** for `*.workspace.keetlerop.nl` (one cert covers every preview).

The wildcard DNS is **static** — it never changes per ticket. Only the reverse proxy's internal
routing changes as containers come and go, so there is never DNS downtime.

---

## 2. Choose a reverse proxy

Set `WS_PROXY` to pick the backend (both sit behind one internal interface, identical
behaviour):

| `WS_PROXY` | How routes update | When to pick |
|---|---|---|
| `caddy` (default) | Caddy **Admin API** — dynamic add/remove, no reload | Easiest fit for per-ticket churn |
| `nginx` | Regenerate an include file + **debounced graceful reload** | You already run nginx |

`nginx -s reload` is graceful (new workers, old workers drain → **no dropped connections**), and
route changes are coalesced into one reload per ~1s, so nginx is zero-downtime and performant
even under churn.

### Common config

```bash
WS_PROXY=caddy                       # or: nginx
WS_BASE_DOMAIN=workspace.keetlerop.nl # dev default: localhost
```

### Caddy

Run Caddy with its admin endpoint enabled (default `localhost:2019`). Point a wildcard site at
your host and let Caddy manage TLS (it does DNS-01 for wildcards via the matching DNS plugin).

```bash
WS_CADDY_ADMIN=http://localhost:2019  # default
WS_CADDY_SERVER=srv0                  # the http server name to attach routes to
```

Workspaces adds/removes routes named `ws-route-<ticket>` via the admin API — it never rewrites
your base Caddyfile, and reconcile only prunes its own `ws-route-*` entries.

### nginx

Include the managed routes file from your `http {}` block and provide the wildcard cert:

```nginx
# /etc/nginx/nginx.conf (inside http {})
include /etc/nginx/conf.d/workspaces-routes.conf;
```

```bash
WS_NGINX_CONF=/etc/nginx/conf.d/workspaces-routes.conf  # the managed include (default)
WS_NGINX_SSL_CERT=/etc/nginx/ssl/workspaces-wildcard.crt
WS_NGINX_SSL_KEY=/etc/nginx/ssl/workspaces-wildcard.key
WS_NGINX_RELOAD_CMD="nginx -s reload"    # or: "systemctl reload nginx"
WS_NGINX_TEST_CMD="nginx -t"             # validated before every reload
WS_NGINX_DEBOUNCE_MS=1000                # coalesce window
```

Workspaces regenerates ONLY `WS_NGINX_CONF` (marked "DO NOT EDIT BY HAND"), validates it with
`nginx -t`, and reloads only if valid — a bad route can never take the proxy down.

---

## 3. Wildcard TLS (both backends)

Wildcard certs (`*.workspace.keetlerop.nl`) require the **DNS-01** ACME challenge (HTTP-01 can't
do wildcards). Issue it via your DNS provider's API:

- **Caddy**: build/use a Caddy binary with your DNS provider plugin; Caddy auto-issues + renews.
- **nginx**: issue with `certbot --dns-<provider>` (or `acme.sh`), point `WS_NGINX_SSL_CERT/KEY`
  at the result, and let certbot's renew hook reload nginx.

---

## 4. Verify

1. `WS_BASE_DOMAIN` resolves and `*.<base>` has a wildcard A/AAAA record to the host.
2. The proxy is reachable: Caddy admin (`curl localhost:2019/config/`) or `nginx -t` passes.
3. Open a ticket that runs a dev server → its `<slug>.<base>` preview loads over HTTPS.

The container runtime + engine work **without** any proxy configured — the proxy is only for the
per-ticket live previews. If it's absent, previews are simply unavailable; nothing else breaks.

---

## 5. Per-ticket VS Code editor exposure (Caddy on `workspaces-net`)

The per-ticket editor (openvscode-server, ADR 0010) is exposed exactly like previews: a
`vscode-<slug>.<base>` subdomain the proxy routes to the ticket container's in-container editor
port (3000). The backend adds/removes these routes dynamically via the proxy provider
(`server/proxy`), so the proxy just needs to be running on the shared container network with its
Admin API reachable.

### Dev launch

```
npm run caddy:launch        # runs the `caddy:2` container on workspaces-net (:443 + admin :2019)
```

- Config: `docker/caddy.json` — an empty `srv0` server, the Admin API on `0.0.0.0:2019`, and
  **internal-CA TLS for `*.localhost`** (so `https://vscode-<slug>.localhost` gets a cert with no
  external domain). `curl -k` in dev, or install Caddy's root CA to silence the browser warning.
- Backend seam: **`WS_CADDY_ADMIN=http://localhost:2019`** (the default). Editor containers are
  attached to `workspaces-net` at open-time (`editorSession.attachToProxyNet`) so Caddy can dial
  `<container>:3000` by name.
- WebSockets: openvscode is WS-heavy; Caddy's `reverse_proxy` forwards `Upgrade` natively
  (verified: `scripts/spike/caddyExposureSpike.mts` → `101 Switching Protocols`).

> **Admin-API gotcha (non-loopback bind):** when the Admin API is published (not loopback), Caddy
> enforces an origin allow-list. Node's `fetch` (undici, used by the backend) sends an **empty
> `Origin` header**, so `admin.origins` MUST include `""` (and `"null"`) alongside the host:port
> values, plus `"enforce_origin": false`. Without it every `POST` is `403 "origin ''"`.

### Prod

Swap the `tls.automation` policy in `docker/caddy.json` for a DNS-01 wildcard issuer on your real
`WS_BASE_DOMAIN` (same shape as the preview wildcard in §2), bind the Admin API to a private
interface, and set `admin.origins` to the backend's real host. Run Caddy on `workspaces-net` (e.g.
via compose) with `:443` published.

### Edge-auth on the editor subdomain (Track B5 — designed, needs 2 seams)

The editor URL already carries a per-(user,ticket) openvscode **connection-token** minted by the
login+RBAC-gated `openEditor` op (openvscode returns `403` without it), so a leaked subdomain alone
is not an open editor. To ALSO gate the subdomain on the LuckyStack session (only logged-in workspace
members reach it), add Caddy `forward_auth` in front of the editor `reverse_proxy`:

```
# per editor route, before reverse_proxy:
forward_auth <backend>:<port> {
  uri /editor-auth-check
  copy_headers X-Editor-User
}
```

The `/editor-auth-check` handler (login → `functions.session.getSession(cookie)` → 200; else 401;
optional host→workspace membership check via the editor route map) is a `registerCustomRoute`
handler. **Two wiring points live outside the editor/UI ownership and need the engine/proxy agent:**
1. **Register** the handler in the server bootstrap (`registerCustomRoute(editorAuthCheck, { phase: 'pre-params' })` — `server.ts`/`server/bootstrap`).
2. **Attach** `forward_auth` to the editor routes — the `ProxyRoute` interface (`server/proxy/types.ts`)
   carries only `{ id, host, target }`; it needs an optional `forwardAuth` field so `caddyProvider`
   emits the handler chain. Until then the connection-token is the edge layer.
