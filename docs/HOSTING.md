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
