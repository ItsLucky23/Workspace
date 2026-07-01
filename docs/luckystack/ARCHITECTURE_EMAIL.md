# Email architecture

> See also: [`packages/email/README.md`](../packages/email/README.md) for the full public API and adapter setup.

LuckyStack treats transactional email as a **plug-in**: framework code never depends on a specific provider. Adapters are registered at server boot via a registry in `@luckystack/core`, mirroring how the project handles `notify`, the Sentry adapter, and `projectConfig`.

## Why a separate package

`@luckystack/email` is a separate optional package because:

- A consumer who only installs `@luckystack/core + @luckystack/login` and picks `auth.forgotPassword: 'custom'` (or `'disabled'`) shouldn't pull in `resend` or `nodemailer`.
- Custom adapters (Postmark, SES, Mailgun, in-house API) live in user space alongside the built-in three — the registry is the public seam.
- Login can call `getEmailSender()` from core *as a type-only check* without ever importing the email package, so its build graph stays clean.

## Files

| File | Purpose |
| --- | --- |
| `packages/core/src/emailRegistry.ts` | The registry: `EmailSender`, `EmailMessage`, `EmailResult` types + `registerEmailSender / getEmailSender / isEmailSenderRegistered`. |
| `packages/email/src/sendEmail.ts` | The single helper framework + project code calls. Handles missing-sender policy, terminal logging, Sentry capture (no-ops if not installed). |
| `packages/email/src/renderEmailLayout.ts` | Tiny HTML+text template helper. One CTA button optional. No external deps. |
| `packages/email/src/adapters/console.ts` | `ConsoleSender()` — dev default, never sends. |
| `packages/email/src/adapters/resend.ts` | `ResendSender({ apiKey, from })` — wraps the official `resend` SDK (lazy-imported). |
| `packages/email/src/adapters/smtp.ts` | `SmtpSender({ host, port, secure, auth, from })` — wraps `nodemailer` (lazy-imported). |

## Registry pattern

Identical shape to `sentrySetup.ts`. Both are values that live in core but are populated by an optional package.

```ts
// core/src/emailRegistry.ts (simplified)
let active: EmailSender | null = null;
export const registerEmailSender = (sender: EmailSender) => { active = sender; };
export const getEmailSender = () => active;
```

Login's forgot-password code:

```ts
import { getEmailSender, getProjectConfig } from '@luckystack/core';

if (config.auth.forgotPassword === 'framework' && !getEmailSender()) {
  throw new Error('forgotPassword="framework" requires a registered email sender. Install @luckystack/email.');
}
```

## Boot wiring

`server/server.ts` picks an adapter based on env vars and registers it once before `bootstrapLuckyStack`:

```ts
if (process.env.RESEND_API_KEY) {
  registerEmailSender(ResendSender({ apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM }));
} else if (process.env.SMTP_HOST) {
  registerEmailSender(SmtpSender({ host, port, ... }));
} else {
  registerEmailSender(ConsoleSender());
}
```

`ConsoleSender` is the safe default — it logs the rendered email to terminal so devs can see what would have been sent.

`autoSelectEmailSender(opts?)` reads the env-var *names* from `ProjectConfig.email.envVars` (typed as `EmailEnvVarsConfig`) so installers can rename `RESEND_API_KEY` → `MY_APP_RESEND_KEY` etc. without forking. Numeric fallbacks live in `ProjectConfig.email.defaults` (`EmailDefaultsConfig`, currently just `smtpPort`). Both sub-shapes are re-exported from `@luckystack/core`.

## Sending

```ts
import { sendEmail, renderEmailLayout } from '@luckystack/email';

const { html, text } = renderEmailLayout({
  brand: 'LuckyStack',
  title: 'Verify your address',
  intro: 'Click below to verify your account.',
  ctaLabel: 'Verify',
  ctaUrl: 'https://app.example.com/verify?token=...',
  footer: 'You received this because someone signed up at example.com.',
});

const result = await sendEmail({
  to: 'user@example.com',
  subject: 'Verify your address',
  html,
  text,
});

if (!result.ok) {
  // result.reason === 'no-sender' | provider error message
}
```

`sendEmail` always returns a typed result instead of throwing — matches the rest of the framework's `[error, value]` pattern.

## Sentry interplay

When `@luckystack/error-tracking` is installed and initialized, `sendEmail` errors are auto-reported via `captureException` from `@luckystack/core`. When it isn't, the call is a silent no-op — no special detection needed.

Terminal logging is independent: `email.logging.errors` and `email.logging.sends` flip the console output regardless of Sentry state.

## Send-time hooks

`sendEmail` dispatches `preEmailSend` before calling the registered sender and `postEmailSend` after, regardless of success or failure. These fire for every send — application-driven mail AND framework-mode password-reset emails alike — so audit consumers see the complete trail without having to wrap the helper.

```ts
import { registerHook } from '@luckystack/core';

registerHook('preEmailSend', async ({ message, adapter }) => {
  // Audit / suppression list / DLQ
  if (await isOnSuppressionList(message.to)) {
    return { stop: true, errorCode: 'email.suppressed' };
  }
});

registerHook('postEmailSend', async ({ adapter, messageId, reason, ok }) => {
  if (!ok) await alertOps({ adapter, reason });
});
```

Payload fields (concrete shape lives in `packages/email/src/hookPayloads.ts`):

- `preEmailSend` — `{ message: EmailMessage, adapter: string }`. Return a stop signal to abort. The dispatcher honors the signal and `sendEmail` returns `{ ok: false, reason: signal.errorCode }`.
- `postEmailSend` — `{ adapter: string, messageId?: string, reason?: string, ok: boolean }` (plus the original `message` summary). `messageId` is set on success, `reason` on failure.

## Login flow integration

`auth.forgotPassword` in `ProjectConfig`:

| Value | Behavior |
| --- | --- |
| `'disabled'` (default) | "Forgot password?" link doesn't render. APIs respond `forgotPasswordDisabled`. |
| `'framework'` | Login package ships the `/reset-password` pages + APIs. Calls `sendEmail` with the reset link. **Requires a registered email sender.** |
| `'custom'` | Login exports primitives (`createPasswordResetToken`, `consumePasswordResetToken`, `updatePasswordHash`); consumer wires their own UI + email. |

`auth.providerAccountStrategy`:

| Value | Behavior |
| --- | --- |
| `'per-provider'` (default) | Same email via Google and GitHub creates two separate User rows. Current schema works as-is. |
| `'unified'` | Same email maps to a single User. Requires schema migration documented in `packages/login/README.md`. |

## Writing your own adapter

```ts
import type { EmailSender } from '@luckystack/email';

export const PostmarkSender = (opts: { token: string; from: string }): EmailSender => ({
  name: 'postmark',
  send: async (message) => {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': opts.token,
      },
      body: JSON.stringify({
        From: message.from ?? opts.from,
        To: Array.isArray(message.to) ? message.to.join(',') : message.to,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, reason: `postmark-${String(res.status)}`, cause: await res.text() };
    }
    const data = await res.json() as { MessageID: string };
    return { ok: true, id: data.MessageID };
  },
});
```

Then register it in your boot file:

```ts
registerEmailSender(PostmarkSender({ token: process.env.POSTMARK_TOKEN, from: 'noreply@you.com' }));
```

## Related

- `packages/email/README.md` — install + quickstart + per-adapter setup steps
- `docs/ARCHITECTURE_AUTH.md` — the wider auth + session architecture (forgot-password ties into here)
- `packages/core/src/sentrySetup.ts` — the pattern this registry mirrors
