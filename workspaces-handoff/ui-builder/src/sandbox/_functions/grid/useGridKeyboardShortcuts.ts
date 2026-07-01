import { useEffect } from "react";
import { useBlueprints } from "src/sandbox/_providers/BlueprintsContextProvider";
import { useDrawing } from "src/sandbox/_providers/DrawingContextProvider";

/**
 * Grid-level keyboard shortcuts for undo/redo of grid items (files, notes).
 * This is SEPARATE from drawing shortcuts (handled in useKeyboardShortcuts.ts).
 * 
 * Only handles Ctrl+Z/Y when:
 * - Monaco editor is NOT focused
 * - TipTap notes are NOT focused  
 * - CodeMirror blocks are NOT focused
 * - Drawing mode is NOT enabled (drawing has its own shortcuts)
 */
export function useGridKeyboardShortcuts() {
  const {
    undoChange,
    redoChange,
    canUndo,
    canRedo
  } = useBlueprints();

  const { drawingEnabled } = useDrawing();

  useEffect(() => {
    const isEditorFocused = () => {
      const activeEl = document.activeElement;
      if (!activeEl) return false;

      const isTyping = activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement;
      const monacoFocused = !!activeEl.closest('.monaco-editor');
      const tiptapFocused = !!activeEl.closest('.tiptap, .ProseMirror');
      const codemirrorFocused = !!activeEl.closest('.cm-editor');

      return isTyping || monacoFocused || tiptapFocused || codemirrorFocused;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (drawingEnabled) return;
      if (isEditorFocused()) return;

      // Undo: Ctrl+Z (not Shift)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          undoChange();
        }
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        if (canRedo) {
          e.preventDefault();
          redoChange();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawingEnabled, undoChange, redoChange, canUndo, canRedo]);
}
