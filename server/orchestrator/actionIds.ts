//? Stable Mongo ObjectIds for retryable Conductor sub-writes. Mongo transactions are not
//? assumed; every multi-row stage/CI apply derives each row id from the authoritative action
//? request id, so a crash/retry can upsert or observe the same row instead of appending a copy.

import { createHash } from 'node:crypto';

export function deterministicObjectId(workspaceId: string, clientRequestId: string, part: string): string {
  return createHash('sha256')
    .update(workspaceId)
    .update('\0')
    .update(clientRequestId)
    .update('\0')
    .update(part)
    .digest('hex')
    .slice(0, 24);
}

export function stageForgeIntentId(workspaceId: string, clientRequestId: string): string {
  return deterministicObjectId(workspaceId, clientRequestId, 'stage-forge-intent');
}

export function runtimeLaunchIntentId(workspaceId: string, clientRequestId: string): string {
  return deterministicObjectId(workspaceId, clientRequestId, 'runtime-launch-intent');
}

export function runtimeLaunchCompletionId(workspaceId: string, intentId: string): string {
  return deterministicObjectId(workspaceId, intentId, 'runtime-launch-completion');
}

//? Per-service CI fans one user action out into one run PER UNIT, each needing its own durable intent.
//? The unit is NOT salted in here: it is already part of the `clientRequestId` the caller sends (see
//? `unitRequestId` in the dispatcher), and the Conductor derives these same ids from the request id it
//? receives. Salting here as well would make caller and Conductor disagree — which presents as an intent
//? that never validates rather than as an obvious error.
export function ciPublicIntentId(workspaceId: string, projectId: string, clientRequestId: string): string {
  return deterministicObjectId(workspaceId, `${projectId}:${clientRequestId}`, 'ci-public-intent');
}

export function ciPublicIntentSignalId(workspaceId: string, clientRequestId: string): string {
  return deterministicObjectId(workspaceId, clientRequestId, 'ci-public-intent-signal');
}
