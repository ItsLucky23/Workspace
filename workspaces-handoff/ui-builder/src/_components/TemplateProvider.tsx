import { useEffect, useState } from 'react';
import Middleware from 'src/_components/Middleware';
import useRouter from './Router';
import { useLocation } from 'react-router-dom';
import Avatar from './Avatar';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faGear, faHome } from '@fortawesome/free-solid-svg-icons';
import { useSession } from '../_providers/SessionProvider';
import ThemeToggler from './ThemeToggler';
import { useSocketStatus } from 'src/_providers/socketStatusProvider';
import { apiRequest } from 'src/_sockets/apiRequest';
import config from "config";
import { GridProvider } from 'src/sandbox/_providers/GridContextProvider';
import Tooltip from './Tooltip';
import { CodeProvider } from 'src/sandbox/_providers/CodeContextProvider';
import { BlueprintsProvider } from 'src/sandbox/_providers/BlueprintsContextProvider';
import { DrawingProvider } from 'src/sandbox/_providers/DrawingContextProvider';
import { MenusProvider } from 'src/sandbox/_providers/MenusContextProvider';
import { BuilderPanelProvider } from 'src/sandbox/_providers/BuilderPanelContextProvider';
import { NotesProvider } from 'src/sandbox/_providers/NotesContextProvider';

const Templates = {
  main: MainTemplate,
  plain: PlainTemplate,
  sandbox: SandboxTemplate,
}
export type Template = 'plain' | 'main' | 'sandbox';

function MainTemplate({ children }: { children: React.ReactNode }) {

  const router = useRouter();
  const location = useLocation();
  const { session } = useSession();

  return (
    <div className="w-full h-full overflow-hidden flex flex-col text-title">

      <div className='w-full flex items-center p-2 bg-background border-border border-b-[1px] gap-4'>

        <div className='h-full flex gap-2 items-center'>
          <div className='min-w-8 max-w-8 h-8 rounded-full overflow-hidden'>
            <img src='/logo.png'></img>
          </div>
          <h1 className='font-semibold text-base line-clamp-1'>{session?.name}</h1>
        </div>

        <div className='h-full flex gap-2 items-center'>
          <div className='min-w-8 max-w-8 h-8'>
            {session && (
              <Avatar user={session} />
            )}
          </div>
          <h1 className='font-semibold text-base line-clamp-1'>{session?.name}</h1>
        </div>

        {/* {session?.location?.previousLocation && session?.location?.previousLocation !== session?.location?.pathName && (
          <Tooltip
            content="Go back to previous page"
            delay={300}
            offsetY={"5px"}
            offsetX={"5px"}
          >
            <button 
              className='p-2 bg-container2 border border-container2-border rounded-md cursor-pointer text-sm'
              onClick={() => {
                router(session.location?.previousLocation || config.loginRedirectUrl)
              }}
            >
              <FontAwesomeIcon icon={faArrowLeft} size='lg' />
            </button>
          </Tooltip>
        )} */}
        {/* 
        <Tooltip
          content={location.pathname == '/home' ? "Go to settings" : "Go to home page"}
          delay={300}
          offsetY={"5px"}
          offsetX={"5px"}
          className={`bg-container2 p-2 text-nowrap border border-container-border rounded`}
        >
          <button 
            className='p-2 bg-container2 border border-container2-border rounded-md cursor-pointer text-sm'
            onClick={() => {
              router(location.pathname == '/home' ? '/settings' : '/home')
            }}
          >
            <FontAwesomeIcon icon={location.pathname == '/home' ? faGear : faHome} size='lg' />
          </button>
        </Tooltip> */}

        {/* <button 
          className='bg-container2 border border-container2-border rounded-md py-2 px-6 cursor-pointer font-semibold'
          onClick={() => apiRequest({ name: 'logout' })}
        >
          Uitloggen
        </button> */}
      </div>

      <div className='overflow-hidden w-full flex-grow'>
        <Middleware>
          {children}
        </Middleware>
      </div>

    </div>
  )
}

function PlainTemplate({ children }: { children: React.ReactNode }) {
  const { updateTheme } = ThemeToggler();

  useEffect(() => {
    updateTheme(config.defaultTheme);
    document.documentElement.classList.toggle("dark", config.defaultTheme === "dark");
  }, [location]);

  return (
    <div className="w-full h-full">
      {children}
    </div>
  )
}

function SandboxTemplate({ children }: { children: React.ReactNode }) {
  const { updateTheme } = ThemeToggler();

  useEffect(() => {
    updateTheme(config.defaultTheme);
    document.documentElement.classList.toggle("dark", config.defaultTheme === "dark");
  }, [location]);

  return (
    <GridProvider>
      <BlueprintsProvider>
        <BuilderPanelProvider>
          <MenusProvider>
            <CodeProvider>
              <DrawingProvider>
                <NotesProvider>
                  <MainTemplate>
                    {children}
                  </MainTemplate>
                </NotesProvider>
              </DrawingProvider>
            </CodeProvider>
          </MenusProvider>
        </BuilderPanelProvider>
      </BlueprintsProvider>
    </GridProvider>
  )
}

export default function TemplateProvider({
  children,
  initialTemplate,
}: {
  children: React.ReactNode;
  initialTemplate: Template;
}) {
  const [template] = useState<Template>(initialTemplate);

  const TemplateComponent = Templates[template] || PlainTemplate;

  const { session } = useSession();
  const location = useLocation();
  const { updateTheme } = ThemeToggler();
  const { socketStatus } = useSocketStatus();

  useEffect(() => {
    if (session?.theme) {
      updateTheme(session.theme);
      document.documentElement.classList.toggle("dark", session.theme === "dark");
    }
  }, [session, location]);

  if (config.dev && config.socketActivityBroadcaster) {
    return (
      <div className='w-full h-full relative'>
        <div className='absolute top-2 right-2 z-50 bg-red-500 text-white px-2 py-1 rounded-md text-xs font-bold'>
          Socket status: {socketStatus.self.status}
          {socketStatus.self.status === "RECONNECTING" && socketStatus.self.reconnectAttempt ? ` (attempt ${socketStatus.self.reconnectAttempt})` : ''}
        </div>
        <TemplateComponent>{children}</TemplateComponent>
      </div>
    );
  }

  return (
    <TemplateComponent>{children}</TemplateComponent>
  );
}