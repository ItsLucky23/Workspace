import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { SessionLayout } from "config";
import Icon from "./Icon";
import initializeRouter from "./Router";
import Avatar from "./Avatar";
import { useSession } from "../_providers/SessionProvider";
import { apiRequest } from "src/_sockets/apiRequest";

const navbarItems = [
  {
    init: function InitComponent({  session }: NavbarItemProps) {
      if (!session) { return null }
      return (
        <div className="w-6 h-6">
          <Avatar 
            user={session}
          />
        </div>
      )
    },
  },
  {
    icon: 'close_fullscreen',
    label: 'Close sidebar',
    action: ({ setState }: NavbarItemProps) => {
      setState('folded')
    },
    hideOnFolded: true
  },
  {
    icon: 'open_in_full',
    label: 'Show sidebar',
    action: ({ setState }: NavbarItemProps) => {
      setState('expended')
    },
    hideOnExpended: true
  },
  {
    icon: 'home',
    label: 'Test',
    path: '/test'
  },
  {
    icon: 'settings',
    label: 'Settings',
    path: '/settings'
  },
  {
    icon: 'admin_panel_settings',
    label: 'Admin',
    path: '/admin'
  },
  {
    icon: 'logout',
    label: 'Logout',
    bottom: true,
    action: async () => {
      await apiRequest({ name: 'logout' });
    }
  },
]

const activePopups: HTMLElement[] = [];
const clearPopups = () => {
  for (const popup of activePopups) {
    popup.remove();
  }
  activePopups.length = 0;
};

const displayPopup = ({ element, text }: { element: HTMLElement, text: string }) => {
  const popup = document.createElement('div');
  popup.className = `
    bg-gray-200 text-gray-700 rounded-md p-2 absolute z-50 shadow-lg whitespace-nowrap pointer-events-none
    transform scale-90 opacity-0 transition-all duration-200
  `;

  popup.innerHTML = text;

  const rect = element.getBoundingClientRect();
  if (rect.width == 0 && rect.height == 0) { return };
  
  popup.style.position = 'absolute';
  popup.style.top = `${(rect.top + window.scrollY - 10).toString()}px`;
  popup.style.left = `${(rect.left + window.scrollX + rect.width + 5).toString()}px`;
  document.body.appendChild(popup);

  activePopups.push(popup);
  void popup.offsetHeight;

  popup.classList.remove('scale-90', 'opacity-0');
  popup.classList.add('scale-100', 'opacity-100');

  element.addEventListener('mouseleave', () => { 
    popup.remove(); 
    const index = activePopups.indexOf(popup);
    if (index !== -1) activePopups.splice(index, 1);
  }, { once: true });
};

interface NavbarItemProps {
  item: {
    init?: ({ item, state, setState, pathname, session }: {
      item: NavbarItemProps["item"],
      state: NavbarItemProps["state"],
      setState: NavbarItemProps["setState"],
      pathname: NavbarItemProps["pathname"],
      session: NavbarItemProps["session"],
      router: NavbarItemProps["router"]
    }) => ReactNode,
    icon?: string,
    label?: string,
    path?: string,
    action?: ({ item, state, setState, pathname, session }: { 
      item: NavbarItemProps["item"], 
      state: NavbarItemProps["state"], 
      setState: NavbarItemProps["setState"], 
      pathname: NavbarItemProps["pathname"],
      session: NavbarItemProps["session"],
      router: NavbarItemProps["router"]
    }) => void,
    bottom?: boolean,
    hideOnFolded?: boolean,
    hideOnExpended?: boolean
  },
  state: 'folded' | 'expended',
  setState: (state: 'folded' | 'expended') => void,
  pathname: string,
  session: SessionLayout | null,
  router: (location: string) => Promise<void> | void
}

