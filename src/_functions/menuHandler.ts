import { ReactElement, createElement } from 'react';

import { ConfirmMenu, type ConfirmMenuProps } from 'src/_components/ConfirmMenu';
import { useMenuHandler } from 'src/_components/MenuHandler';

interface MenuOptions {
  dimBackground?: boolean;
  background?: string;
  size?: 'sm' | 'md' | 'lg';
}

type MenuHandlerRef = ReturnType<typeof useMenuHandler> | null;

const MENU_HANDLER_KEY = 'MENU_HANDLER';
const globalStore = globalThis as typeof globalThis & { [MENU_HANDLER_KEY]?: MenuHandlerRef };

if (globalStore[MENU_HANDLER_KEY] === undefined) {
  globalStore[MENU_HANDLER_KEY] = null;
}

const getHandler = () => globalStore[MENU_HANDLER_KEY] ?? null;

export const setMenuHandlerRef = (ref: MenuHandlerRef) => {
  globalStore[MENU_HANDLER_KEY] = ref;
};

const waitForHandler = async () => {
  for (let i = 0; i < 15; i++) {
    const ref = getHandler();
    if (ref) return ref;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('MenuHandler is not initialized');
};

export const menuHandler = {
  open: async (component: ReactElement, options?: MenuOptions) => {
    const handler = await waitForHandler();
    return await handler.open(component, options);
  },
  replace: async (component: ReactElement, options?: MenuOptions) => {
    const handler = await waitForHandler();
    return await handler.replace(component, options);
  },
  close: (success?: boolean) => {
    getHandler()?.close();
    return success;
  },
  closeAll: () => getHandler()?.closeAll(),
  logStack: () => getHandler()?.logStack(),

  /**
   * Open a confirm dialog. Resolves to `true` when the user confirms,
   * `false` on cancel/dismiss. Auto-closes the menu when resolved.
   */
  confirm: (props: Omit<ConfirmMenuProps, 'resolve'>): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const handleResolve = (confirmed: boolean) => {
        getHandler()?.close();
        resolve(confirmed);
      };

      void menuHandler.open(
        createElement(ConfirmMenu, { ...props, resolve: handleResolve }),
        { dimBackground: true, background: 'bg-container1', size: 'sm' },
      );
    });
  },
};
