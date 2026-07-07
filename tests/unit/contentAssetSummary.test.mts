//? Unit test for toContentAssetSummary (server/read/mappers.ts) — the shared ContentAsset(+MediaJob)
//? → ContentAssetSummary mapper used by BOTH the snapshot and the live content-asset-delta broadcast.
//? Verifies the queue/timer fields (queuePosition, startedAt) surface from the joined job, a stub asset
//? (metadata.stub) is flagged, and a STALE in-flight asset (orphaned by a crash) is shown as error. No
//? DB, no casts — fully-typed Prisma row factories + an injected `nowMs` for deterministic staleness.

import type { ContentAsset, MediaJob } from '@prisma/client';

import { assert, eq, report } from '../_helpers.mts';

const { toContentAssetSummary } = await import('../../server/read/mappers.ts');

const T0 = new Date('2026-07-07T09:00:00Z');
const NOW = T0.getTime() + 5000; // 5s after the rows' heartbeat → fresh, not stale
function asset(over: Partial<ContentAsset> = {}): ContentAsset {
  return { id: 'a1', workspaceId: 'w1', contentProjectId: 'p1', kind: 'model-3d', url: null, storageRef: null, metadata: null, mediaJobId: 'j1', status: 'queued', createdAt: T0, updatedAt: T0, ...over };
}
function job(over: Partial<MediaJob> = {}): MediaJob {
  return { id: 'j1', workspaceId: 'w1', contentProjectId: 'p1', feature: 'model-3d', providerId: 'fal', styleId: null, input: {}, params: null, status: 'queued', queuePosition: null, startedAt: null, resultAssetId: 'a1', createdAt: T0, updatedAt: T0, ...over };
}

// 1) queued with a position → queuePosition surfaces, no startedAt, no timer
{
  const s = toContentAssetSummary(asset(), job({ queuePosition: 8 }), NOW);
  eq(s.status, 'queued', 'status passes through');
  eq(s.queuePosition, 8, 'queue position from the job');
  assert(s.startedAt === undefined, 'no startedAt while queued');
  eq(s.url, '', 'null url -> empty string');
}

// 2) processing → startedAt (epoch ms) surfaces, queuePosition cleared
{
  const started = new Date('2026-07-07T09:00:03Z');
  const s = toContentAssetSummary(asset({ status: 'processing', updatedAt: started }), job({ queuePosition: null, startedAt: started, updatedAt: started }), NOW);
  eq(s.status, 'processing', 'processing status');
  eq(s.startedAt, started.getTime(), 'startedAt as epoch ms -> the timer anchor');
  assert(s.queuePosition === undefined, 'queuePosition cleared once running');
}

// 3) ready asset without a job (job=null) → plain summary, no queue fields
{
  const s = toContentAssetSummary(asset({ status: 'ready', url: '/media/out.glb', mediaJobId: null }), null, NOW);
  eq(s.url, '/media/out.glb', 'real url passes through');
  assert(s.queuePosition === undefined && s.startedAt === undefined, 'no queue/timer fields without a job');
}

// 4) stub flag from metadata
{
  const s = toContentAssetSummary(asset({ status: 'ready', metadata: { stub: true } }), null, NOW);
  assert(s.stub === true, 'metadata.stub -> stub true');
  const real = toContentAssetSummary(asset({ status: 'ready', metadata: { foo: 1 } }), null, NOW);
  assert(real.stub === false, 'non-stub metadata -> stub false');
}

// 5) STALE in-flight (orphaned by a crash — no heartbeat for >20 min) → shown as error, no timer
{
  const staleNow = T0.getTime() + 25 * 60 * 1000; // 25 min after the last heartbeat
  const s = toContentAssetSummary(asset({ status: 'processing' }), job({ status: 'running', startedAt: T0, queuePosition: null }), staleNow);
  eq(s.status, 'error', 'a >20min-idle in-flight asset is surfaced as error (never spins forever)');
  assert(s.startedAt === undefined, 'no timer once treated as timed-out');
  //? A FRESH heartbeat (job updated recently) keeps it in-flight even if created long ago.
  const fresh = toContentAssetSummary(asset({ status: 'processing' }), job({ status: 'running', startedAt: T0, updatedAt: new Date(staleNow - 1000) }), staleNow);
  eq(fresh.status, 'processing', 'a recent job heartbeat keeps it processing');
}

report('tests/unit/contentAssetSummary.test.mts');
