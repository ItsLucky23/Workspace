import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom';

import { useTranslator } from '@luckystack/core/client';

//? Partial<Record<...>> so the indexed lookup is `string | undefined` —
//? lets the `??` chain in the component see the LHS as nullable.
const STATUS_MESSAGE: Partial<Record<number, string>> = {
  400: 'The request was invalid.',
  401: 'Authentication is required to view this page.',
  403: 'You do not have permission to view this page.',
  404: 'The page you are looking for does not exist.',
  500: 'An unexpected server error occurred.',
  502: 'The service is currently unreachable.',
  503: 'The service is temporarily unavailable.',
};

export default function ErrorPage() {
  const translate = useTranslator();
  const error = useRouteError();

  let errorCode: string | null = null;
  let errorTitle = 'Something went wrong';
  let errorMessage = 'An unexpected error occurred. Please try again.';
  let errorDetails: string | null = null;

  if (isRouteErrorResponse(error)) {
    errorCode = String(error.status);
    errorTitle = error.statusText || translate({ key: 'errorPage.errorLabel' });
    const data = error.data as { message?: string } | null;
    const dataMessage = data?.message;
    errorMessage = dataMessage ?? STATUS_MESSAGE[error.status] ?? errorMessage;
  } else if (error instanceof Error) {
    errorMessage = error.message || errorMessage;
    //? Only expose the raw stack in development. In production a render-time
    //? throw would otherwise leak internal paths / module structure to end
    //? users (this is wired as the router `errorElement` + `*` catch-all).
    errorDetails = import.meta.env.DEV ? (error.stack ?? null) : null;
  }

  return (
    <div className="min-h-screen w-full bg-background text-title flex items-center justify-center p-4">
      <div className="w-full max-w-md flex flex-col gap-6">

        <div className="flex flex-col gap-2">
          {errorCode && (
            <div className="text-xs font-mono uppercase tracking-wider text-common">
              {translate({ key: 'errorPage.errorLabel' })} {errorCode}
            </div>
          )}
          <h1 className="text-2xl font-semibold">{errorTitle}</h1>
          <p className="text-sm text-common">{errorMessage}</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { globalThis.history.back(); }}
            className="h-9 px-4 rounded-md bg-container1 border border-container1-border hover:bg-container1-hover text-title text-sm font-medium transition-colors cursor-pointer"
          >
            {translate({ key: 'errorPage.goBack' })}
          </button>
          <Link
            to="/"
            className="h-9 px-4 flex items-center rounded-md bg-primary hover:bg-primary-hover text-title-primary text-sm font-medium transition-colors"
          >
            {translate({ key: 'errorPage.home' })}
          </Link>
        </div>

        {errorDetails && (
          <details className="bg-container1 border border-container1-border rounded-md text-sm">
            <summary className="cursor-pointer px-3 py-2 select-none text-common hover:text-title transition-colors">
              {translate({ key: 'errorPage.developerDetails' })}
            </summary>
            <pre className="px-3 py-3 border-t border-container1-border text-xs text-wrong overflow-auto max-h-80 whitespace-pre-wrap break-words">
              {errorDetails}
            </pre>
          </details>
        )}

      </div>
    </div>
  );
}
