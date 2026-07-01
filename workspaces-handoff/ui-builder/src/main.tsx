import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import 'src/index.css'
import 'src/scrollbar-dark.css'
import VConsole from 'vconsole';
import { mobileConsole } from 'config'
import LocationProvider from 'src/_components/LocationProvider'
import { MenuHandlerProvider } from './_components/MenuHandler'
import TemplateProvider from './_components/TemplateProvider'
import type { Template } from './_components/TemplateProvider';
import { AvatarProvider } from './_components/AvatarProvider'
import { SessionProvider } from './_providers/SessionProvider'
import { TranslationProvider } from './_components/TranslationProvider'
import { SocketStatusProvider } from './_providers/socketStatusProvider'

type PageWithTemplate = React.ComponentType & { template?: Template };
const getRoutes = (pages: Record<string, { default: PageWithTemplate, template?: Template }>) => {
  const routes = [];

  for (const [path, module] of Object.entries(pages)) {
    const pathSegments = path.split('/');
    if (pathSegments.some(segment => segment.startsWith('_'))) continue;

    const routePath = path.replace('./', '').replace('.tsx', '').toLowerCase() || '/';
    const subPath = routePath.endsWith('/page')
      ? routePath.slice(0, -5)
      : routePath.endsWith('page')
      ? '/'
      : false;
    if (!subPath) continue;

    const template = module.template ?? 'plain';
    const Page = module.default;

    routes.push({
      path: subPath,
      element: (
        <LocationProvider>
            <TemplateProvider key={`${template}-${subPath}`} initialTemplate={template}>
              <Page />
            </TemplateProvider>
        </LocationProvider>
      ),
    });
  }

  return routes;
};

//! eslint will tell you that the as Record<string, { default: React.ComponentType }> is not needed but it is for typescript to know what the type of pages is
const pages = import.meta.glob('./**/*.tsx', { eager: true }) as Record<
  string,
  { default: React.ComponentType; template?: Template }
>;
const router = createBrowserRouter([{
  path: '/',
  children: getRoutes(pages)
}])

if (mobileConsole) { new VConsole(); }

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <div className='w-full h-safe m-0 p-0 overflow-hidden'>
      <Toaster richColors />
        <SocketStatusProvider>
          <SessionProvider>
            <TranslationProvider>
              <AvatarProvider>
                <MenuHandlerProvider>
                    <RouterProvider router={router}/>
                </MenuHandlerProvider>
              </AvatarProvider>
            </TranslationProvider>
          </SessionProvider>
        </SocketStatusProvider>
    </div>
  );
}