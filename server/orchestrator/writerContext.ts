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

export type WriterScope = string;
export const GLOBAL_WRITER_SCOPE: WriterScope = 'global';

interface WriterContext {
  scope: WriterScope;
  active: boolean;
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

//? Called only at the Conductor's executeAction boundary. Same-scope nesting is
//? harmless; crossing into another workspace (or global scope) fails loudly.
export function runInWriterContext<T>(scope: WriterScope, fn: () => Promise<T>): Promise<T> {
  const activeScope = currentWriterScope();
  if (activeScope !== null) {
    if (activeScope !== scope) throw new WriterContextMismatchError(activeScope, scope);
    return fn();
  }

  const context: WriterContext = { scope, active: true };
  return storage.run(context, () => Promise.resolve().then(fn).finally(() => {
    context.active = false;
  }));
}
