# Architecture — Testing

> Spec for LuckyStack's two test systems: vitest **unit tests** (package internals) and the `@luckystack/test-runner` **integration** layers. Last updated 2026-06-02.

## TL;DR

LuckyStack has **two independent test systems**:

```
npx vitest run                              # UNIT tests — framework/package internals, no server, ~1s
npm run test                                # INTEGRATION tests — your API/sync routes, needs a live server
npm run scaffold:test <page>/<name>/<v>     # create a per-route integration-test stub
```

- **Unit tests (vitest)** — fast, no infrastructure. Test pure functions / building blocks inside the `@luckystack/*` packages (and your own helpers).
- **Integration auto-sweep (`@luckystack/test-runner`)** — runs against every endpoint automatically. You write nothing.
- **Integration per-route tests** — live next to the route source. You write one file per route for the business-logic the sweep can't reach.

See "Two test systems" below for when to use which.

---

## Two test systems

| | Unit tests (vitest) | Integration tests (`@luckystack/test-runner`) |
|---|---|---|
| **What it tests** | Pure functions / building blocks: *"does `validatePassword('abc')` return the right reason key?"* | Whole routes end-to-end: *"does `POST /api/settings/updateUser` behave correctly?"* |
| **Needs a server?** | No — Node sandbox, mocks DB/Redis/socket. | Yes — `npm run server` + real Redis + Prisma. |
| **How to run** | `npx vitest run` (~1s) | `npm run test` (after booting the server) |
| **File suffix / location** | `*.test.ts` next to the code (`packages/*/src/**`, your `src/_functions/**`). | `*.tests.ts` next to the route (`src/<page>/_api/<name>_v<N>.tests.ts`). |
| **Who writes them** | You / the AI, for non-trivial logic. | Auto-sweep is free; you write per-route `.tests.ts` for business logic. |

Rule of thumb: **unit = does this function compute the right value?** · **integration = does this route behave correctly when wired to everything?**

> Note the suffix: vitest unit files end in **`.test.ts`**; integration per-route files end in **`.tests.ts`** (plural). The two runners discover different suffixes, so they never collide.

---

## Unit tests (vitest)

Unit tests verify a single function in isolation — no server, DB, or network. The framework packages are built around DI registries (`registerPrismaClient`, `registerRedisClient`, `registerLogger`, `getProjectConfig`, …) precisely so their logic can be tested by swapping those seams for mocks.

### Running

```
npx vitest run        # run once (CI / pre-commit)
npx vitest            # watch mode while developing
```

Config lives in the root `vitest.config.ts` (Node environment, includes `packages/*/src/**/*.test.ts`). Unit-test files are excluded from `lint:packages`, so test-only patterns don't trip the framework lint rules.

### Anatomy of a unit test

```ts
import { describe, it, expect } from 'vitest';
import { tryCatch } from './tryCatch';

describe('tryCatch', () => {
  it('returns [null, result] when the function resolves', async () => {
    const [error, result] = await tryCatch(async () => 42);
    expect(error).toBeNull();
    expect(result).toBe(42);
  });

  it('returns [error, null] when the function throws', async () => {
    const boom = new Error('boom');
    const [error, result] = await tryCatch(async () => { throw boom; });
    expect(error).toBe(boom);
    expect(result).toBeNull();
  });
});
```

`describe` groups related cases; `it` is one case; `expect(...)` asserts. That is the whole model.

### Mocking a dependency

When the code under test imports a sibling module, replace it with `vi.mock` so the test stays pure. Example — testing the default user adapter with no real database:

```ts
import { describe, it, expect, vi } from 'vitest';

//? Replace @luckystack/core's `prisma` proxy with a fake delegate of spies.
const prismaUser = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@luckystack/core', () => ({ prisma: { user: prismaUser } }));

import { defaultPrismaUserAdapter } from './userAdapter';

describe('defaultPrismaUserAdapter', () => {
  it('findById delegates to prisma.user.findUnique', async () => {
    prismaUser.findUnique.mockResolvedValue({ id: 'u1', token: 't', email: 'a@b.test' });
    const result = await defaultPrismaUserAdapter().findById('u1');
    expect(result?.id).toBe('u1');
    expect(prismaUser.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });
});
```

