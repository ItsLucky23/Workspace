import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useSearchParams } from 'react-router-dom';
import { faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { loginPageUrl } from 'config';
import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';
import AuthShell, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS, AUTH_STEP_MOTION, PasswordField } from 'src/_components/AuthShell';
import { apiRequest } from 'src/_sockets/apiRequest';

export const template = 'plain';

export default function ResetPasswordPage() {
  const translate = useTranslator();
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') ?? '', [params]);

  return (
    <AuthShell
      footer={
        <Link to={loginPageUrl} className="text-primary hover:text-primary-hover font-medium cursor-pointer">
          {translate({ key: 'login.resetBackToLogin' })}
        </Link>
      }
    >
      {token ? <ConfirmForm token={token} /> : <RequestForm />}
    </AuthShell>
  );
}

//? Both success states used to be a plain body paragraph — identical in weight and colour to the
//? intro copy above them, so the one durable confirmation a user gets (the toast expires) was easy
//? to skim straight past. A check icon + the semantic `correct` colour makes it read as a state.
function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-container1-border bg-container2 p-3 text-sm text-correct">
      <FontAwesomeIcon icon={faCircleCheck} className="mt-0.5 shrink-0" />
      <span className="font-medium">{children}</span>
    </div>
  );
}

function RequestForm() {
  const translate = useTranslator();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (loading) return;
    const email = inputRef.current?.value.trim() ?? '';
    if (!email) return;

    setLoading(true);
    const response = await apiRequest({
      name: 'reset-password/sendReset',
      version: 'v1',
      data: { email },
    });
    setLoading(false);

    if (response.status === 'success') {
      setSubmitted(true);
      notify.success({ key: 'login.resetEmailSent' });
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5 w-full">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{translate({ key: 'login.resetTitle' })}</h1>
        <p className="text-xs text-common">{translate({ key: 'login.resetIntro' })}</p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {submitted ? (
          <motion.div key="sent" {...AUTH_STEP_MOTION}>
            <SuccessNote>{translate({ key: 'login.resetCheckInbox' })}</SuccessNote>
          </motion.div>
        ) : (
          <motion.div key="form" {...AUTH_STEP_MOTION} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <label htmlFor="reset-email" className="font-medium text-xs">
                {translate({ key: 'login.emailAddress' })}
              </label>
              <input
                id="reset-email"
                ref={inputRef}
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                className={AUTH_INPUT_CLASS}
              />
            </div>
            <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
              {loading ? translate({ key: 'login.loading' }) : translate({ key: 'login.resetSendLink' })}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}

function ConfirmForm({ token }: { token: string }) {
  const translate = useTranslator();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  //? `null` until the confirm field has something in it — a mismatch warning on an empty field would
  //? shout at the user before they've typed. Live so the mismatch shows up before the round-trip.
  const [matches, setMatches] = useState<boolean | null>(null);

  const checkMatch = () => {
    const confirmValue = confirmRef.current?.value ?? '';
    setMatches(confirmValue.length === 0 ? null : confirmValue === (passwordRef.current?.value ?? ''));
  };

  const handleSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (loading) return;
    const password = passwordRef.current?.value ?? '';
    const confirmPassword = confirmRef.current?.value ?? '';

    if (password !== confirmPassword) {
      notify.error({ key: 'login.passwordNotMatch' });
      return;
    }

    setLoading(true);
    const response = await apiRequest({
      name: 'reset-password/confirmReset',
      version: 'v1',
      data: { token, password, confirmPassword },
    });
    setLoading(false);

    if (response.status === 'success') {
      setDone(true);
      notify.success({ key: 'login.resetPasswordUpdated' });
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5 w-full">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{translate({ key: 'login.resetChooseTitle' })}</h1>
        <p className="text-xs text-common">{translate({ key: 'login.resetChooseIntro' })}</p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="done" {...AUTH_STEP_MOTION} className="flex flex-col gap-5">
            <SuccessNote>{translate({ key: 'login.resetSuccess' })}</SuccessNote>
            <Link
              to={loginPageUrl}
              className={`${AUTH_BUTTON_CLASS} flex items-center justify-center`}
            >
              {translate({ key: 'login.resetGoLogin' })}
            </Link>
          </motion.div>
        ) : (
          <motion.div key="form" {...AUTH_STEP_MOTION} className="flex flex-col gap-5">
            <PasswordField
              id="reset-new"
              label={translate({ key: 'login.password' })}
              autoComplete="new-password"
              inputRef={passwordRef}
              hint={translate({ key: 'login.passwordHint' })}
              onChange={checkMatch}
              required
            />
            <div className="flex flex-col gap-1">
              <PasswordField
                id="reset-confirm"
                label={translate({ key: 'login.confirmPassword' })}
                autoComplete="new-password"
                inputRef={confirmRef}
                onChange={checkMatch}
                required
              />
              {matches !== null && (
                <p className={`text-xs ${matches ? 'text-correct' : 'text-wrong'}`}>
                  {translate({ key: matches ? 'login.passwordsMatch' : 'login.passwordNotMatch' })}
                </p>
              )}
            </div>
            <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
              {loading ? translate({ key: 'login.loading' }) : translate({ key: 'login.resetConfirm' })}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
