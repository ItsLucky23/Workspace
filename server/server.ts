/* eslint-disable unicorn/no-abusive-eslint-disable -- server entry: argv/env side-effect imports + boot IIFE legitimately trip many rules; mirrors the framework's server/server.ts. */
/* eslint-disable */
//? Server entry. Parses positional argv first (so `config.ts` sees the
//? port), loads env, runs side-effect imports for the major config
//? registries, then hands off to `bootstrapLuckyStack` which auto-imports
//? the `luckystack/<package>/` overlay folder and calls
//? `createLuckyStackServer`.
//?
//? Argv shape:  npm run server -- <bundle[,bundle...]> [port]
//? Examples:
//?   npm run server                              (default preset, port 80)
//?   npm run server -- billing                   (one bundle, port 80)
//?   npm run server -- billing,vehicles 4001     (two bundles merged, port 4001)

//? ───────── Datadog APM (optional, enable-later) ─────────
//? Unlike Sentry / PostHog (wired from `luckystack/` overlays), Datadog can't be
//? overlay-loaded: `dd-trace` MUST be the FIRST import in the process — before
//? parseArgv and every framework module — because it patches Node core to
//? instrument I/O. So you enable it by uncommenting here. To enable:
//?   1. npm i dd-trace hot-shots
//?   2. set DD_API_KEY (+ DD_SITE, DD_TRACE_AGENT_URL) in `.env.local`
//?   3. uncomment the two lines below AND the registration block in the boot IIFE.
// import tracer from 'dd-trace';
// tracer.init();

import '@luckystack/server/parseArgv';

import { loadEnvFiles } from '@luckystack/core';
loadEnvFiles();

//? Side-effect imports — populate the registries everything below reads from.
//? config first (projectConfig), then the router topology (deploy.config +
//? services.config). A base / single-instance scaffold PRUNES the two router
//? imports (and their config files); `npx luckystack add router` / `remove router`
//? re-add / drop them post-install. The pure `config.ports` import is always kept.
import '../config';
import '../deploy.config';
import '../services.config';
import { ports } from '../config.ports';

import type { IncomingMessage, ServerResponse } from 'node:http';
import { bootstrapLuckyStack } from '@luckystack/server';
import { attachSocketRedisAdapter, getIoInstance } from '@luckystack/core';

import { registerEditorAuthCheck } from './http/editorAuthCheck';
import { registerTlsAsk } from './proxy/tlsAsk';
import { registerShortLinkRedirect } from './content/shortlinkRoute';
import { registerPublishedSiteRoute } from './deploy/siteRoute';
import { registerObservabilityEndpoints } from './obs/endpoints';
import { registerForgeWebhook } from './git/webhookRoute';
import { registerBuildDownload } from './deploy/downloadRoute';
import { registerMediaDownload } from './media/download';
import { registerMediaUpload } from './media/uploadRoute';
import { registerPublishOAuthRoutes } from './content/publishRoute';
import { registerStudioRoles } from './studio/roles';
import { registerInterviewerRole } from './interviewer/role';
import { registerScraperRole } from './scraper/role';
import { registerContentIdeatorRole } from './content/ideatorRole';
import { registerMrReviewRole } from './mr/reviewRole';
import { registerRootCauseRole } from './mr/rootCauseRole';
import { registerPlanCritiqueRole } from './reasoning/planCritiqueRole';
import { startLeaderElection } from './orchestrator/cluster';

