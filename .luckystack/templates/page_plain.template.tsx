/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */

//? Plain page template — no UI chrome. Use for landing/public pages where
//? the default surrounding layout (`'plain'`) is what you want. Per-page
//? middleware is OPTIONAL — uncomment when this route needs a guard.

//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
// import type { PageMiddleware } from '@luckystack/core/client';
//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
// import type { SessionLayout } from '{{REL_PATH}}config';

export const template = 'plain';

// export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
//   if (!session) return { success: false, redirect: '/login' };
//   return { success: true };
// };

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

export default function Page({ params, searchParams }: PageProps) {
  return (
    <div className='flex items-center justify-center w-full h-full text-title'>
      {/* TODO: replace with your page content */}
      <span>page scaffold — replace this</span>
    </div>
  );
}
