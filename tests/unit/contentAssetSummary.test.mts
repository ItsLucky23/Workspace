//? Unit test for toContentAssetSummary (server/read/mappers.ts) — the shared ContentAsset(+MediaJob)
//? → ContentAssetSummary mapper used by BOTH the snapshot and the live content-asset-delta broadcast.
//? Verifies the queue/timer fields (queuePosition, startedAt) surface only from the joined job, and a
//? stub asset (metadata.stub) is flagged. No DB, no casts — fully-typed Prisma row factories.

import type { ContentAsset, MediaJob } from '@prisma/client';

import { assert, eq, report } from '../_helpers.mts';

const { toContentAssetSummary } = await import('../../server/read/mappers.ts');

const EPOCH = new Date('2026-07-07T09:00:00Z');
function asset(over: Partial<ContentAsset> = {}): ContentAsset {
  return { id: 'a1', workspaceId: 'w1', contentProjectId: 'p1', kind: 'model-3d', url: null, storageRef: null, metadata: null, mediaJobId: 'j1', status: 'queued', createdAt: EPOCH, updatedAt: EPOCH, ...over };
}
function job(over: Partial<MediaJob> = {}): MediaJob {
  return { id: 'j1', workspaceId: 'w1', contentProjectId: 'p1', feature: 'model-3d', providerId: 'fal', styleId: null, input: {}, params: null, status: 'queued', queuePosition: null, startedAt: null, resultAssetId: 'a1', costCents: 0, error: null, createdAt: EPOCH, updatedAt: EPOCH, ...over };
}

// 1) queued with a position → queuePosition surfaces, no startedAt, no timer
{
  const s = toContentAssetSummary(asset(), job({ queuePosition: 8 }));
  eq(s.status, 'queued', 'status passes through');
  eq(s.queuePosition, 8, 'queue position from the job');
  assert(s.startedAt === undefined, 'no startedAt while queued');
  eq(s.url, '', 'null url → empty string');
}

// 2) processing → startedAt (epoch ms) surfaces, queuePosition cleared
{
  const started = new Date('2026-07-07T10:00:00Z');
  const s = toContentAssetSummary(asset({ status: 'processing' }), job({ queuePosition: null, startedAt: started }));
  eq(s.status, 'processing', 'processing status');
  eq(s.startedAt, started.getTime(), 'startedAt as epoch ms → the timer anchor');
  assert(s.queuePosition === undefined, 'queuePosition cleared once running');
}

// 3) ready asset without a job (job=null) → plain summary, no queue fields
{
  const s = toContentAssetSummary(asset({ status: 'ready', url: '/media/out.glb', mediaJobId: null }), null);
  eq(s.url, '/media/out.glb', 'real url passes through');
  assert(s.queuePosition === undefined && s.startedAt === undefined, 'no queue/timer fields without a job');
}

// 4) stub flag from metadata
{
  const s = toContentAssetSummary(asset({ status: 'ready', metadata: { stub: true } }), null);
  assert(s.stub === true, 'metadata.stub → stub true');
  const real = toContentAssetSummary(asset({ status: 'ready', metadata: { foo: 1 } }), null);
  assert(real.stub === false, 'non-stub metadata → stub false');
}

report('tests/unit/contentAssetSummary.test.mts');
