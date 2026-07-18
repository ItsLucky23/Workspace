//? Server-only Conductor operations. These are deterministic background writes,
//? never browser/Assistant ControlOps: no client union, RBAC catalogue, proposal
//? catalogue, or public sync allowlist may import them.

import type { ExtractStatus } from '../documents/parseUpload';
import type { ForgeSnapshot } from '../git/gitlabSync';
import type { ForgeIssueEvent } from '../git/webhookIngest';
import {
  enqueueInternalWriterAction,
  type EnqueueControlActionOptions,
  type EnqueuedControlAction,
} from './conductor';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

interface InternalActionBase {
  workspaceId: string;
  //? Provenance only: internal actions never use this identity as an RBAC grant.
  userId: string;
  clientRequestId: string;
}

export interface DocumentAssetTextInternalAction extends InternalActionBase {
  op: 'document-set-asset-text';
  target: { documentId: string };
  payload: { url: string; text: string; status: ExtractStatus };
}

export interface ForgeEventInternalAction extends InternalActionBase {
  op: 'forge-event-apply';
  target: Record<string, never>;
  payload: { event: ForgeIssueEvent; acceptedAt: number };
}

export interface ForgeSnapshotInternalAction extends InternalActionBase {
  op: 'forge-snapshot-apply';
  target: { projectId: string };
  payload: { snapshot: ForgeSnapshot };
}

export type InternalAction =
  | DocumentAssetTextInternalAction
  | ForgeEventInternalAction
  | ForgeSnapshotInternalAction;
export type InternalOp = InternalAction['op'];

type AssertNoPublicOverlap<T extends never> = T;
export type _InternalOpsAreNotControlOps = AssertNoPublicOverlap<Extract<InternalOp, ControlOp>>;

export type EnqueueInternalActionOptions = EnqueueControlActionOptions;

//? The only typed entry point for server-internal writer actions. The Conductor
//? supplies the same durable signal, tenant scope, renewable lease, serial queue,
//? and terminal dedup as public control actions, under a distinct dedup namespace.
export function enqueueInternalAction(
  action: InternalAction,
  options: EnqueueInternalActionOptions = {},
): Promise<EnqueuedControlAction> {
  return enqueueInternalWriterAction(action, options);
}