(async () => {
  //? Optional @luckystack/secret-manager (opt-in). Resolve `.env` pointers
  //? (NAME=BASE_V<n>) against an external secret server before any framework
  //? code reads a secret. To enable:
  //?   1. npm i @luckystack/secret-manager
  //?   2. uncomment the `secretManager` slot in config.ts + set LUCKYSTACK_SECRET_MANAGER_URL
  //?   3. uncomment below. See docs/luckystack/ARCHITECTURE_SECRET_MANAGER.md.
  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }

  //? H2 fail-closed: at-rest secret encryption is mandatory. Assert the key is present
  //? (after secrets resolve) so the server never boots into a state where a stored
  //? credential would land as plaintext. Throws a clear fatal when WORKSPACES_ENC_KEY is unset.
  (await import('./crypto/secretBox')).assertEncryptionConfigured();

  //? Datadog adapter registration — uncomment together with the dd-trace block
  //? at the top of this file. `tracer` is the dd-trace instance from there.
  // const { createDatadogAdapter, registerErrorTracker } = await import('@luckystack/error-tracking');
  // const StatsD = (await import('hot-shots')).default;
  // registerErrorTracker(createDatadogAdapter({ tracer, statsd: new StatsD() }));

  //? Error tracking — activate the Sentry adapter when SENTRY_DSN is set (else it stays inactive
  //? and errors just pass through). Captures across the server via the framework's error trackers.
  if ((process.env.SENTRY_DSN ?? '').length > 0) {
    const { createSentryAdapter, registerErrorTracker } = await import('@luckystack/error-tracking');
    registerErrorTracker(createSentryAdapter());
    console.log('[server] Sentry error-tracking active.');
  }

  //? Minimal static-file fallbacks. Most apps will swap these out for
  //? Vite-built static handlers in production; the server just needs SOME
  //? handler if you serve any static asset alongside `/api` and `/sync`.
  const noopServeFile = (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  };
  const noopServeFavicon = (res: ServerResponse) => {
    res.writeHead(204);
    res.end();
  };

  //? `loadGeneratedMaps` lets the framework wire production runtime maps
  //? without you having to maintain `server/prod/runtimeMaps.ts`. The first
  //? positional argv arg selects the preset(s) (comma-separated for multi-
  //? preset boots; defaults to `default`). Generated by
  //? `scripts/generateServerRequests.ts` at build time.
  //? Edge-auth subrequest endpoint for the editor/preview subdomains (Track B5) — must be
  //? registered before the server starts handling requests.
  registerEditorAuthCheck();
  //? D3 — the Caddy on-demand-TLS ask endpoint (authorizes cert issuance only for known custom domains).
  registerTlsAsk();
  //? H3 — the trackable short-link redirect (`/l/<slug>` → click + 302 to the target with UTM passthrough).
  registerShortLinkRedirect();
  //? G3 — serve published Studio/Designer pages at /s/<slug> (public, strict-CSP, session-less).
  registerPublishedSiteRoute();
  //? Observability (#5): /healthz (liveness) + /readyz (DB+Redis readiness) + /metrics (Prometheus).
  //? Pre-params custom routes so probes don't require a session.
  registerObservabilityEndpoints();
  //? Studio module (#studio): register the designer + marketer AI roles into the AgentRole registry
  //? so automation triggers can invoke them. Pure registry write — no DB at boot.
  registerStudioRoles();
  //? Interviewer: register the schedulable idea-proposing role (so a cron trigger can run it).
  registerInterviewerRole();
  registerMrReviewRole();
  registerRootCauseRole();
  registerPlanCritiqueRole();
  //? Marketing reach: register the schedulable web-scraper role.
  registerScraperRole();
  registerContentIdeatorRole();
  //? Forge webhooks (#10): POST /webhooks/forge/<workspaceId> for continuous GitLab/GitHub issue
  //? ingest. Pre-params + shared-secret gated (WS_WEBHOOK_SECRET); disabled when unset.
  registerForgeWebhook();
  //? Build-artifact downloads (ADR 0038): GET /downloads/build/<token> serves a `docker save` tarball
  //? over a signed, TTL'd, token-gated link so a user can export a build to self-host elsewhere.
  registerBuildDownload();
  //? Media downloads (M4): GET /media/<uuid-file> streams a produced media file (voice/sfx/render) from
  //? the media store; the unguessable uuid filename is the capability, with a hard path-traversal guard.
  registerMediaDownload();
  //? Media upload (K1): POST /media/upload — authed + member-gated bring-your-own image/video → /media url.
  registerMediaUpload();
  //? X3: the public API transport (PAT-authed control-op drive).
  const { registerPublicApi } = await import('./auth/publicApiRoute');
  registerPublicApi();
  //? Publishing OAuth (FIX-C): GET /content/oauth/<platform>/{start,callback} — the connect flow that
  //? makes the server-complete YouTube/TikTok publishing reachable (session-authed start; external callback).
  registerPublishOAuthRoutes();

  const server = await bootstrapLuckyStack({
    //? Single-instance backend port from config.ports.ts. Sits BELOW a positional
    //? argv port, so `npm run server -- <preset> <port>` still wins for a
    //? multi-instance boot behind the router.
    defaultPort: ports.backend,
    serveFile: noopServeFile,
    serveFavicon: noopServeFavicon,
    loadGeneratedMaps: (preset: string) => import(`./prod/generatedApis.${preset}`),
  });

  await server.listen();

  //? Multi-instance coordination (Deel A): maintain the leadership lease so exactly one instance
  //? runs the background loops (below) + so the per-workspace write-lease is exercised. Harmless
  //? on a single instance (always the leader). See server/orchestrator/cluster.ts.
  startLeaderElection();

  //? Cross-instance realtime fan-out — only a real N-instance deploy needs it (adds Redis pub/sub),
  //? so it is opt-in. With WS_MULTI_INSTANCE=1 a broadcast on one instance reaches sockets on the
  //? others via the socket.io Redis adapter.
  if ((process.env.WS_MULTI_INSTANCE ?? '') === '1') {
    const io = getIoInstance();
    if (io) {
      attachSocketRedisAdapter(io);
      console.log('[cluster] cross-instance socket adapter attached (WS_MULTI_INSTANCE=1).');
    }
  }

  //? Recurring background jobs (watchdog, editor/worker reapers, GitLab sync, scheduled publish,
  //? metrics ingest, automation cron, demo-watch) are registered as @luckystack/cron jobs in
  //? `luckystack/cron/jobs.ts`. Cron's leader + per-run leases replace every domain-level
  //? setInterval/isLeader timer; the watchdog's runOnStart is its boot-recovery pass.
  //? R3-b — one-time migration of any legacy per-WORKSPACE repo layout into the first project's slot.
  //? Idempotent; dynamic import (secrets-order). Best-effort — never blocks boot.
  void (async () => {
    const [{ getPrismaClient }, { migrateLegacyRepoLayout }] = await Promise.all([import('@luckystack/core'), import('./git/repoStore')]);
    const prisma = getPrismaClient();
    const projects = await prisma.project.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, workspaceId: true } });
    const firstByWs = new Map<string, string>();
    for (const p of projects) if (!firstByWs.has(p.workspaceId)) firstByWs.set(p.workspaceId, p.id);
    const moved = migrateLegacyRepoLayout([...firstByWs].map(([workspaceId, projectId]) => ({ workspaceId, projectId })));
    if (moved > 0) console.log(`[R3-b] migrated ${String(moved)} legacy workspace repo(s) into their first project's slot`);
  })().catch((e: unknown) => { console.error('[R3-b] legacy repo migration error:', e); });
  //? (scheduled-publish, metrics-ingest, automation-cron, demo-watch now run via the @luckystack/cron overlay
  //? — see `luckystack/cron/jobs.ts`, ADR 0022.)
  //? Q2: index the product self-knowledge corpus (global, idempotent on the corpus hash) once at boot,
  //? leader-gated + delayed so leadership has settled. Best-effort — never blocks or breaks boot.
  const { ensureProductKnowledge } = await import('./rag/productKnowledge');
  const { ensureContentPlaybook } = await import('./rag/contentPlaybook');
  const { isLeader: isLeaderNow } = await import('./orchestrator/cluster');
  setTimeout(() => {
    if (!isLeaderNow()) return;
    void ensureProductKnowledge()
      .then((r) => { if (r.entries > 0) console.log(`[product-knowledge] indexed ${String(r.entries)} chunks (hash ${r.hash ?? ''})`); })
      .catch((e: unknown) => { console.error('[product-knowledge] ensure failed:', e instanceof Error ? e.message : String(e)); });
    //? Same shape: index the content best-practices playbook (global, idempotent on its hash) so the content
    //? AI grounds scripts on proven craft. Best-effort.
    void ensureContentPlaybook()
      .then((r) => { if (r.entries > 0) console.log(`[content-playbook] indexed ${String(r.entries)} chunks (hash ${r.hash ?? ''})`); })
      .catch((e: unknown) => { console.error('[content-playbook] ensure failed:', e instanceof Error ? e.message : String(e)); });
  }, 5000);
})().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
