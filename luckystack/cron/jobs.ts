//? Cron overlay (@luckystack/cron, ADR 0022). ONE place that registers every recurring background job.
//? Replaces the project's ad-hoc `setInterval(() => { if (isLeader()) … })` loops (the exact double-firing
//? pattern ADR 0022 was written to kill): the cron package guarantees each job fires on EXACTLY ONE instance
//? via its own Redis lease + per-run dedup, so the domain handlers no longer self-gate on `cluster.isLeader()`.
//? The scheduler starts lazily on the first registration + tears down via `preServerStop`.
//?
//? Handlers MUST be idempotent (single-Redis best-effort lease — a leader stalling past its TTL can hand over
//? mid-run). Errors surface through the package's `postCronRun` hook + the registered error-tracker.

import { getPrismaClient } from '@luckystack/core';
import { registerCronJob } from '@luckystack/cron';

import { runScheduledPublish, runMetricsIngest, PUBLISH_INTERVAL_MS, METRICS_INTERVAL_MS } from '../../server/content/publish';
import { runCommentsIngest, COMMENTS_INTERVAL_MS } from '../../server/content/commentInbox';
import { runExtractRecovery } from '../../server/orchestrator/conductor';
import { runRetentionSweep, RETENTION_INTERVAL_MS } from '../../server/retention/sweep';

//? F35 — how often the extraction-recovery sweep looks for stranded parses.
const EXTRACT_RECOVERY_MS = Math.max(60_000, Number(process.env.WS_EXTRACT_RECOVERY_MIN ?? '5') * 60_000);
import { runCronTriggers, CRON_TICK_MS } from '../../server/automation/cron';
import { drainCapacityQueue, CAPACITY_DRAIN_MS } from '../../server/orchestrator/conductor';
import { runWorkerReapTick, WORKER_REAP_MS } from '../../server/orchestrator/workerReaper';
import { runWatchdogSweep, WATCHDOG_INTERVAL_MS } from '../../server/orchestrator/watchdog';
import { reapIdleEditors, EDITOR_REAP_MS } from '../../server/proxy/editorReaper';
import { createProxyRouteReconciliationJob } from '../../server/proxy/reconciliationJob';
import { runDemoWatch, DEMO_WATCH_MS } from '../../server/deploy/demoWatch';
import { runGitlabSyncTick, SYNC_INTERVAL_MS } from '../../server/git/gitlabSync';
import { runBackup, BACKUP_INTERVAL_MS, BACKUP_ENABLED } from '../../server/db/backup';
import { runWorkspaceBuiltinsBackfill, WORKSPACE_BUILTINS_BACKFILL_MS } from '../../server/bootstrap/workspaceBuiltins';

//? O3 — fire due scheduled posts.
registerCronJob({ name: 'scheduled-publish', schedule: { everyMs: PUBLISH_INTERVAL_MS }, handler: async () => { await runScheduledPublish(getPrismaClient(), Date.now()); } });

//? #141 — refresh audience metrics for posted content.
registerCronJob({ name: 'metrics-ingest', schedule: { everyMs: METRICS_INTERVAL_MS }, handler: async () => { await runMetricsIngest(getPrismaClient()); } });

//? CI — refresh the read-only comment inbox for published posts (WS_COMMENTS_INTERVAL_MIN, default 30).
registerCronJob({ name: 'comments-ingest', schedule: { everyMs: COMMENTS_INTERVAL_MS }, handler: async () => { await runCommentsIngest(getPrismaClient()); } });

//? #2 — fire due `on:'cron'` WorkspaceTriggers (per-minute sweep; each trigger carries its own cron string).
registerCronJob({ name: 'automation-cron', schedule: { everyMs: CRON_TICK_MS }, handler: async () => { await runCronTriggers(getPrismaClient(), new Date()); } });

//? Backfill builtin skills + Designer gallery for pre-provisioning workspaces. Cron supplies cluster
//? leadership/overlap protection; every tenant write still enters the internal Conductor lane.
registerCronJob({ name: 'workspace-builtins', schedule: { everyMs: WORKSPACE_BUILTINS_BACKFILL_MS }, runOnStart: true, handler: async () => { await runWorkspaceBuiltinsBackfill(getPrismaClient()); } });

//? F35 — re-drive document extractions whose process died mid-parse (durable job + bounded attempts).
registerCronJob({ name: 'document-extract-recovery', schedule: { everyMs: EXTRACT_RECOVERY_MS }, handler: async () => { await runExtractRecovery(); } });

//? F55 — apply the workspace retention policy (opt-in per data class; a workspace with none is a no-op).
registerCronJob({ name: 'retention-sweep', schedule: { everyMs: RETENTION_INTERVAL_MS }, handler: async () => { await runRetentionSweep(getPrismaClient()); } });

//? Capacity crash backstop — evicts expired reservations and resumes one valid queued turn.
registerCronJob({ name: 'capacity-drain', schedule: { everyMs: CAPACITY_DRAIN_MS }, handler: async () => { await drainCapacityQueue(); } });

//? Fenced crash recovery + dropped-turn/reminder sweep. runOnStart replaces the old
//? one-shot boot timer; cron supplies leadership, overlap protection, and stable run dedup.
registerCronJob({ name: 'ticket-watchdog', schedule: { everyMs: WATCHDOG_INTERVAL_MS }, runOnStart: true, handler: async () => { await runWatchdogSweep(Date.now()); } });

//? Reap idle ticket worker containers.
registerCronJob({ name: 'worker-reaper', schedule: { everyMs: WORKER_REAP_MS }, handler: async () => { await runWorkerReapTick(); } });

//? Reap idle openvscode editor containers.
registerCronJob({ name: 'editor-reaper', schedule: { everyMs: EDITOR_REAP_MS }, handler: async () => { await reapIdleEditors(Date.now()); } });

//? Reconcile stale Caddy routes and re-assert live persistent-environment routes. runOnStart
//? recovers a restarted proxy; cron's leader election and per-run lease make it cluster-safe.
registerCronJob(createProxyRouteReconciliationJob());

//? D3 — redeploy demo envs whose target branch moved.
registerCronJob({ name: 'demo-watch', schedule: { everyMs: DEMO_WATCH_MS }, handler: async () => { await runDemoWatch(); } });

//? Poll linked forges for new/updated issues → tickets.
registerCronJob({ name: 'gitlab-sync', schedule: { everyMs: SYNC_INTERVAL_MS }, handler: async () => { await runGitlabSyncTick(); } });

//? Automatic DB backup (ADR 0032 DR-mandaat) — daily by default, WS_BACKUP_INTERVAL_HOURS=0 disables.
//? Restore: `npm run db:restore -- <file> --yes` (DESTRUCTIVE; see DR_RUNBOOK).
if (BACKUP_ENABLED) {
  registerCronJob({ name: 'db-backup', schedule: { everyMs: BACKUP_INTERVAL_MS }, handler: async () => {
    const res = await runBackup(getPrismaClient());
    console.log(`[backup] ${res.ok ? `wrote ${res.file ?? ''} (${String(res.docs)} docs, ${String(res.collections)} collections)` : `FAILED: ${res.error ?? ''}`}`);
  } });
}
