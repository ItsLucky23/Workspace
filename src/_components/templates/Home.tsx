//? Sample 'home' template — wraps protected pages in <Middleware /> so
//? unauthenticated users get redirected before render. Replace the simple
//? header with your own navbar / sidebar / breadcrumbs as needed; this is
//? where the project's signed-in shell lives.

import { Link } from 'react-router-dom';
import { Middleware, useSession, useTranslator } from '@luckystack/core/client';

export default function Home({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const translate = useTranslator();

  return (
    <div className="w-full h-full flex flex-col bg-background text-title">
      <header className="flex items-center justify-between gap-4 px-6 h-14 border-b border-container1-border bg-container1">
        <Link to="/" className="text-base font-semibold text-title hover:text-primary transition-colors">
          {session?.name ?? 'home'}
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-sm text-common hover:text-primary transition-colors">
            {translate({ key: 'home.settings' })}
          </Link>
          <Link to="/logout" className="text-sm text-common hover:text-primary transition-colors">
            {translate({ key: 'home.signOut' })}
          </Link>
        </div>
      </header>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Middleware>
          {children}
        </Middleware>
      </div>
    </div>
  );
}
