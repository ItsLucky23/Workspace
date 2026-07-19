//? Conductor writer context. Authoritative workspace writes can gradually call
//? `assertWriterContext(...)` without threading proof through every domain helper.
//? The context is active only while the Conductor executes one action; durable
//? signal append/dedup plumbing runs outside it.
//?
//? Login-only tenant-creation/accept-invite actions have no workspace lease or
//? tenant yet. They are serialized by the existing global chain and execute in
//? the explicit `global` writer scope instead of pretending an empty workspace is
//? tenant-scoped.

import { AsyncLocalStorage } from 'node:async_hooks';

import { currentWorkspaceId } from '../tenant/tenantContext';

export type WriterScope = string;
export const GLOBAL_WRITER_SCOPE: WriterScope = 'global';

interface WriterLeaseGuard {
  assertHeld(): void;
}

interface WriterContext {
  scope: WriterScope;
  active: boolean;
  leaseGuard?: WriterLeaseGuard;
  activeDedupKeys: ReadonlySet<string>;
}

const storage = new AsyncLocalStorage<WriterContext>();

export class WriterContextMismatchError extends Error {
  constructor(
    public readonly activeScope: WriterScope,
    public readonly requestedScope: WriterScope,
  ) {
    super(`[writer] cannot enter ${requestedScope} while ${activeScope} is active`);
    this.name = 'WriterContextMismatchError';
  }
}

//? A non-throwing probe for gradual enforcement and tests. Descendant async work
//? may retain the ALS store, so `active` is cleared as soon as executeAction ends;
//? such detached work correctly observes no writer context afterward.
export function currentWriterScope(): WriterScope | null {
  const context = storage.getStore();
  return context?.active === true ? context.scope : null;
}

export function assertWriterContext(expectedScope?: WriterScope): WriterScope {
  const scope = currentWriterScope();
  if (scope === null) throw new Error('[writer] no active Conductor writer context');
  if (expectedScope !== undefined && scope !== expectedScope) {
    throw new WriterContextMismatchError(scope, expectedScope);
  }
  return scope;
}

//? Dedup keys follow the async call tree, not a process-global mutable set. A nested action therefore
//? sees every active ancestor key while parallel sibling branches do not become false ancestors.
export function hasActiveWriterDedupKey(dedupKey: string): boolean {
  const context = storage.getStore();
  return context?.active === true && context.activeDedupKeys.has(dedupKey);
}

//? Reentrant Conductor enqueues may reuse only the renewable lease attached to the
//? active execute boundary. A hand-built writer ALS scope is not lease ownership.
export function assertWriterLeaseHeld(expectedScope: WriterScope): void {
  assertWriterContext(expectedScope);
  const context = storage.getStore();
  if (context?.active !== true || context.leaseGuard === undefined) {
    throw new Error('[writer] no active workspace lease in Conductor writer context');
  }
  context.leaseGuard.assertHeld();
}

//? Domain mutation boundaries use this stricter workspace assertion: writer
//? ownership without the matching tenant ALS would still permit an unscoped or
//? cross-tenant raw Prisma write.
export function assertWorkspaceWriterContext(workspaceId: string): void {
  assertWriterContext(workspaceId);
  if (currentWorkspaceId() !== workspaceId) {
    throw new Error('[writer] tenant context does not match the writer workspace');
  }
}

//? Called only at the Conductor's executeAction boundary. Same-scope nesting is
//? harmless; crossing into another workspace (or global scope) fails loudly.
export function runInWriterContext<T>(
  scope: WriterScope,
  fn: () => Promise<T>,
  leaseGuard?: WriterLeaseGuard,
  dedupKey?: string,
): Promise<T> {
  const parent = storage.getStore();
  const activeScope = currentWriterScope();
  if (activeScope !== null && activeScope !== scope) {
    throw new WriterContextMismatchError(activeScope, scope);
  }
  if (activeScope !== null && dedupKey === undefined) return fn();

  const activeDedupKeys = new Set(parent?.active === true ? parent.activeDedupKeys : []);
  if (dedupKey !== undefined) activeDedupKeys.add(dedupKey);
  const inheritedLeaseGuard = parent?.active === true ? parent.leaseGuard : undefined;
  const context: WriterContext = {
    scope,
    active: true,
    activeDedupKeys,
    ...((inheritedLeaseGuard ?? leaseGuard) === undefined ? {} : { leaseGuard: inheritedLeaseGuard ?? leaseGuard }),
  };
  return storage.run(context, () => Promise.resolve().then(fn).finally(() => {
    context.active = false;
  }));
}
