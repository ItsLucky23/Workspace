//? Workspaces — transactional invite email.
//?
//? Fire-and-forget: sends the "you've been invited" email via the OPTIONAL
//? `@luckystack/email` peer, which auto-selects its sender from env (Resend when
//? `RESEND_API_KEY` is set, else SMTP, else a console no-op). Never throws into the
//? Conductor chain — a delivery failure is logged, not propagated, so the invite
//? row (the authoritative state) is unaffected.

import { getProjectConfig, tryCatch } from '@luckystack/core';

//? Indirected module id so the bundler treats `@luckystack/email` as a runtime-only
//? optional peer (mirrors `server/hooks/notifications.ts`).
const lazyEmail = async () => {
  const emailModule = '@luckystack/email';
  return import(emailModule) as Promise<{
    sendEmail: (input: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }>;
    renderEmailLayout: (input: Record<string, unknown>) => { html: string; text: string };
  }>;
};

export async function sendInviteEmail(toEmail: string, workspaceName: string): Promise<void> {
  const [error] = await tryCatch(async () => {
    const { sendEmail, renderEmailLayout } = await lazyEmail();
    const appUrl = (getProjectConfig().app.publicUrl || '').replace(/\/+$/, '');
    const { html, text } = renderEmailLayout({
      brand: 'Workspaces',
      title: `You've been invited to ${workspaceName}`,
      intro: `You've been invited to join the "${workspaceName}" workspace. Sign in — or create an account — with THIS email address to accept the invitation.`,
      ctaLabel: 'View invitation',
      ctaUrl: `${appUrl}/workspaces`,
      footer: "If you weren't expecting this invitation you can safely ignore this email.",
    });
    await sendEmail({ to: toEmail, subject: `Invitation to join ${workspaceName}`, html, text });
  });
  if (error) console.error('[invite] email send failed:', error);
}
