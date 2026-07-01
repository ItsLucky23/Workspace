import { ReactElement } from 'react';
import { useMenuHandler } from 'src/_components/MenuHandler';

interface MenuOptions {
  dimBackground?: boolean;
  background?: string;
  size?: 'sm' | 'md' | 'lg';
}

let handler: ReturnType<typeof useMenuHandler> | null = null;
export const setMenuHandlerRef = (ref: ReturnType<typeof useMenuHandler>) => {
  handler = ref;
};

export const menuHandler = {
  open: async (component: ReactElement, options?: MenuOptions) => {
    if (!handler) throw new Error('MenuHandler is not initialized');
    return await handler.open(component, options);
  },
  replace: async (component: ReactElement, options?: MenuOptions) => {
    if (!handler) throw new Error('MenuHandler is not initialized');
    return await handler.replace(component, options);
  },
  close: (success?: boolean) => {
    handler?.close();
    return success;
  },
  closeAll: () => handler?.closeAll(),
  logStack: () => handler?.logStack()
};
