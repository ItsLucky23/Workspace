# Architecture — Logging & Redaction

> Logger DI surface and the redacted-keys registry that keeps sensitive
> payload values out of stdout/log aggregators.

---

## Logger

LuckyStack does not ship a logger implementation. Instead, the framework
exposes a DI slot in `@luckystack/core`:

```typescript
import { registerLogger, getLogger } from '@luckystack/core';
```

`registerLogger(logger)` accepts any object implementing the `Logger`
interface (`debug`, `info`, `warn`, `error` methods). Default before
registration: `console`. Register once at boot from
`luckystack/server/index.ts`:

```typescript
import pino from 'pino';
import { registerLogger } from '@luckystack/core';

registerLogger(pino({ level: 'info' }));
```

Common targets:

| Logger | Why pick it |
|---|---|
| `pino` | Fast JSON output, structured logs, good for production ingestion. |
| `winston` | Multi-transport (file + console + Datadog forwarder). |
| `console` (default) | Dev-only; do not use in production. |

The framework's own modules call `getLogger()` lazily, so registration
order doesn't matter — as long as it happens before the first request.

---

## Redacted-keys registry

When framework code logs a request/response/error payload, it walks the
object and replaces values whose keys appear in the redacted-keys
registry with `'[redacted]'`. This prevents tokens, passwords, and other
sensitive values from ending up in your log aggregator.

### Built-in defaults

Out of the box, these keys are always redacted (case-insensitive):

- `password`
- `confirmpassword`
- `token`
- `newtoken`
- `authorization`
- `cookie`
- `set-cookie`

### Extending the registry

Two ways to register additional keys:

#### 1. From your overlay (`luckystack/server/index.ts`)

```typescript
import { registerRedactedLogKeys } from '@luckystack/core';

registerRedactedLogKeys([
  'ssn',
  'creditCardNumber',
  'apiSecret',
  'oneTimePasscode',
]);
```

Keys are merged into the registry. Duplicate calls are idempotent
(case-insensitive set semantics — `'SSN'` and `'ssn'` collapse to one
entry).

#### 2. From a feature package

If you author a `@luckystack/...` package that handles sensitive data,
register your domain-specific keys at module import time so consumers
never need to manually extend the list:

```typescript
// packages/my-feature/src/index.ts
import { registerRedactedLogKeys } from '@luckystack/core';
registerRedactedLogKeys(['mySecretField']);
```

The package's own logging — and any consumer that ends up logging your
payloads — automatically masks the values.

### Inspecting the registry

```typescript
import { getRedactedLogKeys, isRedactedLogKey } from '@luckystack/core';

getRedactedLogKeys();           // → readonly string[] of all registered keys
isRedactedLogKey('Authorization'); // → true (case-insensitive)
```

### Resetting (test-only)

```typescript
import { resetRedactedLogKeysForTests } from '@luckystack/core';
resetRedactedLogKeysForTests();
```

Restores the default-seed set. Never call from production — packages that
registered domain keys would have those keys re-exposed in logs.

---

## Where redaction is applied

The framework applies redaction in these locations:

| Path | What's redacted |
|---|---|
| API request entry log | The full `data` payload before the handler runs. |
| API response entry log | The full result payload before it's sent to the client. |
| Sync request entry log | The `data` payload. |
| Error capture (Sentry / error-tracking adapter) | Cookies are dropped wholesale; redacted keys masked in `extra`/`context`. |
| HTTP request headers (`/_health`, custom routes) | `Authorization`, `Cookie`, `Set-Cookie` masked. |

Custom loggers registered via `registerLogger()` receive already-redacted
payloads — you don't need to re-implement masking in your transport.

---

## Related

- [`@luckystack/core` projectConfig.logging](./ARCHITECTURE_PACKAGING.md#projectconfig) — toggles for dev logs and socket-startup logs.
- [`@luckystack/error-tracking`](./ARCHITECTURE_PACKAGING.md) — pluggable
  error-tracker adapters (Sentry / Datadog / PostHog) that consume the
  same redacted payload stream.
