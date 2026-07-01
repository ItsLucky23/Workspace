import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect } from 'react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { NodeSelection } from '@tiptap/pm/state'
import { getCaretPosition, CaretPosition } from '../../_functions/notes/getCaretPosition'
import { PlaceholderPerLine } from '../../_functions/notes/PlaceholderPerLine'

// Styling
import 'src/NoteEditor.css'


import { handleCaretPositionChange } from 'src/sandbox/_functions/notes/handleCaretPosition'
import { CustomCodeBlock } from './CodeBlockComponent'
import { useNotes } from 'src/sandbox/_providers/NotesContextProvider'
import { NoteOptionsVisibleState } from 'src/sandbox/types/NotesOptionsTypes'


type NoteEditorProps = {
  title?: string;
  initialContent?: string | object;
  onUpdate: (content: any) => void;
  isEditable?: boolean;
  onCaretPositionChange?: (position: CaretPosition | null) => void;
}

export default function NoteEditor({ title, initialContent, onUpdate, isEditable = true, onCaretPositionChange }: NoteEditorProps) {

  const handleCaretPosition = handleCaretPositionChange();

  const {
    setNoteOptionsMenuOpen,
    setNoteOptionsMenuPosition,
    setLastActiveEditor
  } = useNotes();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // implementation is replaced by CustomCodeBlock
      }),
      CustomCodeBlock,
      PlaceholderPerLine,
      TaskList,
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'task-item',
        },
      }),
    ],
    content: initialContent ? (typeof initialContent === 'string' ? JSON.parse(initialContent) : initialContent) : { type: 'doc', content: [] },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      onUpdate(json);
    },
    editable: isEditable,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none p-4 min-h-[150px]',
      },
      handleKeyDown: (view, event) => {
        // Only adjust viewport position for navigation keys, not while typing
        const isNavigationKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Backspace'].includes(event.key);
        if (isNavigationKey) {
          handleCaretPosition(getCaretPosition(editor));
        }

        const { $anchor } = editor.state.selection;
        const isAtFirstLine = $anchor.parentOffset === 0 && $anchor.parent === editor.state.doc.firstChild;

        //? when removing a line and we are at the top of the note and the note is empty we remove the note
        if (
          event.key === 'Backspace'
          && editor.isEmpty
          && isAtFirstLine
        ) {
          onUpdate(null);
          return true;
        }


        if (event.key == "/") {
          const { state } = editor;
          const { selection } = state;
          const currentNode = $anchor.parent;

          if (currentNode.textContent !== "") { return; }

          const caretPos = getCaretPosition(editor);

          // Save editor and cursor position before opening menu
          setLastActiveEditor({
            editor: editor,
            position: selection.anchor
          });

          setNoteOptionsMenuPosition({
            x: caretPos ? caretPos.absoluteX : 0,
            y: caretPos ? caretPos.absoluteY : 0,
          });
          setNoteOptionsMenuOpen(NoteOptionsVisibleState.OPEN);
          return true;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          const { state } = view;
          const { selection } = state;

          if (selection instanceof NodeSelection) {
            const node = selection.node;

            if (node && node.type.name === 'codeBlock') {
              setTimeout(() => {
                const selectedCodeBlock = document.querySelector('.code-block.selected');
                const editorId = selectedCodeBlock?.getAttribute('data-code-block-id');

                if (editorId) {
                  const codeMirrorView = (window as any).__codeMirrorEditors?.[editorId];

                  if (codeMirrorView && codeMirrorView.enableEditing) {
                    codeMirrorView.enableEditing();
                  }
                }
              }, 50);
              return true; // Prevent default Enter behavior
            }
          }

          return false;
        }

        return false;
      }
    },
  })

  if (!editor) { return null }

  return (
    <div
      className="note-editor w-full flex flex-col bg-background text-text"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-border text-sm font-semibold overflow-x-auto">
        {title || 'Untitled Note'}
      </div>
      <div className="p-4">
        <EditorContent editor={editor} className="prose prose-zinc dark:prose-invert max-w-none focus:outline-none" />
      </div>
    </div>
  )
}