`vi.fn()` is a spy you can assert on; `vi.mock(module, factory)` swaps a whole import; `vi.hoisted(...)` lets the spy exist both inside the hoisted mock and in the test body; `vi.useFakeTimers()` controls timers.

### What to unit-test (and what NOT to)

- **Do**: pure functions (parsers, validators, formatters, key-builders, math), registry add/read/clear, branch coverage of policy logic, DI-injected logic with the seam mocked.
- **Don't**: anything needing a live socket / Redis / Prisma / HTTP — that belongs in the integration layer. If a test needs real infrastructure to pass, write it as a per-route `.tests.ts` instead.

### Adding tests in the future

- **New framework-package function** → add a `<name>.test.ts` next to it → `npx vitest run`.
- **New helper in your app** (`src/_functions/*`) → same: a `*.test.ts` next to it.
- The AI can author these for you — it reads the real exports/signatures and writes the cases. Just ask.

---

## Integration tests (`@luckystack/test-runner`)

The two layers below run against a **live server** (`npm run test`).

---

## Layer 1 — Auto-sweep

Built into `@luckystack/test-runner`. Walks `apiMethodMap` (the generated route registry in `src/_sockets/apiTypes.generated.ts`) and runs four progressive checks against every endpoint:

| Check | What it asserts | Implementation |
|---|---|---|
| **Contract** | Endpoint returns a `{ status: 'success' \| 'error', … }` envelope without crashing on a minimal valid input. Catches "endpoint throws an unhandled exception on the happy path". | `runContractTests()` (`contractCheck.ts`) |
| **Auth enforcement** | Endpoints with `auth.login: true` reject unauthenticated calls with `errorCode: 'auth.required'`. Catches "I marked the route as login-required but never actually enforced it". | `runAuthEnforcementTests()` (`authEnforcementCheck.ts`) |
| **Rate limit** | After `rateLimit + 1` calls in a window, the endpoint rejects with `errorCode: 'api.rateLimitExceeded'`. Catches "I configured a rate limit but it's not wired". | `runRateLimitTests()` (`rateLimitCheck.ts`) |
| **Fuzz** | Endpoint doesn't 5xx or hang on junk inputs (null, deeply nested, prototype pollution, NaN, etc.). Catches input-validation gaps. | `runFuzzTests()` (`fuzzCheck.ts`) |

You add nothing for these. Every new route gets them for free.

---

## Layer 2 — Per-route business-logic tests

For assertions the sweep can't infer:

- **Post-conditions** — "did the `postRegister` hook fire with the right payload?", "was a row inserted?", "did the cache get invalidated?"
- **Integration** — "logging in user A doesn't leak user B's data into the session"
- **Edge cases** — boundary values that are technically valid but business-meaningful
- **Idempotency** — calling the route twice with the same input is safe (or correctly rejects)

### File location and naming

| Route source | Test file |
|---|---|
| `src/<page>/_api/<name>_v<N>.ts` | `src/<page>/_api/<name>_v<N>.tests.ts` |
| `src/<page>/_sync/<name>_server_v<N>.ts` | `src/<page>/_sync/<name>_server_v<N>.tests.ts` |

The runner discovers files by the `.tests.ts` suffix alongside route source. Filename binds the test to the route — you don't repeat the path inside.

### File format

```ts
import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/updateUser/v1`. The auto-sweep already
//? covers contract validation, auth enforcement, rate-limit clamp, and
//? fuzz crash-resistance. Add cases below for business-logic assertions
//? the sweep can't reach.
//?
//? Suggested scenarios:
//? [ ] Happy path with valid input → expected output shape + side effects
//? [ ] Authenticated user A cannot affect user B's data
//? [ ] Post-conditions: did the expected hook fire? row inserted?
//? [ ] Edge case: missing optional field, boundary values
//? [ ] Idempotency: calling twice with the same input is safe (if applicable)

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path updates name and email',
    run: async (ctx) => {
      const session = await ctx.session.login();
      const result = await ctx.callApi({ name: 'Alice', email: 'alice@example.com' });
      ctx.expect.eq(result.status, 'success');

      const updated = await ctx.prisma.user.findUnique({ where: { id: session.userId } });
      ctx.expect.eq(updated?.name, 'Alice');
      ctx.expect.eq(updated?.email, 'alice@example.com');
    },
  },
  {
    name: 'cannot update another user',
    run: async (ctx) => {
      const victim = await ctx.session.login({ email: 'victim@example.com' });
      await ctx.session.logout();
      const attacker = await ctx.session.login({ email: 'attacker@example.com' });

      const result = await ctx.callApi({ targetUserId: victim.userId, name: 'pwned' });
      ctx.expect.eq(result.status, 'error');
    },
  },
];
```

### `TestContext` shape

```ts
export interface TestContext {
  /** Invoke the route under test (page/name/version baked in from the filename). */
  callApi: <TInput, TOutput>(input: TInput) => Promise<TOutput>;
  callSync: <TInput, TOutput>(input: TInput, opts?: { receiver?: string }) => Promise<TOutput>;

