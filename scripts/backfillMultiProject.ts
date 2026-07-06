/// <reference types="node" />

//? One-off backfill for ADR 0035 (multi-project / multi-service, item A1).
//? Sets `Sprint.projectId` on legacy rows written before sprints were project-scoped
//? → their workspace's FIRST project (the single-project era's only project). Uses
//? `$runCommandRaw` (raw Mongo) because a freshly-required field is MISSING on legacy
//? rows, so a normal `prisma.sprint.findMany()` would fail Prisma's result validation
//? before we could patch it. Idempotent: only touches rows with no `projectId`.
//? Mirrors scripts/prismaWithSecrets.ts's env-resolution preamble (secret-manager
//? DATABASE_URL pointer). Safe to run repeatedly.

import { loadEnvFiles } from '@luckystack/core';

interface RawId { $oid: string }
interface RawProject { _id: RawId; workspaceId: RawId }
interface RawSprint { _id: RawId; workspaceId: RawId; projectId?: RawId }
interface RawFindResult { cursor?: { firstBatch?: unknown[] } }

const run = async (): Promise<void> => {
  loadEnvFiles();
  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // 1. Build workspaceId → first projectId map (oldest project per workspace).
    const projRaw = (await prisma.$runCommandRaw({
      find: 'Project', filter: {}, sort: { _id: 1 }, projection: { workspaceId: 1 },
    })) as unknown as RawFindResult;
    const projects = (projRaw.cursor?.firstBatch ?? []) as RawProject[];
    const firstProjectByWs = new Map<string, string>();
    for (const p of projects) {
      const ws = p.workspaceId?.$oid;
      if (ws && !firstProjectByWs.has(ws)) firstProjectByWs.set(ws, p._id.$oid);
    }

    // 2. Find legacy sprints (no projectId) and patch each to its workspace's first project.
    const sprintRaw = (await prisma.$runCommandRaw({
      find: 'Sprint', filter: { projectId: { $exists: false } },
    })) as unknown as RawFindResult;
    const sprints = (sprintRaw.cursor?.firstBatch ?? []) as RawSprint[];

    let patched = 0;
    let orphaned = 0;
    for (const s of sprints) {
      const ws = s.workspaceId?.$oid;
      const projId = ws ? firstProjectByWs.get(ws) : undefined;
      if (!projId) { orphaned += 1; continue; }
      await prisma.$runCommandRaw({
        update: 'Sprint',
        updates: [{ q: { _id: { $oid: s._id.$oid } }, u: { $set: { projectId: { $oid: projId } } } }],
      });
      patched += 1;
    }

    console.log(`[backfill 0035] projects=${projects.length} legacy-sprints=${sprints.length} patched=${patched} orphaned=${orphaned}`);
  } finally {
    await prisma.$disconnect();
  }
};

void run();
