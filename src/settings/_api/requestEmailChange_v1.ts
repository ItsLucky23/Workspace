//? `validator` is CommonJS; its .d.ts does not declare a default export but
//? Node's CJS interop provides one at runtime. ESM named-import trips the
//? runtime ESM loader. Using namespace-access on the default import is the
//? canonical CJS-interop pattern that lint-rules also accept.
// eslint-disable-next-line import-x/default
import validator from 'validator';
import { dispatchHook } from '@luckystack/core';
import { sendEmailChangeConfirmation, verifyPassword } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 5;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  //? LOGIN-EMAILCHG: `currentPassword` is required for credentials-provider
  //? accounts. A session-hijack (stolen cookie / XSS) that can change the
  //? email locks the real owner out permanently because the confirm link goes
  //? to the NEW (attacker-controlled) address. Collecting the current password
  //? at initiation time prevents the attack — only someone who already knows
  //? the credential can start the change flow.
  data: { newEmail: string; currentPassword?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const newEmail = data.newEmail.trim().toLowerCase();

  // eslint-disable-next-line import-x/no-named-as-default-member
  if (!newEmail || !validator.isEmail(newEmail)) {
    return { status: 'error', errorCode: 'settings.emailChange.invalidEmail' };
  }
  if (newEmail === user.email.toLowerCase()) {
    return { status: 'error', errorCode: 'settings.emailChange.emailSameAsCurrent' };
  }

  //? LOGIN-EMAILCHG: require and verify the current password before initiating
  //? an email change for credentials-provider accounts. OAuth accounts have no
  //? stored password so the check is skipped for them (the provider session is
  //? the re-auth proof). An empty or missing `currentPassword` is rejected
  //? before the DB read so there is no timing difference between "no password
  //? supplied" and "wrong password" — both return the same errorCode.
  if (user.provider === 'credentials') {
    const currentPassword = data.currentPassword ?? '';
    if (!currentPassword) {
      return { status: 'error', errorCode: 'settings.emailChange.currentPasswordRequired' };
    }
    const dbUser = await functions.db.prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    const storedHash = dbUser?.password ?? null;
    if (!storedHash) {
      return { status: 'error', errorCode: 'settings.emailChange.currentPasswordRequired' };
    }
    const passwordOk = await verifyPassword(currentPassword, storedHash);
    if (!passwordOk) {
      return { status: 'error', errorCode: 'settings.emailChange.wrongCurrentPassword' };
    }
  }

  //? ADR — DD-ROOTSRC-O6: do NOT reveal whether the new address is already
  //? taken to the authenticated caller. Returning `auth.emailTaken` here lets
  //? any logged-in user enumerate the full credentials-account address space
  //? with a trivial script. The reset-password flow already uses this pattern:
  //? `sendPasswordResetEmail` returns `{ ok: true }` for unknown addresses.
  //? We apply the same anti-enumeration posture here: silently succeed without
  //? sending a token when the address is owned by another user. The
  //? `confirmEmailChange` step is the hard guard — it re-checks the address is
  //? still free and rejects at that point (the DB unique index on email is the real
  //? race backstop; the check itself is not transactional). The real user sees
  //? "email change requested" in the UI; no confirmation arrives (the email
  //? simply isn't sent), which is sufficient UX signal. A GDPR / abuse-report
  //? handler can hook `postEmailChangeRequested` where `sent: false` flags the
  //? silent-drop case.
  const existing = await functions.db.prisma.user.findFirst({
    where: { email: newEmail, provider: 'credentials' },
    select: { id: true },
  });
  if (existing && existing.id !== user.id) {
    //? Silent no-op: don't reveal the address is taken (anti-enumeration).
    //? No token is minted; no email is sent. Return success so the caller
    //? can't distinguish "taken" from "sent" at the HTTP layer.
    void dispatchHook('postEmailChangeRequested', {
      userId: user.id,
      currentEmail: user.email,
      newEmail,
      sent: false,
    });
    return { status: 'success' };
  }

  //? Vetoable pre-hook. Lets compliance / approval / 2FA add-ons abort the
  //? change with their own errorCode before any token is minted.
  const preChange = await dispatchHook('preEmailChange', {
    userId: user.id,
    currentEmail: user.email,
    newEmail,
  });
  if (preChange.stopped) {
    return { status: 'error', errorCode: preChange.signal.errorCode };
  }

  const result = await sendEmailChangeConfirmation({
    userId: user.id,
    newEmail,
    userName: user.name,
  });

  //? LOGIN-EMAILCHG: notify the OLD address so the real owner is alerted to
  //? the pending change and can take action (e.g. contact support) if they did
  //? not initiate it. Wire this via the `postEmailChangeRequested` hook so
  //? consumers can use their own email template/adapter without forking this
  //? file. The hook receives `currentEmail` for that purpose.
  void dispatchHook('postEmailChangeRequested', {
    userId: user.id,
    currentEmail: user.email,
    newEmail,
  });

  if (!result.ok) {
    return { status: 'error', errorCode: 'settings.emailChange.emailSendFailed' };
  }
  return { status: 'success' };
};