const NavbarItem = ({ item, state, setState, pathname, session, router }: NavbarItemProps) => {
  const toggleId = useRef<number | null>(null);
  return (
   <div className={`hover:bg-gray-200 hover:text-gray-600 w-full h-10 items-center rounded-sm transition-all duration-100 cursor-pointer gap-2 py-2
      ${state == 'expended' && item.hideOnExpended ? 'hidden' :
        state == 'folded' && item.hideOnFolded ? 'hidden' : 
        'flex'
      }
      ${state == 'folded' ? 'px-2' : 'px-2'}
      ${item.path == pathname ? 'bg-gray-200' : ''}
      ${item.bottom ? 'mt-auto' : ''}
    `}
    onMouseEnter={(e) => {
      if (state == 'expended') { return }
      const target = e.currentTarget as HTMLElement;
      const randomId = Math.floor(Math.random() * 1000000000000000);
      toggleId.current = randomId;
      setTimeout(() => {
        requestAnimationFrame(() => {
          if (item.label == undefined) { return }
          if (toggleId.current != randomId) { return }
          console.log('toggleId', toggleId.current);
          displayPopup({ element: target, text: item.label });
        })
      }, 100);
    }}
    onMouseLeave={() => {
      if (state == 'expended') { return }
      toggleId.current = null;
    }}
    onClick={async () => {
      if (item.action) { item.action({ item, state, setState, pathname, session, router }) }
      else if (item.path) { 
        clearPopups();
        void await router(item.path);
        setState('folded');
      }
    }}>
      {item.init ? 
        item.init({ item, state, setState, pathname, session: session, router })
      :
      <>
        <Icon 
          name={item.icon || ''} 
          size={state === 'folded' ? '18px' : '22px'}
          weight={'lighter'}
          customClasses={"relative left-0.75"}
        />
        {state == 'expended' &&
          <div className="line-clamp-1 select-none">{item.label}</div>
        }
      </>
      }
   </div> 
  ) 
}

export default function Navbar() {

  const [state, setState] = useState<'folded' | 'expended'>('folded');
  const location = useLocation();
  const router = initializeRouter()
  const { session } = useSession();

  useEffect(() => {
    clearPopups();
  }, [location.pathname]);

  const ref = useRef<HTMLDivElement>(null);
  const [parentWidth, setParentWidth] = useState<number>(0);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setParentWidth(entry.contentRect.width);
      }
    });

    observer.observe(parent);

    return () => observer.disconnect();
  }, []);

  if (!session) { return; }

  return (
    <div ref={ref}>
      {parentWidth < 768 &&
        <>
          <div className="w-full py-2 px-4 bg-white text-black flex justify-between items-center">
            <div className="w-8 h-8">
              <Avatar 
                user={session}
              />
            </div>
            <div className="">
              <Icon
                name={state == 'expended'? 'close_fullscreen' : 'open_in_full'}
                size={'22px'}
                weight={'lighter'}
                onClick={() => {
                  const value = state == 'expended'? 'folded' : 'expended';
                  setState(value)
                }}
              />
            </div>
          </div>
        </>
      }
      <div className={`h-full bg-white text-gray-500 flex flex-col items-center @md:py-4 transition-all duration-200 @md:px-2 absolute z-20 @md:z-0 @md:relative
        ${state == 'folded' ? 
          '@md:w-14 w-0 gap-3' : 
          'w-64 gap-1 px-2'
        }`}>

          {(parentWidth >= 768 || state === 'expended') && (
            <>
              {/* Top items */}
              {navbarItems.filter(item => !item.bottom).map((item, index) => {
                const shouldRender = item.init || (item.icon && item.label);
                if (!shouldRender) return null;

                return (
                  <NavbarItem
                    key={index}
                    pathname={location.pathname}
                    item={item}
                    state={state}
                    setState={setState}
                    session={session}
                    router={router}
                  />
                );
              })}

              {/* Bottom items, inside a mt-auto wrapper */}
              <div className="mt-auto w-full flex flex-col gap-2 items-center">
                {navbarItems.filter(item => item.bottom).map((item, index) => {
                  const shouldRender = item.init || (item.icon && item.label);
                  if (!shouldRender) return null;

                  return (
                    <NavbarItem
                      key={`bottom-${index}`}
                      pathname={location.pathname}
                      item={item}
                      state={state}
                      setState={setState}
                      session={session}
                      router={router}
                    />
                  );
                })}
              </div>
            </>
          )}

      </div>
      <div className={`@md:hidden flex absolute top-0 left-0 z-10 bg-black ${state != 'folded' ? 'opacity-80' : 'opacity-0 pointer-events-none'} transition-all duration-300 w-full h-full`}
        onClick={() => { setState('folded') }}>
      </div>
    </div>
  )
}