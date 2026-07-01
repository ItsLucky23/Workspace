# Skill: audit-sync-pairing

Scan every `src/**/_sync/` folder and flag orphaned sync files — a `_client_v<N>.ts` without a paired `_server_v<N>.ts` (or vice versa where the server's `clientOutput` field expects per-client filtering).

## When to use

- After refactors that delete sync logic — easy to remove the server file and forget the client.
- Before publishing a release.
- As part of dead-code reviews.

## The pairing rules (mirrored from `docs/ARCHITECTURE_SYNC.md`)

- `_server_v<N>.ts` is REQUIRED for any sync route. It owns validation + fanout.
- `_client_v<N>.ts` is OPTIONAL — only needed when per-client logic is required (filtering, per-client auth, custom `clientOutput`). If your server `main` only returns `{ status: 'success' }`, you don't need a client file.
- A `_client_v<N>.ts` WITHOUT a `_server_v<N>.ts` is **broken** — the client handler will never run because the server never validated the call.
- A `_server_v<N>.ts` that declares a non-trivial `clientOutput` type (anything other than `void` or the same shape as `serverOutput`) but has no `_client_v<N>.ts` is **suspicious** — the typed contract suggests per-client logic but it's not implemented.

## Workflow

### 1. Discover sync files

Glob `src/**/_sync/*_server_v*.ts` and `src/**/_sync/*_client_v*.ts` (skip `.tests.ts`).

For each, parse:

- `pagePath`: folder structure before `_sync/`
- `syncName`: filename without `_server_v<N>.ts` / `_client_v<N>.ts` suffix
- `version`: `v<N>`

Build a Map keyed by `pagePath/syncName/version` with `{ serverFile?, clientFile? }`.

### 2. Find orphans

Iterate the map:

- `clientFile` set, `serverFile` not set → **ORPHAN_CLIENT** (broken)
- `serverFile` set, `clientFile` not set → potentially **MISSING_CLIENT** (only if server file references `clientOutput`)

For `MISSING_CLIENT`: read the server file content. Grep for `clientOutput`. If found AND it's not `clientOutput: void`, flag as `MISSING_CLIENT`.

### 3. Report

```
[audit-sync-pairing]
  ORPHAN_CLIENT (1):
    src/chat/_sync/sendMessage_client_v1.ts
      No paired _server_v1.ts — this handler will never fire.
      Fix: create sendMessage_server_v1.ts OR delete the orphan.

  MISSING_CLIENT (2):
    src/feed/_sync/postUpdate_server_v1.ts
      Declares `clientOutput` shape but no client file exists.
      Fix: create postUpdate_client_v1.ts with the per-client filtering logic,
           OR drop `clientOutput` from the server type.
    src/notifications/_sync/broadcast_server_v1.ts
      Same diagnosis.

  OK (8):
    src/chat/_sync/joinRoom_server_v1.ts + joinRoom_client_v1.ts   (paired)
    src/playground/_sync/echo_server_v1.ts                          (server-only, void clientOutput)
    ...
```

### 4. Offer fixes

For `ORPHAN_CLIENT`:

- Suggest creating the server file via the existing scaffold flow (the framework's template injector handles empty files automatically — just `touch src/.../sendMessage_server_v1.ts` and save).
- OR offer to delete the orphan via Bash + user confirmation. Read the file first; if it has non-trivial code, recommend keeping it and adding the server instead.

For `MISSING_CLIENT`:

- Read the server file's `clientOutput` shape.
- Suggest a stub client file that returns that shape, with TODO for the per-client logic.
- OR suggest dropping `clientOutput` from the server type signature (mass-search for any callers of this sync that read clientOutput first — if none, the field is dead).

## Example finding + correction

```
src/chat/_sync/sendMessage_client_v1.ts → ORPHAN_CLIENT
```

This client handler will never run. Two valid fixes:

1. **Create the server file** (more common):

   ```bash
   touch src/chat/_sync/sendMessage_server_v1.ts
   ```

   The framework's template injector populates it with the standard sync_server template on save.

2. **Delete the orphan** (if the feature was abandoned):

   ```bash
   git rm src/chat/_sync/sendMessage_client_v1.ts
   ```

   Read the file first to make sure it doesn't contain useful logic worth preserving.

## Not in scope

- The skill doesn't validate that the server's `clientInput` matches what the client side sends. Type generation catches that.
- The skill doesn't enforce that paired files declare consistent types — generated types make mismatches a build error.