  /** Session helpers — reuse the same fixtures the auth-enforcement sweep uses. */
  session: {
    login: (user?: { email?: string; id?: string }) => Promise<{ token: string; userId: string }>;
    logout: () => Promise<void>;
    current: () => { token: string | null; userId: string | null };
  };

  /** Direct Prisma client for state assertions. */
  prisma: PrismaClient;

  /** Minimal assertion helpers — no external dependency. */
  expect: {
    eq: <T>(actual: T, expected: T, message?: string) => void;
    ok: (value: unknown, message?: string) => void;
    throws: (fn: () => unknown, message?: string) => Promise<Error>;
    matches: (value: string, pattern: RegExp, message?: string) => void;
  };
}
```

### `CustomTestCase` shape

```ts
export interface CustomTestCase {
  name: string;
  run: (ctx: TestContext) => Promise<void>;
  /**
   * Optional. Marks this case as a KNOWN, accepted failure (a documented bug
   * not yet fixed, or a scenario the implementation can't satisfy yet). The
   * string is the reason shown in the report.
   *   • marked + throws  → reported as `xfail` (expected — NOT a red failure)
   *   • marked + passes  → reported as `xpass` (remove the stale marker)
   */
  expectedToFail?: string;
}
```

Throw from `run` to fail the case. The thrown error's message — plus the server's actual `errorCode` from the last `callApi`/`callSync` response — is included in the output. The runner catches; one failing case does not stop the others.

A negative test (one that asserts *that* something fails) is **green** when the expected error occurs — use `ctx.expect.throws(...)` or assert `result.status === 'error'`. Do NOT mark such a case `expectedToFail`: that marker is only for *acknowledged real bugs*, never for "this test verifies a rejection".

---

## Coverage notes — what isn't per-route tested (and why)

A few surfaces have no `*.tests.ts` **by design** — not an oversight:

- **Credentials login (`/auth/api/credentials`)** — login is a *server-wired* route owned by `@luckystack/server`, **not** a file-based `_api` route, so the per-route harness (which discovers `src/**/_api/*.tests.ts`) cannot target it and there is no `login_v1.tests.ts`. The auth surface IS covered indirectly: the **auth-enforcement sweep** proves every `auth.login: true` route rejects anonymous callers; the **session** (`system/session/v1`) and **logout** (`system/logout/v1`) per-route tests cover session read + teardown shape; and `@luckystack/login`'s vitest unit tests cover `validatePassword` / session key-builders / oauth guards in isolation. The actual credentials round-trip (and OAuth) is an integration/developer concern — boot the server and exercise it manually, exactly like Microsoft OAuth.
- **Pages (`page.tsx`)** — React route components are not exercised by this server-side harness; use a browser/E2E tool for page-level coverage.
- **`playground/throwError`** — a deliberate-error diagnostic route (its `main` always throws). The fuzz layer now accepts its controlled `500` error envelope (a caught throw is graceful handling, not a crash), so it passes; it is not a meaningful business-logic target.

---

## Running tests

```
npm run test                          # all layers, all routes
npm run test -- --no-fuzz             # skip the fuzz layer (faster local iteration)
npm run test -- --no-sweep            # only per-route custom tests
npm run test -- --only-custom         # alias for --no-sweep
npm run test -- --filter settings     # only routes whose path matches the substring
```

Exit code 0 if all pass, 1 if any failed. The CLI prints a per-route table and a final summary count.

### Side effects

Tests hit the real Prisma client + Redis. Run them against your dev environment (`.env.local`) — they will mutate state. Conventions:

- Use unique emails / identifiers per test (e.g. `test-${nanoid()}@example.com`) so cases don't collide.
- Clean up in your test logic when feasible — but the framework does NOT auto-rollback. Consider a dedicated test database if isolation matters.

---

## Creating a new test stub

```
npm run scaffold:test <page>/<name>/<version>
```

Example: `npm run scaffold:test settings/updateUser/v1` creates `src/settings/_api/updateUser_v1.tests.ts` with:

- Boilerplate imports.
- Comment block listing common scenarios as a TODO checklist.
- The route's input shape inlined as a comment (from `apiTypes.generated.ts`) so you don't have to look it up.
- One placeholder `CustomTestCase` that throws `TODO: implement this test case` — replace with real assertions.

The script refuses to overwrite an existing test file. If you want to regenerate, delete the old one first.

The CLAUDE.md "Testing" section requires running this for every new route and filling in at least one happy-path case before declaring done.

---

## Extending the sweep with a custom layer

The framework ships an `extensionRegistry` so consumers can add their own sweep layer (e.g. "every endpoint must have a specific custom header"). Call `registerTestLayer({ name, run })` at boot before invoking the runner. See `packages/test-runner/src/extensionRegistry.ts` for the contract. Per-route business-logic tests are the right tool for endpoint-specific assertions; custom sweep layers are for cross-cutting checks.

---

## Reading the output (failures, expected-failures, skips)

The runner prints a **colored**, list-based report. Per layer you get a green `X/Y passed` headline (red `Z/Y failed` when something broke), followed by up to four sections and a one-line summary:

```
  ✓ contract           28/28 passed
  ✓ auth-enforcement   19/19 passed
  ✓ rate-limit          6/6 passed   · 11 skipped
  ✓ fuzz               18/18 passed
  ✗ custom             62/63 passed  1/63 failed   · 1 expected-fail

Failed — must be fixed (real bugs / wrong tests) (1)
  ✗ settings/updateUser/v1 :: cannot update another user
      expected "error" but got "success" (server: —)

Expected failures — known issues, allowed to fail (1)
  ⚠ billing/refund/v1 :: full refund path
      not-yet-implemented refund gateway (tracked in #412)

Skipped — not run (with reason) (11)
  – rate-limit: settings/updateUser/v1
      login-required route — set TEST_AUTH_TOKEN to rate-limit-test it

Summary: 90 passed  ·  1 failed  ·  1 expected-fail  ·  11 skipped
  legend: ✗ red = must fix · ⚠ yellow = known/allowed · – skipped (not run)
```

How to read it — the colour tells you whether you need to act:

| Bucket | Colour | Meaning | Action |
|---|---|---|---|
| **passed** | green | Did what the test asserts (including negative tests where the asserted error occurred). | none |
| **Failed — must be fixed** | red ✗ | A real bug *or* a wrong test. **Red never means "supposed to be red".** | fix the route, or fix the test |
| **Expected failures** | yellow ⚠ | Case marked `expectedToFail` and failed as expected — a tracked, accepted known issue. | fix when you get to it; not a regression |
| **Unexpectedly passed** | yellow ? | Case marked `expectedToFail` but passed. | remove the stale marker |
| **Skipped** | dim – | Not run in this mode, with the reason (login-gated without `TEST_AUTH_TOKEN`, `rateLimit` above `maxRateLimitToTest`, explicitly skipped). | none, unless you want the coverage |

Each failed item shows `<route> :: <case>`, the assertion message, and the **server's actual `errorCode`** in parentheses (e.g. `(server: api.rateLimitExceeded)`) when the failure came from a rejected request — so you see *why* the server said no, not just the failed expectation. The colour is auto-disabled when stdout isn't a TTY (piped to a file / CI) or when `NO_COLOR` is set; force it with `FORCE_COLOR=1`.

> "Tests that fail but are supposed to fail" → those are either **negative tests** (which are GREEN — the rejection is the pass condition) or **`expectedToFail` known-issues** (which appear yellow in their own section). A test in the red **Failed** bucket is always something to act on.

### Machine-readable output

The full `RunAllTestsSummary` (every layer, every result with `status` / `reason` / `errorCode`, plus `xfailed` / `xpassed` counts on the custom layer) is written to `test-results.json` (override with `TEST_OUTPUT_FILE`, gitignored). Parse that instead of scraping the terminal.

The route path + test case name are always in the output so you can jump straight to the failing assertion.
