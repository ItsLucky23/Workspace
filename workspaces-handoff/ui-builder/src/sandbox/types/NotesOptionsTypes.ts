import { faCode, faDivide, faHeading, faInfo, faListCheck, faListDots, faListNumeric, faParagraph } from "@fortawesome/free-solid-svg-icons";

export enum NoteOptions {
  PARAGRAPH = "Paragraph",
  HEADING1 = "Heading 1",
  HEADING2 = "Heading 2",
  HEADING3 = "Heading 3",
  UNORDERED_LIST = "Unordered List",
  ORDERED_LIST = "Ordered List",
  TASK_LIST = "Task List",
  DIVIDER = "Divider",
  HINT = "Hint",
  CODE_BLOCK = "Code Block",
}

export const NoteOptionsIcons: { [key in NoteOptions]: any } = {
  [NoteOptions.PARAGRAPH]: faParagraph,
  [NoteOptions.HEADING1]: faHeading,
  [NoteOptions.HEADING2]: faHeading,
  [NoteOptions.HEADING3]: faHeading,
  [NoteOptions.UNORDERED_LIST]: faListDots,
  [NoteOptions.ORDERED_LIST]: faListNumeric,
  [NoteOptions.TASK_LIST]: faListCheck,
  [NoteOptions.DIVIDER]: faDivide,
  [NoteOptions.HINT]: faInfo,
  [NoteOptions.CODE_BLOCK]: faCode,
}

export enum NoteOptionsVisibleState {
  OPEN = "OPEN",
  CLOSED = "CLOSED",
}

export const NoteOptionsCommands: { [key in NoteOptions]: (editor: any) => void } = {
  [NoteOptions.PARAGRAPH]: (editor) =>
    editor.chain().focus().setParagraph().run(),

  [NoteOptions.HEADING1]: (editor) =>
    editor.chain().focus().toggleHeading({ level: 1 }).run(),

  [NoteOptions.HEADING2]: (editor) =>
    editor.chain().focus().toggleHeading({ level: 2 }).run(),

  [NoteOptions.HEADING3]: (editor) =>
    editor.chain().focus().toggleHeading({ level: 3 }).run(),

  [NoteOptions.UNORDERED_LIST]: (editor) =>
    editor.chain().focus().toggleBulletList().run(),

  [NoteOptions.ORDERED_LIST]: (editor) =>
    editor.chain().focus().toggleOrderedList().run(),

  [NoteOptions.TASK_LIST]: (editor) =>
    editor.chain().focus().toggleTaskList().run(),

  [NoteOptions.DIVIDER]: (editor) =>
    editor.chain().focus().setHorizontalRule().run(),

  [NoteOptions.HINT]: (editor) =>
    // Assuming 'Hint' maps to Blockquote, or a custom node if you have one
    editor.chain().focus().toggleBlockquote().run(),

  [NoteOptions.CODE_BLOCK]: (editor) => {
    // Insert the code block
    editor.chain().focus().setCodeBlock({
      language: 'typescript',
      code: '\n\n\n\n\n\n\n\n\n\n'
    }).run();

    // Poll for Monaco editor to be registered and ready
    let attempts = 0;
    const maxAttempts = 20; // 2 seconds max

    const pollForMonaco = () => {
      attempts++;
      console.log(`🔍 [Auto-focus] Attempt ${attempts}/${maxAttempts}`);

      // The newly inserted code block is automatically selected by TipTap
      const selectedCodeBlock = document.querySelector('.code-block.selected');
      console.log('  Selected code block found:', !!selectedCodeBlock);

      if (!selectedCodeBlock) {
        if (attempts < maxAttempts) {
          setTimeout(pollForMonaco, 100);
        } else {
          console.log('  ❌ Code block never appeared');
        }
        return;
      }

      const monacoId = selectedCodeBlock.getAttribute('data-monaco-id');
      console.log('  Monaco ID:', monacoId);

      if (!monacoId) {
        if (attempts < maxAttempts) {
          setTimeout(pollForMonaco, 100);
        } else {
          console.log('  ❌ Monaco ID never assigned');
        }
        return;
      }

      const monacoEditor = (window as any).__monacoEditors?.[monacoId];
      console.log('  Monaco editor instance:', !!monacoEditor);

      if (monacoEditor) {
        monacoEditor.focus();
        console.log('  ✅ Monaco focused!');
      } else if (attempts < maxAttempts) {
        setTimeout(pollForMonaco, 100);
      } else {
        console.log('  ❌ Monaco editor never registered');
      }
    };

    setTimeout(pollForMonaco, 100);
  },
};