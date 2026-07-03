//? Workspaces — reverse-proxy PROVIDER abstraction (hosting-proxy plan).
//?
//? The reverse proxy is an integration point, not core logic, so it sits behind ONE
//? interface with pluggable backends (mirrors the AI-provider layer). The orchestrator only
//? ever needs: upsert a route (host → container:port), remove one, and reconcile the live set
//? on boot. `caddy` drives the Admin API (dynamic, no reload); `nginx` writes an include file
//? + debounced graceful reload. Both are zero-downtime — the wildcard DNS never changes, only
//? the proxy's internal routing does.

//? A single host→upstream route. `id` is a stable handle (typically the ticket key) used to
//? upsert/remove/reconcile idempotently. `host` is the full FQDN (`<slug>.<baseDomain>`);
//? `target` is the upstream `host:port` the proxy dials (a container name on the shared net).
export interface ProxyRoute {
  id: string;
  host: string;
  target: string;
}

export interface ProxyResult {
  ok: boolean;
  error?: string;
}

//? The pluggable contract every backend implements. Implementations are best-effort +
//? idempotent: a missing proxy yields `ok:false` (never throws), a duplicate upsert replaces,
//? and `removeRoute` on an absent id is a success.
export interface ProxyProvider {
  readonly kind: 'caddy' | 'nginx';
  //? Is the proxy reachable/usable right now? (Caddy admin up / nginx binary + conf dir.)
  available(): Promise<boolean>;
  //? Add or replace the route for `route.id`.
  upsertRoute(route: ProxyRoute): Promise<ProxyResult>;
  //? Remove the route with this id (idempotent — absent ⇒ ok).
  removeRoute(id: string): Promise<ProxyResult>;
  //? Boot self-heal: make the proxy's route set exactly `live` (prune anything stale we own).
  //? Returns the ids it pruned. Best-effort.
  reconcile(live: ProxyRoute[]): Promise<{ ok: boolean; pruned: string[] }>;
}
