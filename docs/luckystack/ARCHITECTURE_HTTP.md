# HTTP request pipeline, custom routes & webhooks

> How `@luckystack/server` dispatches a raw Node HTTP request, the two
> custom-route phases, and the **server-to-server webhook / streaming-upload
> seam** (origin-exempt paths + pre-params raw-body routes). Read alongside
> `docs/ARCHITECTURE_API.md` (the typed `/api/*` layer) and
> `docs/ARCHITECTURE_ROUTING.md`.

## Request pipeline (order matters)

Every request flows through `handleHttpRequest` (`packages/server/src/httpHandler.ts`) in this order:

1. **Origin policy** (`enforceOriginPolicy`) — fail-closed: a state-changing method (`POST`/`PUT`/`DELETE`) with **no** `Origin` and **no** `Referer` is `403`'d. This is the browser-CSRF baseline. **Registered origin-exempt prefixes skip this step** (see below).
2. **Security headers + `preHttpRequest` hook** — instrumentation / IP allow-lists (can stop a request, cannot grant an exemption).
3. **`OPTIONS`** → `204`.
4. **CSRF** (`enforceCsrfOnStateChangingRequest`) — only for cookie-mode framework routes (`/api/`, `/sync/`, `/auth/api/`) with a session token. Custom paths outside those prefixes are not subject to CSRF.
5. **PRE-PARAMS routes** — framework fast-paths (`/auth/csrf`, health probes, favicon, `_test/reset`) **and then consumer `'pre-params'` custom routes**. These run **before the body is read**, so the raw `req` stream is intact.
6. **`getParams`** — drains + parses the body (`application/json` or `x-www-form-urlencoded`), enforcing `http.requestBodyMaxBytes` (default **1 MiB**). After this point the body is gone.
7. **POST-PARAMS routes** — `/uploads`, `/auth/*`, `/api/*`, `/sync/*`, the default (`'post-params'`) custom routes, then the static/SPA fallback.

The key consequence: a `'post-params'` custom route can **never** read the raw body (step 6 already consumed it), and an `Origin`-less webhook is **rejected at step 1** before any route runs. The two seams below solve exactly that.

## Custom routes — two phases

`registerCustomRoute(handler, { phase })` (`@luckystack/server`):

| Phase | When | `req` body | Use for |
|---|---|---|---|
| `'post-params'` (default) | step 7 | already parsed | normal project HTTP endpoints (the back-compat default) |
| `'pre-params'` | step 5 | **raw, undrained** | webhooks (HMAC over raw body) + streaming/multipart uploads (bypass the 1 MiB cap) |

**Pre-params contract:** a handler that starts reading the body **MUST** send its own response and return `true`. Returning `false` *without* consuming the body falls through to the normal pipeline. Handlers run in registration order, after the framework fast-paths.

## Origin-exempt paths (webhooks)

`registerOriginExemptPath({ pathPrefix })` (`@luckystack/server`) removes the step-1 origin gate for paths under `pathPrefix`. Empty by default — **opt-in only**.

> ### ⚠️ Security model — exemption is NOT authentication
> Origin exemption only removes the *browser* origin check. It does **not**
> authenticate the caller. An exempt handler **MUST** verify the request
> itself: an HMAC/signature over the raw body, a shared-secret header, or mTLS.
> Treat an exempt path as publicly reachable.
>
> - Keep webhooks on a **dedicated prefix** (e.g. `/webhooks/`). **Never** register a prefix that overlaps framework routes (`/api`, `/auth`, `/sync`) — that would punch a hole in the framework's own CSRF/origin protection.
> - Add `checkRateLimit(...)` on verification endpoints to blunt brute-force.
> - Exemption is prefix-matched and curated by you; an unregistered path stays fail-closed.

## Worked example — GitLab merge webhook (HMAC over the raw body)

```ts
// luckystack/server/index.ts (overlay, loaded last at boot)
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

const WEBHOOK_PREFIX = '/webhooks/gitlab';
registerOriginExemptPath({ pathPrefix: WEBHOOK_PREFIX });

const readRawBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const verify = (raw: Buffer, signature: string | undefined): boolean => {
  if (!signature) return false;
  const expected = createHmac('sha256', process.env.GITLAB_WEBHOOK_SECRET ?? '').update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
};

registerCustomRoute(async (req, res, ctx) => {
  //? Not our route → return false WITHOUT touching the body so the pipeline
  //? continues normally.
  if (ctx.method !== 'POST' || !ctx.routePath.startsWith(WEBHOOK_PREFIX)) return false;

  const raw = await readRawBody(req);                    // raw body available — pre-params phase
  const sig = Array.isArray(req.headers['x-gitlab-signature'])
    ? req.headers['x-gitlab-signature'][0]
    : req.headers['x-gitlab-signature'];
  if (!verify(raw, sig)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', errorCode: 'webhook.badSignature' }));
    return true;
  }

  const payload = JSON.parse(raw.toString('utf8')) as unknown;
  // ... enqueue the merge job ...
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'success' }));
  return true;
}, { phase: 'pre-params' });
```

> GitLab also supports a plaintext `X-Gitlab-Token` header instead of an HMAC —
> in that case compare `req.headers['x-gitlab-token']` and you do not need to
> read the raw body, but you still need the origin exemption.

## Worked example — streaming/multipart upload (past the 1 MiB cap)

```ts
import { extractTokenFromRequest, processUpload } from '@luckystack/core';
import { getSession } from '@luckystack/login';
import { registerCustomRoute } from '@luckystack/server';

registerCustomRoute(async (req, res, ctx) => {
  if (ctx.method !== 'POST' || ctx.routePath !== '/uploads/audio') return false;

  //? Authenticate manually — pre-params routes run before the framework's
  //? param/auth pipeline. Reuse the framework token + session helpers verbatim.
  const token = extractTokenFromRequest(req);
  const session = token ? await getSession(token) : null;
  if (!session?.id) {
    res.writeHead(401); res.end(); return true;
  }

  //? Stream `req` straight to disk / your multipart parser (busboy, formidable,
  //? raw octet-stream — the framework ships no parser, so no forced dependency)
  //? — the 1 MiB JSON cap does NOT apply here. Then bracket with the upload
  //? hooks so onUploadStart / onUploadComplete still fire.
  const { buffer, contentType, fileName } = await collectUpload(req); // your parser
  const result = await processUpload({
    userId: session.id,
    contentType,
    buffer,
    fileName,
    uploadKind: 'audio',
    encodeAndSave: async (buf) => writeToStore(fileName, buf), // returns final byte size
  });

  const status = result.status === 'success' ? 200 : result.status === 'rejected' ? 422 : 500;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
  return true;
}, { phase: 'pre-params' });
```

## Verifying it end-to-end

- **Webhook reaches the handler:** `curl -X POST http://localhost:<port>/webhooks/gitlab -H 'X-Gitlab-Signature: <hmac>' --data-binary @payload.json` → `200` (not `403`). Without the signature header → your handler's `401`.
- **Origin gate still fail-closed elsewhere:** `curl -X POST http://localhost:<port>/api/examples/foo` with no `Origin` → still `403`. Registering `/webhooks/` must not change this.
- **Upload past 1 MiB:** POST a >1 MiB body to `/uploads/audio` → no `413` (the cap is bypassed for the streaming route); a >1 MiB body to any `/api/*` route → still `413`.
- **Unit coverage:** `packages/server/src/originExemptRegistry.test.ts` (prefix matching, fail-closed default, no framework-route bleed) + the `phases` block in `customRoutesRegistry.test.ts`.
