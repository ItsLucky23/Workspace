import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useCallback, useState } from 'react'
import CodeMirrorEditor from '../editor/CodeMirrorEditor'
import { EditorView } from '@codemirror/view'
import { Node, mergeAttributes } from '@tiptap/core'

export const CustomCodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      language: {
        default: 'typescript',
      },
      code: {
        default: '',
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          const code = element.querySelector('code')?.textContent || '';
          const language = element.getAttribute('data-language') || 'typescript';
          return { code, language };
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const code = node.attrs.code;
    const codeText = typeof code === 'string' ? code : (code || '');

    return [
      'pre',
      mergeAttributes(HTMLAttributes, {
        'data-language': node.attrs.language || 'typescript',
      }),
      ['code', {}, codeText]
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent)
  },

  addCommands() {
    return {
      setCodeBlock: (attributes: any) => ({ commands }: any) => {
        return commands.insertContent({
          type: this.name,
          attrs: attributes,
        })
      },
    }
  },
})

function CodeBlockComponent({ node, updateAttributes, selected }: any) {
  const [language, setLanguage] = useState(node.attrs.language || 'typescript');

  // Ensure we have a stable unique ID for this code block instance
  const [uniqueId] = useState(() => node.attrs.id || `cm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  // Track whether CodeMirror is focused to hide outline while typing
  const [isFocused, setIsFocused] = useState(false);

  const onChange = useCallback((value: string | undefined) => {
    updateAttributes({ code: value });
  }, [updateAttributes]);

  return (
    <NodeViewWrapper
      className={`code-block my-4 rounded-md overflow-hidden border border-border bg-background shadow-sm ${selected && !isFocused ? 'selected' : ''}`}
      data-code-block-id={uniqueId}
    >
      <div className="flex items-center justify-between bg-background2 px-3 py-1 border-b border-border">
        <select
          contentEditable={false}
          value={language}
          onChange={(e) => {
            setLanguage(e.target.value);
            updateAttributes({ language: e.target.value });
          }}
          onMouseDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); }}
          className="bg-transparent text-xs text-text outline-none cursor-pointer"
        >
          <option className='bg-background2' value="typescript">TypeScript</option>
          <option className='bg-background2' value="javascript">JavaScript</option>
          <option className='bg-background2' value="html">HTML</option>
          <option className='bg-background2' value="css">CSS</option>
          <option className='bg-background2' value="json">JSON</option>
          <option className='bg-background2' value="python">Python</option>
        </select>
        {/* <div className="text-xs text-muted-foreground">Monaco Editor</div> */}
      </div>
      <div
        className="relative"
        style={{ minHeight: '50px', display: 'flex', flexDirection: 'column' }}
        contentEditable={false}
        onClick={() => {
          // Activate editing on click
          const codeMirrorView = (window as any).__codeMirrorEditors?.[uniqueId];
          if (codeMirrorView && codeMirrorView.enableEditing) {
            codeMirrorView.enableEditing();
          }
        }}
      >
        <CodeMirrorEditor
          value={node.attrs.code || ''}
          onChange={onChange}
          language={language}
          enableCaretTracking={true}
          preventInitialFocus={true}
          onMount={(view) => {
            // Add enableEditing method to view for external focus
            (view as any).enableEditing = () => {
              view.dispatch({
                effects: (view as any)._editableCompartment?.reconfigure?.(EditorView.editable.of(true))
              })
              view.focus()
            }

            // Store globally for keyboard navigation (like Monaco did)
            (window as any).__codeMirrorEditors = (window as any).__codeMirrorEditors || {};
            (window as any).__codeMirrorEditors[uniqueId] = view;
          }}
          onEscape={() => {
            const tiptapEditor = document.querySelector('.ProseMirror');
            if (tiptapEditor) {
              (tiptapEditor as HTMLElement).focus();
            }
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
      </div>
    </NodeViewWrapper>
  )
}
