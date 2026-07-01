import { createContext, useContext, useState, ReactNode, SetStateAction, Dispatch, useEffect, useRef } from 'react';
import { CreateComponentMenuVisibleState } from '../types/createComponentMenuTypes';

type MenusContextType = {
  createComponentMenuOpen: CreateComponentMenuVisibleState;
  setCreateComponentMenuOpen: Dispatch<SetStateAction<CreateComponentMenuVisibleState>>;

  createComponentMenuPosition: { x: number; y: number } | null;
  setCreateComponentMenuPosition: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
};

const MenusContext = createContext<MenusContextType | undefined>(undefined);

export const MenusProvider = ({ children }: { children: ReactNode }) => {
  const [createComponentMenuOpen, setCreateComponentMenuOpen] = useState<CreateComponentMenuVisibleState>(CreateComponentMenuVisibleState.CLOSED);
  const [createComponentMenuPosition, setCreateComponentMenuPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {

    if (!createComponentMenuPosition) { return; }

    const maxHeight = window.innerHeight;
    const maxWidth = window.innerWidth;
    const minHeight = 280; // value has no relation to menu height, just a comfortable min height
    const minWidth = 20; // value has no relation to menu width, just a comfortable min width

    const menuHeight = 312 / 2; // menu opens half up and half down from the cursor thats why half height
    const menuWidth = 288; // full width because it only opens to the right

    let newX = createComponentMenuPosition.x;
    let newY = createComponentMenuPosition.y;

    if (createComponentMenuPosition.x + menuWidth > maxWidth) {
      newX = maxWidth - menuWidth - 40;
    } else if (createComponentMenuPosition.y + menuHeight > maxHeight) {
      newY = maxHeight - menuHeight - 40;
    }

    if (createComponentMenuPosition && createComponentMenuPosition.x < minWidth) {
      newX = minWidth;
    } else if (createComponentMenuPosition && createComponentMenuPosition.y < minHeight) {
      newY = minHeight;
    }

    if (newX !== createComponentMenuPosition.x || newY !== createComponentMenuPosition.y) {
      setCreateComponentMenuPosition({ x: newX, y: newY });
    }

  }, [createComponentMenuPosition]);

  return (
    <MenusContext.Provider value={{ 
      createComponentMenuOpen, 
      setCreateComponentMenuOpen,

      createComponentMenuPosition, 
      setCreateComponentMenuPosition
    }}>
      {children}
    </MenusContext.Provider>
  );
};

export const useMenus = () => {
  const context = useContext(MenusContext);
  if (!context) {
    throw new Error('useMenus must be used within a MenusProvider');
  }
  return context;
};