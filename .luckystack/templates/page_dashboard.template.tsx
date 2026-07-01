/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */

//? Dashboard page template — wrapped in the `'home'` template (sidebar + main
//? content; registered in `src/_components/templates/TemplateProvider.tsx`).
//? Includes a login-required middleware as a sane default — adjust the role
//? check or remove the middleware if this page is public.

//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
import type { PageMiddleware } from '@luckystack/core/client';
//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
import type { SessionLayout } from '{{REL_PATH}}config';

export const template = 'home';

//? Default: require login. Customize for role checks
//? (e.g. `if (!session.admin) return undefined;` to bounce non-admins back).
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

export default function Page({ params, searchParams }: PageProps) {
  return (
    <div className='flex flex-col gap-4 p-6 w-full h-full'>
      <h1 className='text-2xl font-semibold text-title'>{/* TODO: page title */}</h1>
      <div className='text-common'>{/* TODO: page content */}</div>
    </div>
  );
}
