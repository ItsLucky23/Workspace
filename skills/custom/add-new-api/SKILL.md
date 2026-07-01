# Skill: add-new-api

Add a new API endpoint to a LuckyStack page under `src/{page}/_api/`.

LuckyStack uses file-based routing for APIs. Creating the file is enough; the dev server hot-reloads and the type generator picks up the new endpoint automatically.

## Workflow

### 1. Decide page, name, and version

- **Page**: the feature folder under `src/`, e.g. `settings`, `organization-settings`, `dashboard`.
- **Name**: action verb + noun, e.g. `updatePreferences`, `sendInvite`.
- **Version**: start at `v1`. Bump only when the request/response contract changes in a breaking way; old version files can stay in place during a deprecation window.

The resulting file lives at `src/{page}/_api/{name}_v{n}.ts`, and the runtime route becomes `api/{page}/{name}/v{n}`.

### 2. Create the file from this template

```typescript
import type { Functions } from 'src/_sockets/apiTypes.generated';
import type { SessionLayout } from 'config';
import type { AuthProps } from '@luckystack/core';

export const rateLimit: number | false = 60;
export const method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: {
    // typed input here
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams) => {
  // implementation goes here
  return { status: 'success' as const, result: {} };
};
```

Important notes about the template:

- Always export `rateLimit`, `method`, `auth`, and `main`. Missing exports cause the loader to reject the route.
- Use the `functions` parameter for `tryCatch`, `db`, `redis`, `notify`, session helpers, etc. Do not import these directly.
- Return values MUST follow `{ status: 'success' | 'error' | ..., result?: ..., code?: ... }`. The discriminant drives the generated client types.

### 3. Let hot-reload pick up the file

The dev server (`npm run dev`) watches `src/**/_api/*.ts`. No restart needed. The new route is callable on the next request.

If hot-reload does not pick the file up:

- Verify the filename matches `{name}_v{number}.ts` exactly (lowerCamelCase name, `_v` separator, integer version).
- Verify the file is under `_api/` (private folder marker `_`), not `api/`.

### 4. Call it from the client

```typescript
import { apiRequest } from 'src/_sockets/apiRequest';

const response = await apiRequest({
  name: '{page}/{name}',
  version: 'v{n}',
  data: { /* typed input */ },
});

if (response.status !== 'success') return;
// response.result is now narrowed to the success shape from the generated map
```

Do NOT cast `data` or the response to `unknown` / `any`. If inference fails, regenerate types instead of bypassing them.

### 5. Verify generated types

After the file is saved, `src/_sockets/apiTypes.generated.ts` is rewritten by the type generator (devkit). Open it and confirm:

- Your new route appears under the `ApiMap` union.
- Both input (`data`) and output (`result`) types are correctly inferred.

If the generator did not pick up the file, restart the dev supervisor.

### 6. Decisions to make consciously

Before merging, double-check each of these:

- **`rateLimit`**: is `60` requests/minute appropriate, or does this endpoint need stricter / looser limits? Use `false` only for internal admin-style routes.
- **`auth.login`**: does this endpoint require a logged-in session? If `false`, justify in a comment.
- **`auth.additional`**: list any required additional checks (role, organization-membership, ownership) here. The loader enforces them before `main` runs.
- **Error codes**: when returning `{ status: 'error', code: '...' }`, use a stable string code so the i18n layer on the client can map it to a translation key.
- **Validation**: input validation is enforced by the generated Zod schema (`apiInputSchemas.generated.ts`). Make sure the input interface is precise (no `any`, no overly loose unions).

### 7. Deep dive

For routing details (private folders, versioning rules, dynamic params), see [`docs/ARCHITECTURE_ROUTING.md`](../../../docs/ARCHITECTURE_ROUTING.md).

For the API request lifecycle (rate-limit, auth, validation, Sentry, response shape), see [`docs/ARCHITECTURE_API.md`](../../../docs/ARCHITECTURE_API.md).
