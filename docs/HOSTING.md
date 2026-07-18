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

The self-host stack uses `deploy/Caddyfile` + `deploy/docker-compose.yml`. Caddy is dual-homed:
public/editor traffic uses `workspaces-net`, while the Admin API and edge-auth backend use a
separate, `internal: true`, Compose-project-scoped `management` network. Port `2019` is never
published to the host and Caddy binds Admin only to its fixed management IP — never
`0.0.0.0:2019`.

```bash
# Set these in deploy/.env only when the default subnet overlaps another Docker network.
# The fixed IP MUST belong to the subnet; change both together.
WS_CADDY_ADMIN_IP=172.30.0.2
WS_CADDY_MANAGEMENT_SUBNET=172.30.0.0/24
```

Compose injects `WS_CADDY_ADMIN=http://caddy-admin:2019` into the app and
`WS_EDITOR_AUTH_BACKEND=app-upstream:80` into dynamic editor routes. `caddy-admin` and
`app-upstream` are aliases visible only on the project-scoped management network; ticket
containers attached only to `workspaces-net` cannot reach Admin. Workspaces adds/removes
`ws-route-<ticket>` entries through that private endpoint and reconcile only prunes its own
`ws-route-*` entries.

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
2. The proxy is reachable: from the app container, Caddy Admin at
   `http://caddy-admin:2019/config/` responds; it must NOT be reachable on a host-published `:2019`.
   For nginx, `nginx -t` passes.
3. Open a ticket that runs a dev server → its `<slug>.<base>` preview loads over HTTPS.

The container runtime + engine work **without** any proxy configured — the proxy is only for the
per-ticket live previews. If it's absent, previews are simply unavailable; nothing else breaks.

---

## 5. Per-ticket VS Code editor exposure (Caddy on `workspaces-net`)

The per-ticket editor (openvscode-server, ADR 0010) is exposed at
`vscode-<slug>.<base>`. Caddy reaches the ticket container on `workspaces-net`, but its Admin
listener remains bound exclusively to the separate management network described in §2. The
backend adds/removes the host → `<container>:3000` route through `caddy-admin`; no ticket
container joins that control plane. Caddy's `reverse_proxy` forwards openvscode WebSockets
natively.

### Edge-auth on the editor subdomain

The self-host Compose path enables `WS_EDITOR_EDGE_AUTH=1`. Every editor route carries its
`workspaceId`; route upsert stores host → workspace ownership in Redis and Caddy runs the
`/editor-auth-check` subrequest before the editor reverse proxy. The check is deliberately
fail-closed:

| Condition | Result |
|---|---:|
| invalid/missing LuckyStack session | `401` |
| valid session, but host mapping missing | `403` |
| valid session, but Redis ownership lookup unavailable | `503` |
| mapping found, but user lacks `workTickets` in that workspace | `403` |
| mapping found and user has `workTickets` | `204` (Caddy proceeds) |

There is no login-only fallback. The browser must send the session cookie to the editor
subdomain, so production must set `WS_COOKIE_DOMAIN` to the wildcard parent (for example
`.workspace.keetlerop.nl`). The per-session openvscode connection token remains a second gate;
passing edge-auth alone does not authenticate the workbench connection.
