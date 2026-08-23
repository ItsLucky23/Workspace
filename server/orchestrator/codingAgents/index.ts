//? Coding-agent registry — resolve a workspace's CodingAgentConfig to the adapter that drives its PTY turns.
//? @adr 0322

import type { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '@luckystack/core';

import type { CodingAgentConfig } from '../../../src/workspaces/_data/types';
import { claudeCodeAdapter } from './claudeCode';
import { CODING_AGENT_KEY, parseStoredCodingAgent } from './config';
import { piAgentAdapter } from './piAgent';
import type { CodingAgentAdapter } from './types';

export type { CodingAgentAdapter, TurnArgsInput, RunDocker } from './types';
export * from './config';

export function adapterFor(cfg: CodingAgentConfig): CodingAgentAdapter {
  return cfg.harness === 'pi-agent' ? piAgentAdapter(cfg.subscription) : claudeCodeAdapter;
}

//? The workspace's stored config (default when the row is absent) — read by the stage runner per turn and by
//? the snapshot builder.
export async function loadCodingAgent(workspaceId: string, prisma: PrismaClient = getPrismaClient()): Promise<CodingAgentConfig> {
  const row = await prisma.envVar.findFirst({ where: { workspaceId, key: CODING_AGENT_KEY }, select: { value: true } });
  return parseStoredCodingAgent(row?.value ?? null);
}
