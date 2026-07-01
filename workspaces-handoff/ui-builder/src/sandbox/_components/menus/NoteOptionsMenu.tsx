import { motion, AnimatePresence } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { NoteOptions, NoteOptionsCommands, NoteOptionsIcons, NoteOptionsVisibleState } from "src/sandbox/types/NotesOptionsTypes";
import { useNotes } from "src/sandbox/_providers/NotesContextProvider";
import { useEffect, useState } from "react";

export default function NoteOptionsMenu() {

  const {
    noteOptionsMenuOpen,
    setNoteOptionsMenuOpen,
    noteOptionsMenuPosition,
    lastActiveEditor
  } = useNotes();

  const [searchInput, setSearchInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const closeMenuAndRestoreFocus = (shouldRestorePosition = true) => {
    setNoteOptionsMenuOpen(NoteOptionsVisibleState.CLOSED);

    // Restore focus to the editor at the saved position
    if (lastActiveEditor && shouldRestorePosition) {
      const { editor, position } = lastActiveEditor;

      // Use setTimeout to ensure menu is closed before focusing
      setTimeout(() => {
        editor.commands.focus();
        editor.commands.setTextSelection(position);
      }, 50);
    }
  };

  useEffect(() => {
    if (noteOptionsMenuOpen != NoteOptionsVisibleState.OPEN) { return; }

    setSearchInput("");
    setSelectedIndex(0);

    const handleClickOutside = (event: MouseEvent) => {
      const menu = document.getElementById("noteOptionsMenu");
      if (menu && !menu.contains(event.target as Node)) {
        closeMenuAndRestoreFocus();
      }
    }

    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [noteOptionsMenuOpen])

  // Handle keyboard navigation
  useEffect(() => {
    if (noteOptionsMenuOpen != NoteOptionsVisibleState.OPEN) { return; }

    const handleKeyDown = (event: KeyboardEvent) => {
      const visibleOptions = Object.values(NoteOptions).filter(option =>
        option.toLowerCase().includes(searchInput.toLowerCase())
      );

      if (event.key === "Escape") {
        event.preventDefault();
        closeMenuAndRestoreFocus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, visibleOptions.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (visibleOptions[selectedIndex] && lastActiveEditor) {
          const { editor } = lastActiveEditor;
          const command = NoteOptionsCommands[visibleOptions[selectedIndex]];
          setNoteOptionsMenuOpen(NoteOptionsVisibleState.CLOSED);
          command(editor);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [noteOptionsMenuOpen, searchInput, selectedIndex, lastActiveEditor])

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchInput])

  if (!noteOptionsMenuPosition) { return null; }
  return (
    <AnimatePresence>
      {noteOptionsMenuOpen == NoteOptionsVisibleState.OPEN && (
        <motion.div
          initial={{ opacity: 0, scale: 0.90, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.90, y: -5 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "absolute",
            zIndex: 1000,
          }}
        >
          <div
            className="MENU bg-background2 rounded gap-3 flex flex-col w-72 shadow-xl border border-border2 text-text"
            style={{
              position: "absolute",
              left: noteOptionsMenuPosition.x,
              top: noteOptionsMenuPosition.y,
              transform: 'translate(20px, calc(-100px + -50%))',
            }}
            id="noteOptionsMenu"
          >
            <div className="flex flex-col text-sm">

              <div className="py-2 px-4 border-b border-border2">
                <input
                  type="text"
                  className="w-full h-full focus:outline-none"
                  placeholder="Insert block..."
                  autoFocus={true}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                ></input>
              </div>


              {/* <div className="text-xs font-bold text-text2 uppercase tracking-wider px-1">
                Create
              </div> */}
              <div className="p-2 gap-2 flex flex-col">
                {Object.values(NoteOptions).map((option, index) => {

                  if (!option.toLowerCase().includes(searchInput.toLowerCase())) {
                    return null;
                  }

                  // Calculate actual visible index
                  const visibleOptions = Object.values(NoteOptions).filter(opt =>
                    opt.toLowerCase().includes(searchInput.toLowerCase())
                  );
                  const visibleIndex = visibleOptions.indexOf(option);
                  const isSelected = visibleIndex === selectedIndex;

                  const Icon = NoteOptionsIcons[option];
                  return (
                    <div
                      key={option}
                      className={`p-1 rounded cursor-pointer ${isSelected ? 'bg-background2-hover' : 'hover:bg-background2-hover'}`}
                      onClick={() => { 
                        if (lastActiveEditor) {
                          const { editor } = lastActiveEditor;
                          const command = NoteOptionsCommands[option];
                          setNoteOptionsMenuOpen(NoteOptionsVisibleState.CLOSED);
                          command(editor);
                        }
                      }}
                      onMouseEnter={() => setSelectedIndex(visibleIndex)}
                    >
                      <FontAwesomeIcon icon={Icon} className="text-muted mr-2" />
                      {option}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}