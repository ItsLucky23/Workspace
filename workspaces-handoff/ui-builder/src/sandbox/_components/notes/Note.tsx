import { note } from "src/sandbox/types/blueprints";
import { useBlueprints } from "src/sandbox/_providers/BlueprintsContextProvider";
import NoteEditor from "./NoteEditor";
import { useNotes } from "src/sandbox/_providers/NotesContextProvider";
import { NoteOptionsVisibleState } from "src/sandbox/types/NotesOptionsTypes";
import { useMenus } from "src/sandbox/_providers/MenusContextProvider";
import { CreateComponentMenuVisibleState } from "src/sandbox/types/createComponentMenuTypes";

export default function Note({ note }: { note: note }) {
  const { setBlueprints } = useBlueprints();
  const {
    noteOptionsMenuOpen,
    setNoteOptionsMenuOpen,
    setWasNoteRecentlyActive
  } = useNotes();

  const {
    createComponentMenuOpen,
    setCreateComponentMenuOpen
  } = useMenus();

  const handleUpdate = (newContent: any) => {
    if (!newContent) {
      setBlueprints(prev => ({
        ...prev,
        notes: prev.notes.filter(n => n.id !== note.id)
      }));
      return;
    }

    setBlueprints(prev => ({
      ...prev,
      notes: prev.notes.map(n => n.id === note.id ? { ...n, content: JSON.stringify(newContent) } : n)
    }));
  };

  return (
    <div
      className="absolute bg-background border border-border shadow-lg rounded-lg overflow-hidden flex flex-col"
      style={{
        left: note.position.x,
        top: note.position.y,
        minWidth: note.width,
        minHeight: note.height
      }}
      onMouseDown={(e) => {
        // Middle click
        if (e.button === 1) {
          e.preventDefault();
          return;
        }

        // Track that we're now active in a note
        setWasNoteRecentlyActive(true);

        if (noteOptionsMenuOpen == NoteOptionsVisibleState.OPEN) {
          setNoteOptionsMenuOpen(NoteOptionsVisibleState.CLOSED);
        }
        if (createComponentMenuOpen == CreateComponentMenuVisibleState.OPEN) {
          setCreateComponentMenuOpen(CreateComponentMenuVisibleState.CLOSED)
        }
        e.stopPropagation()
      }}
      onMouseUp={(e) => {
        if (e.button === 1) return;

        e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
      }}
      draggable={false}
    >

      <div className="flex-1 overflow-hidden relative">
        <NoteEditor
          title={note.title}
          initialContent={note.content}
          onUpdate={handleUpdate}
        />
      </div>

    </div>
  )
}
