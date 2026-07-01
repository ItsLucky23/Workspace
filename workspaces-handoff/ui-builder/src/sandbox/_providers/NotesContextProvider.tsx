import { createContext, useContext, useState, ReactNode, SetStateAction, Dispatch, useEffect } from 'react';
import { NoteOptionsVisibleState } from '../types/NotesOptionsTypes';
import { Editor } from '@tiptap/react';

type NotesContextType = {
  noteOptionsMenuOpen: NoteOptionsVisibleState;
  setNoteOptionsMenuOpen: Dispatch<SetStateAction<NoteOptionsVisibleState>>;
  noteOptionsMenuPosition: { x: number; y: number } | null;
  setNoteOptionsMenuPosition: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  lastActiveEditor: { editor: Editor; position: number } | null;
  setLastActiveEditor: Dispatch<SetStateAction<{ editor: Editor; position: number } | null>>;
  wasNoteRecentlyActive: boolean;
  setWasNoteRecentlyActive: Dispatch<SetStateAction<boolean>>;
};

const NotesContext = createContext<NotesContextType | undefined>(undefined);

export const NotesProvider = ({ children }: { children: ReactNode }) => {
  const [noteOptionsMenuOpen, setNoteOptionsMenuOpen] = useState<NoteOptionsVisibleState>(NoteOptionsVisibleState.CLOSED);
  const [noteOptionsMenuPosition, setNoteOptionsMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [lastActiveEditor, setLastActiveEditor] = useState<{ editor: Editor; position: number } | null>(null);
  const [wasNoteRecentlyActive, setWasNoteRecentlyActive] = useState(false);

  useEffect(() => {

    if (!noteOptionsMenuPosition) { return; }

    const maxHeight = window.innerHeight;
    const maxWidth = window.innerWidth;
    const minHeight = 340; // value has no relation to menu height, just a comfortable min height
    const minWidth = 20; // value has no relation to menu width, just a comfortable min width

    const menuHeight = 312 / 2; // menu opens half up and half down from the cursor thats why half height
    const menuWidth = 288; // full width because it only opens to the right

    let newX = noteOptionsMenuPosition.x;
    let newY = noteOptionsMenuPosition.y;

    if (noteOptionsMenuPosition.x + menuWidth > maxWidth) {
      newX = maxWidth - menuWidth - 40;
    } else if (noteOptionsMenuPosition.y + menuHeight > maxHeight) {
      newY = maxHeight - menuHeight - 40;
    }

    if (noteOptionsMenuPosition.x < minWidth) {
      newX = minWidth;
    } else if (noteOptionsMenuPosition.y < minHeight) {
      newY = minHeight;
    }

    if (newX !== noteOptionsMenuPosition.x || newY !== noteOptionsMenuPosition.y) {
      setNoteOptionsMenuPosition({ x: newX, y: newY });
    }

  }, [noteOptionsMenuPosition]);

  return (
    <NotesContext.Provider value={{
      noteOptionsMenuOpen,
      setNoteOptionsMenuOpen,

      noteOptionsMenuPosition,
      setNoteOptionsMenuPosition,

      lastActiveEditor,
      setLastActiveEditor,

      wasNoteRecentlyActive,
      setWasNoteRecentlyActive
    }}>
      {children}
    </NotesContext.Provider>
  );
};

export const useNotes = () => {
  const context = useContext(NotesContext);
  if (!context) {
    throw new Error('useNotes must be used within a NotesProvider');
  }
  return context;
};