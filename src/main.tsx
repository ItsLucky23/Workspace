/* eslint-disable react-refresh/only-export-components */
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { Toaster } from 'sonner';
import 'src/index.css';

import {
  AvatarProvider,
  Middleware,
  TranslationProvider,
  registerPageMiddleware,
  validatePagePath,
} from '@luckystack/core/client';
import type { PageMiddleware } from '@luckystack/core/client';
import { LocationProvider } from '@luckystack/presence/client';

import { sessionBasedToken } from 'config';

import ErrorPage from 'src/_components/ErrorPage';
import { MenuHandlerProvider } from 'src/_components/MenuHandler';
import TemplateProvider from 'src/_components/templates/TemplateProvider';
import { SessionProvider } from 'src/_providers/SessionProvider';
import { SocketStatusProvider } from 'src/_providers/socketStatusProvider';

//? OAuth handoff for sessionStorage-token mode. The backend's /auth/callback
//? cannot Set-Cookie a sessionStorage token, so it 302s to `...?token=<token>`.
//? OAuth is a full-page navigation (no fetch to read an X-Session-Token header),
//? so we capture the token from the URL HERE — synchronously, before React mounts
//? (SessionProvider's socket connect + first `system/session` request both fire on
//? mount and read the token from sessionStorage). Then strip it from the URL via
//? replaceState so the long-lived token never lingers in the address bar, browser
//? history, or a Referer header. No-op in cookie mode (no ?token= is emitted).
if (sessionBasedToken) {
  const url = new URL(globalThis.location.href);
  const handoffToken = url.searchParams.get('token');
  if (handoffToken) {
    sessionStorage.setItem('token', handoffToken);
    url.searchParams.delete('token');
    globalThis.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
}

//? Side-effect import — registers the locale map + language source with
//? @luckystack/core. Imported once at the entry. The i18n-backed notifier
//? auto-registers via the @luckystack/core/client barrel above.
import 'luckystack/i18n/locales';

//? Per-page route guards live on each `page.tsx` via `export const middleware`
//? and are auto-registered below in `getRoutes()`. The framework allows-by-
//? default for routes without a guard. If you need a cross-cutting global
//? hook, import `registerMiddlewareHandler` from '@luckystack/core/client'
//? and call it here with your own function.

import type { Template } from 'src/_components/templates/TemplateProvider';

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

interface PageModule {
  default: React.ComponentType<PageProps>;
  template?: Template;
  middleware?: PageMiddleware;
}

//? Wrapper to inject Next.js-style params and searchParams as props.
const PageWrapper = ({ Page }: { Page: React.ComponentType<PageProps> }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const searchParamsObj = Object.fromEntries(searchParams);
  return <Page params={params} searchParams={searchParamsObj} />;
};

type PageLoader = () => Promise<PageModule>;

const getRoutes = (loaders: Record<string, PageLoader>): RouteObject[] => {
  const routes: RouteObject[] = [];
  //? Collision detection — two page.tsx files in different folder trees
  //? can compute the SAME route after invisible-parent stripping. First
  //? wins; second is skipped with a loud console.error.
  const seenRoutes = new Map<string, string>();
  for (const path in loaders) {
    const loader = loaders[path];

    //? Apply the framework's invisible-parent rule: `_<folder>` segments
    //? are stripped from the URL; pages directly inside an `_<folder>` are
    //? invalid; pages inside reserved framework folders (_api, _sync, ...)
    //? are invalid. The validator returns the computed route or a reason.
    const result = validatePagePath(path);
    if (!result.valid || !result.route) {
      if (import.meta.env.DEV && result.reason && !result.reason.startsWith('not a page file')) {
        console.warn(`[luckystack] page route skipped for ${path}: ${result.reason}`);
      }
      continue;
    }

    // eslint-disable-next-line unicorn/prefer-string-replace-all
    const finalPath = result.route.toLowerCase().replace(/\[([^\]]+)\]/g, ':$1');

    const previousFile = seenRoutes.get(finalPath);
    if (previousFile !== undefined) {
      console.error(
        `[luckystack] duplicate page route "${finalPath}": ${previousFile} AND ${path} both resolve here. ` +
        `Keeping the first; the second will not render. ` +
        `Remember that "_<folder>" segments are stripped from the URL (invisible-parent rule).`,
      );
      continue;
    }
    seenRoutes.set(finalPath, path);

    //? Lazy: the page component + its import tree load only when the route is
    //? visited, instead of every page eager-loading on first paint (which made
    //? even `/login` pull in every page + its deps). The page's `template` and
    //? per-page `middleware` live on the same module, so they resolve inside the
    //? loader.
    routes.push({
      path: finalPath,
      lazy: async () => {
        const module = await loader();
        //? Auto-register the page's `export const middleware` (if any) against
        //? its route. Framework's <Middleware> + useRouter prefer this over the
        //? global handler.
        if (module.middleware) {
          registerPageMiddleware(finalPath, module.middleware);
        }
        const template = module.template ?? 'plain';
        return {
          element: (
            <TemplateProvider key={`${template}-${finalPath}`} initialTemplate={template}>
              <PageWrapper Page={module.default} />
            </TemplateProvider>
          ),
        };
      },
    });
  }
  return routes;
};

//? File-based routing: any `page.tsx` under `src/` becomes a route. Files in
//? folders prefixed with `_` (e.g. `_api/`, `_sync/`, `_components/`) are
//? private and never become routes.
const prodPages = import.meta.glob([
  './**/page.tsx',
  '!./**/_api/**',
  '!./**/_sync/**',
  '!./**/_server/**',
  '!./**/*_server.tsx',
  //? The @luckystack/docs-ui API explorer (`src/docs/page.tsx`, present only when
  //? you opted into docs-ui) is dev-only: it imports the dev-generated
  //? `apiDocs.generated.json` and exposes every endpoint, so it must NOT ship in
  //? a production bundle. Excluded here; in dev it loads via `devPages` below.
  '!./**/docs/**',
]);

const devPages = import.meta.glob([
  './**/page.tsx',
]);

const loaders = (import.meta.env.PROD ? prodPages : devPages) as Record<string, PageLoader>;

const routes = getRoutes(loaders);

//? Catch-all — any URL that doesn't match a page renders ErrorPage inside the
//? plain template wrapper. Middleware lets the framework intercept auth /
//? bootstrap state before painting.
routes.push({
  path: '*',
  element: (
    <TemplateProvider initialTemplate='plain'>
      <Middleware>
        <ErrorPage />
      </Middleware>
    </TemplateProvider>
  ),
});

const router = createBrowserRouter([{
  path: '/',
  element: <LocationProvider />,
  errorElement: <ErrorPage />,
  //? Lazy routes make this a data router that hydrates async; React Router 7
  //? warns without a HydrateFallback for the initial chunk load. `() => null`
  //? renders nothing during that brief window (no flash) and silences the warn.
  HydrateFallback: () => null,
  children: routes,
}]);

const root = document.querySelector('#root');
if (root) {
  createRoot(root).render(
    <div className='w-full h-safe m-0 p-0 overflow-hidden'>
      <Toaster richColors />
      <SocketStatusProvider>
        <SessionProvider>
          <TranslationProvider>
            <AvatarProvider>
              <MenuHandlerProvider>
                <RouterProvider router={router} />
              </MenuHandlerProvider>
            </AvatarProvider>
          </TranslationProvider>
        </SessionProvider>
      </SocketStatusProvider>
    </div>
  );
}
