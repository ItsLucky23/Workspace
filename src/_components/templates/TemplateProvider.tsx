//? Registers the available page templates and picks the active one from
//? the `template` export on each `page.tsx`. Add your own templates here
//? (one per layout — sidebar, dashboard, marketing, etc.) and the
//? framework's file-based routing will wire them automatically.
//?
//? Common UX wiring lives at this layer: the framework's
//? <SocketStatusIndicator /> and theme-from-session sync are mounted
//? once here so every template inherits them.

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { SocketStatusIndicator } from '@luckystack/presence/client';
import { useTheme, useSession, useTranslator } from '@luckystack/core/client';

import type { SessionLayout } from 'config';
import { useSocketStatus } from 'src/_providers/socketStatusProvider';
import Home from './Home';

export type Template = 'home' | 'plain';

const Templates = {
  home: Home,
  plain: PlainTemplate,
} satisfies Record<Template, React.ComponentType<{ children: React.ReactNode }>>;

function PlainTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full">
      {children}
    </div>
  );
}

export default function TemplateProvider({
  children,
  initialTemplate,
}: {
  children: React.ReactNode;
  initialTemplate: Template;
}) {
  const [template] = useState<Template>(initialTemplate);
  const TemplateComponent = Templates[template];

  const { session } = useSession<SessionLayout>();
  const reactLocation = useLocation();
  const { setTheme } = useTheme();
  const { socketStatus } = useSocketStatus();
  const translate = useTranslator();

  //? Sync the active theme from the session whenever it changes — keeps
  //? `<html class="dark">` aligned with `User.theme` after settings update.
  useEffect(() => {
    if (session?.theme === 'light' || session?.theme === 'dark') {
      setTheme(session.theme);
    }
  }, [session?.theme, setTheme, reactLocation]);

  return (
    <div className='w-full h-full relative'>
      <SocketStatusIndicator
        status={socketStatus.self.status}
        reconnectAttempt={socketStatus.self.reconnectAttempt}
        label={translate({ key: 'template.socketStatus' })}
      />
      <TemplateComponent>{children}</TemplateComponent>
    </div>
  );
}
