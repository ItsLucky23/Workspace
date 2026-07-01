---
name: sync-server-client-pair
title: Sync server + client pair with room fanout
pattern: sync-pair
tags: [sync, realtime, room-fanout, server-handler, client-handler, i18n]
---

# Sync server + client pair with room fanout

## When to use

Reach for a sync route when one client's mutation must be validated once on the
server and then fanned out to every peer in a room (collab boards, chat,
multiplayer state). The `_server` file is mandatory; add the `_client` file ONLY
when a recipient needs a payload the server can't compute once for everyone
(per-viewer filtering, per-locale translation, per-recipient auth). For plain
request/response with no fanout use `apiRequest` (`@luckystack/api`) instead, and
for pure online/offline presence use `@luckystack/presence`.

## Canonical example

```ts
// src/board/_sync/moveCard_server_v1.ts
// Runs ONCE per request: auth-gate, validate, mutate, then the framework fans
// the returned serverOutput out to every socket in `receiver`.
import { AuthProps, SessionLayout } from '../../../config';
import {
  Functions,
  SyncServerResponse,
} from '../../_sockets/apiTypes.generated';

export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { cardId: string; toLane: string };
  user: SessionLayout; // non-null because auth.login === true
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  clientInput,
  user,
  functions,
}: SyncParams): Promise<SyncServerResponse> => {
  // No raw try/catch — surface a stable i18n errorCode on failure.
  const [error, card] = await functions.tryCatch.tryCatch(
    functions.db.card.update({
      where: { id: clientInput.cardId },
      data: { laneId: clientInput.toLane },
    }),
  );
  if (error || !card) return { status: 'error', errorCode: 'board.cardMoveFailed' };

  // Everything except `status` becomes `serverOutput` for every recipient.
  return {
    status: 'success',
    cardId: card.id,
    toLane: clientInput.toLane,
    privateNotes: card.privateNotes,
    movedBy: user.id,
  };
};
```

```ts
// src/board/_sync/moveCard_client_v1.ts
// OPTIONAL — runs ONCE per recipient socket. Here it strips `privateNotes`
// from anyone who is not the card owner. Receives `token`, never `user`.
import {
  Functions,
  SyncClientResponse,
  SyncClientInput,
  SyncServerOutput,
} from '../../_sockets/apiTypes.generated';

type PagePath = 'board';
type SyncName = 'moveCard';

export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  token: string | null; // recipient's token (resolve a session only if needed)
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  token,
  serverOutput,
  functions,
}: SyncParams): Promise<SyncClientResponse> => {
  const recipient = token ? await functions.session.getSession(token) : null;
  const isOwner = recipient?.id === serverOutput.movedBy;

  // clientOutput is per-recipient; serverOutput stays identical for everyone.
  return { status: 'success', privateNotes: isOwner ? serverOutput.privateNotes : null };
};
```

```tsx
// src/board/page.tsx — originator fires the sync, every tab in the room subscribes.
import { useEffect } from 'react';
import { i18nNotify as notify } from '@luckystack/core/client';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

export const BoardSync = ({ roomCode }: { roomCode: string }) => {
  const { upsertSyncEventCallback } = useSyncEvents();

  // Subscribe: callback payload is fully typed from the generated sync map.
  useEffect(() => {
    return upsertSyncEventCallback({
      name: 'board/moveCard',
      version: 'v1',
      callback: ({ serverOutput, clientOutput }) => {
        if (serverOutput.status !== 'success') return;
        applyMove(serverOutput.cardId, serverOutput.toLane, clientOutput.privateNotes);
      },
    });
  }, [upsertSyncEventCallback]);

  // Originator: send the mutation into the room.
  const moveCard = async (cardId: string, toLane: string) => {
    const response = await syncRequest({
      name: 'board/moveCard',
      version: 'v1',
      data: { cardId, toLane },
      receiver: roomCode,
    });
    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
    }
  };

  return <BoardGrid onMove={moveCard} />;
};
```

## Why this shape

- **`_server` is the single source of truth.** It runs exactly once: auth-gates
  on `AuthProps`, validates `clientInput` (Zod, from the generated schema), does
  the mutation, and returns the envelope. Everything except `status` becomes
  `serverOutput` and is broadcast identically to every recipient. Putting the
  write here — not in `_client` — is what keeps the room consistent.
- **`_client` exists only because it makes a per-recipient decision.** Stripping
  `privateNotes` for non-owners is something the server can't bake into one
  shared payload, so it earns its place. If this file only returned
  `{ status: 'success' }` you would delete it: the framework's no-client branch
  already emits `serverOutput` with `clientOutput: {}` at materially lower cost
  (no per-socket handler invocation). Adding an empty `_client` is pure overhead.
- **`_client` gets `token`, not `user`.** The framework deliberately skips a
  Redis session lookup for every recipient — most `_client` files don't need the
  session. Call `functions.session.getSession(token)` only when you actually
  branch on it, as here.
- **Errors are stable i18n keys, never human text.** `_server` returns
  `errorCode: 'board.cardMoveFailed'`; the UI resolves it through the
  i18n-backed `notify` (`notify.error({ key })`) at the call site. Returning a
  sentence in `errorCode` breaks translation and the error contract.
- **`functions.tryCatch.tryCatch` over raw try/catch.** It yields the
  `[error, result]` tuple and routes the failure to Sentry via the registered
  error-tracker. The handler stays linear and every failure maps to a code.
- **Typed route/version literals end-to-end.** `syncRequest` and
  `upsertSyncEventCallback` are called with the `name`/`version` literals so the
  generated map infers `serverOutput`/`clientOutput` — no `as any`, no local
  `unsafe*` wrapper. If inference lags after a save, run `npm run generateArtifacts`
  rather than casting around it.
- **Room-scoped fanout via `receiver`.** Passing `roomCode` limits delivery to
  that room and, with the Redis adapter, crosses server instances automatically.
  A second tab in the same room receives the move with zero extra wiring.
