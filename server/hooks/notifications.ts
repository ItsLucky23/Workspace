//? Project-side notification hooks. Reads `User.preferences` (a JSON column
//? owned by the project's Prisma schema) to decide whether to fire a
//? transactional email on a given lifecycle event.
//?
//? Wiring: `registerNotificationHooks()` is called once in
//? `luckystack/server/index.ts` (the server overlay), after the other overlays
//? have populated the registries. Hooks are no-ops if the email package isn't
//? loaded (sendEmail returns { ok: false, reason: 'no-sender' }).

import { getProjectConfig, registerHook, tryCatch, getPrismaClient } from '@luckystack/core';

interface UserPreferencesShape {
  notifyOnNewSignIn?: boolean;
  notifyOnPasswordChange?: boolean;
}

const isPreferences = (value: unknown): value is UserPreferencesShape =>
  typeof value === 'object' && value !== null;

const lazyEmail = async () => {
  //? Optional peer — resolved at runtime only when @luckystack/email is
  //? installed (forgotPassword: 'framework'). The specifier lives in a
  //? variable so the linter/bundler doesn't treat the optional peer as an
  //? unresolved static import.
  const emailModule = '@luckystack/email';
  return import(emailModule) as Promise<{
    sendEmail: (input: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }>;
    renderEmailLayout: (input: Record<string, unknown>) => { html: string; text: string };
  }>;
};

export const registerNotificationHooks = (): void => {
  registerHook('postLogin', ({ userId, provider, isNewUser }): undefined => {
    // Fire-and-forget — don't block the login response on email delivery.
    void (async () => {
      const [, ] = await tryCatch(async () => {
        if (isNewUser) return; // welcome flows belong elsewhere — only notify on returning sign-ins

        const prisma = getPrismaClient();

        const userRaw = await (prisma as { user: { findUnique: (q: unknown) => Promise<unknown> } })
          .user.findUnique({ where: { id: userId }, select: { email: true, name: true, preferences: true } });

        if (!userRaw || typeof userRaw !== 'object') return;
        const user = userRaw as { email?: string | null; name?: string | null; preferences?: unknown };
        if (typeof user.email !== 'string' || !user.email) return;
        const prefs = isPreferences(user.preferences) ? user.preferences : {};
        if (!prefs.notifyOnNewSignIn) return;

        const { sendEmail, renderEmailLayout } = await lazyEmail();
        const appUrl = (getProjectConfig().app.publicUrl || '').replace(/\/+$/, '');
        const { html, text } = renderEmailLayout({
          brand: 'LuckyStack',
          title: 'New sign-in detected',
          intro: `Hi ${user.name ?? 'there'}, a new sign-in just happened on your account using ${provider}. If this was you, you can ignore this message.`,
          ctaLabel: 'Review your sessions',
          ctaUrl: `${appUrl}/settings`,
          footer: 'You receive this because "Email me when a new sign-in happens" is on in your notification preferences.',
        });

        await sendEmail({
          to: user.email,
          subject: 'New sign-in to your account',
          html,
          text,
        });
      });
    })();
    return;
  });
};

/**
 * Fire the password-change confirmation email if the user opted in. Called
 * directly by the `settings/changePassword` API after a successful update,
 * not via a hook — there is no `postPasswordChange` hook in the framework.
 */
export const sendPasswordChangedNotification = async (userId: string): Promise<void> => {
  await tryCatch(async () => {
    const prisma = getPrismaClient();

    const userRaw = await (prisma as { user: { findUnique: (q: unknown) => Promise<unknown> } })
      .user.findUnique({ where: { id: userId }, select: { email: true, name: true, preferences: true } });

    if (!userRaw || typeof userRaw !== 'object') return;
    const user = userRaw as { email?: string | null; name?: string | null; preferences?: unknown };
    if (typeof user.email !== 'string' || !user.email) return;
    const prefs = isPreferences(user.preferences) ? user.preferences : {};
    if (!prefs.notifyOnPasswordChange) return;

    const { sendEmail, renderEmailLayout } = await lazyEmail();
    const appUrl = (getProjectConfig().app.publicUrl || '').replace(/\/+$/, '');
    const { html, text } = renderEmailLayout({
      brand: 'LuckyStack',
      title: 'Your password was changed',
      intro: `Hi ${user.name ?? 'there'}, the password on your account was just updated. Any other devices that were signed in have been signed out automatically. If this wasn't you, reset your password immediately and review your active sessions.`,
      ctaLabel: 'Open settings',
      ctaUrl: `${appUrl}/settings`,
      footer: 'You receive this because "Email me when my password is changed" is on in your notification preferences.',
    });

    await sendEmail({
      to: user.email,
      subject: 'Your password was changed',
      html,
      text,
    });
  });
};
