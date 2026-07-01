import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { loginPageUrl } from 'config';
import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';
import { apiRequest } from 'src/_sockets/apiRequest';

export const template = 'plain';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') ?? '', [params]);

  return (
    <div className="w-full h-full overflow-y-auto bg-background">
      <div className="min-h-full w-full flex flex-col items-center justify-center p-4">
        {token ? <ConfirmForm token={token} /> : <RequestForm />}
      </div>
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
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="p-6 bg-container1 border border-container1-border rounded-xl shadow-sm text-title flex flex-col gap-5 max-w-[360px] w-full"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{translate({ key: 'login.resetTitle' })}</h1>
        <p className="text-xs text-common">{translate({ key: 'login.resetIntro' })}</p>
      </div>

      {submitted ? (
        <p className="text-sm text-common">{translate({ key: 'login.resetCheckInbox' })}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="reset-email" className="font-medium text-xs">
              {translate({ key: 'login.emailAddress' })}
            </label>
            <input
              id="reset-email"
              ref={inputRef}
              type="email"
              required
              placeholder="you@example.com"
              className="rounded-md w-full h-9 border border-container1-border bg-container1 px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-9 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
          >
            {loading ? 'Loading...' : translate({ key: 'login.resetSendLink' })}
          </button>
        </>
      )}

      <div className="text-xs text-common text-center">
        <Link to={loginPageUrl} className="text-primary hover:text-primary-hover font-medium cursor-pointer">
          {translate({ key: 'login.resetBackToLogin' })}
        </Link>
      </div>
    </form>
  );
}

function ConfirmForm({ token }: { token: string }) {
  const translate = useTranslator();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const inputClass = 'rounded-md w-full h-9 border border-container1-border bg-container1 px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors';

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
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="p-6 bg-container1 border border-container1-border rounded-xl shadow-sm text-title flex flex-col gap-5 max-w-[360px] w-full"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{translate({ key: 'login.resetChooseTitle' })}</h1>
        <p className="text-xs text-common">{translate({ key: 'login.resetChooseIntro' })}</p>
      </div>

      {done ? (
        <>
          <p className="text-sm text-common">{translate({ key: 'login.resetSuccess' })}</p>
          <Link
            to={loginPageUrl}
            className="h-9 flex items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
          >
            {translate({ key: 'login.resetGoLogin' })}
          </Link>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="reset-new" className="font-medium text-xs">
              {translate({ key: 'login.password' })}
            </label>
            <input id="reset-new" ref={passwordRef} type="password" required className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="reset-confirm" className="font-medium text-xs">
              {translate({ key: 'login.confirmPassword' })}
            </label>
            <input id="reset-confirm" ref={confirmRef} type="password" required className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-9 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
          >
            {loading ? 'Loading...' : translate({ key: 'login.resetConfirm' })}
          </button>
        </>
      )}
    </form>
  );
}
