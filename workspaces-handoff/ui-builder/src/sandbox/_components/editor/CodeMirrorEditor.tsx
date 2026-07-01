import { useEffect, useRef, useMemo } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { handleCaretPositionChange } from '../../_functions/notes/handleCaretPosition'

interface CodeMirrorEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: string
  onEscape?: () => void
  onFocus?: () => void
  onBlur?: () => void
  enableCaretTracking?: boolean
  onMount?: (view: any) => void
  preventInitialFocus?: boolean
}

export default function CodeMirrorEditor({
  value,
  onChange,
  language = 'javascript',
  onEscape,
  onFocus,
  onBlur,
  enableCaretTracking = false,
  onMount,
  preventInitialFocus = false
}: CodeMirrorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const handleCaretPosition = handleCaretPositionChange()

  // Create a compartment for the editable facet so we can reconfigure it
  const editableCompartment = useMemo(() => new Compartment(), [])

  useEffect(() => {
    if (!editorRef.current) return

    // Get language extension
    const getLanguageExtension = () => {
      switch (language) {
        case 'javascript':
        case 'typescript':
          return javascript({ typescript: language === 'typescript' })
        case 'html':
          return html()
        case 'css':
          return css()
        case 'json':
          return json()
        case 'python':
          return python()
        default:
          return javascript()
      }
    }

    // Custom theme matching the dark design with syntax colors
    const customTheme = EditorView.theme({
      '&': {
        backgroundColor: 'transparent',
        height: '100%',
        fontSize: '14px',
        color: '#d4d4d4', // Default text color
      },
      '.cm-content': {
        caretColor: '#fff',
        padding: '0',
        fontFamily: 'monospace',
      },
      '.cm-cursor': {
        borderLeftColor: '#fff',
      },
      '.cm-activeLine': {
        backgroundColor: 'transparent',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'rgba(255, 255, 255, 0.1) !important',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'rgba(255, 255, 255, 0.15) !important',
      },
      '.cm-gutters': {
        display: 'none',
      },
      '.cm-line': {
        padding: '0',
      },
      // Syntax highlighting colors matching VS Code/Monaco
      '.tok-keyword': { color: '#569cd6' }, // Blue for keywords
      '.tok-string': { color: '#ce9178' }, // Orange for strings 
      '.tok-comment': { color: '#6a9955', fontStyle: 'italic' }, // Green for comments
      '.tok-number': { color: '#b5cea8' }, // Light green for numbers
      '.tok-variableName': { color: '#9cdcfe' }, // Light blue for variables
      '.tok-typeName': { color: '#4ec9b0' }, // Teal for types
      '.tok-function': { color: '#dcdcaa' }, // Yellow for function names
      '.tok-operator': { color: '#d4d4d4' }, // White for operators
      '.tok-propertyName': { color: '#9cdcfe' }, // Light blue for properties
      '.tok-punctuation': { color: '#d4d4d4' }, // White for punctuation
      '.tok-tagName': { color: '#569cd6' }, // Blue for HTML tags
      '.tok-attributeName': { color: '#9cdcfe' }, // Light blue for attributes
      '.tok-className': { color: '#4ec9b0' }, // Teal for classes
      '.tok-definition': { color: '#dcdcaa' }, // Yellow for definitions
      '.tok-meta': { color: '#569cd6' }, // Blue for meta
    }, { dark: true })

    // Escape key handler
    const escapeKeymap = keymap.of([
      {
        key: 'Escape',
        run: () => {
          if (onEscape) {
            onEscape()
            return true
          }
          return false
        }
      }
    ])

    // Custom syntax highlighting style (VS Code colors)
    const customHighlightStyle = HighlightStyle.define([
      { tag: tags.keyword, color: '#569cd6' }, // Blue
      { tag: tags.name, color: '#9cdcfe' }, // Light blue
      { tag: tags.deleted, color: '#f44747' },
      { tag: tags.inserted, color: '#608b4e' },
      { tag: tags.changed, color: '#569cd6' },
      { tag: tags.invalid, color: '#f44747' },
      { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' }, // Green
      { tag: tags.string, color: '#ce9178' }, // Orange
      { tag: tags.number, color: '#b5cea8' }, // Light green
      { tag: tags.bool, color: '#569cd6' },
      { tag: tags.regexp, color: '#d16969' },
      { tag: tags.escape, color: '#d7ba7d' },
      { tag: tags.variableName, color: '#9cdcfe' }, // Light blue
      { tag: tags.function(tags.variableName), color: '#dcdcaa' }, // Yellow for functions
      { tag: tags.propertyName, color: '#9cdcfe' },
      { tag: tags.className, color: '#4ec9b0' }, // Teal
      { tag: tags.typeName, color: '#4ec9b0' },
      { tag: tags.namespace, color: '#4ec9b0' },
      { tag: tags.operator, color: '#d4d4d4' },
      { tag: tags.punctuation, color: '#d4d4d4' },
      { tag: tags.bracket, color: '#ffd700' }, // Gold for brackets
      { tag: tags.tagName, color: '#569cd6' },
      { tag: tags.attributeName, color: '#9cdcfe' },
    ])

    // Create editor state
    const startState = EditorState.create({
      doc: value,
      extensions: [
        getLanguageExtension(),
        customTheme,
        keymap.of([...defaultKeymap, indentWithTab]),
        escapeKeymap,
        syntaxHighlighting(customHighlightStyle),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChange) {
            onChange(update.state.doc.toString())
          }

          // Handle focus/blur
          if (update.focusChanged) {
            if (update.view.hasFocus) {
              onFocus?.()
            } else {
              onBlur?.()
            }
          }

          // Track cursor position for grid auto-scroll
          if (enableCaretTracking && (update.selectionSet || update.geometryChanged)) {
            const selection = update.state.selection.main
            const coords = update.view.coordsAtPos(selection.head)
            if (coords && editorRef.current) {
              const caretPosition = {
                absoluteX: coords.left,
                absoluteY: coords.top,
                viewportPercentage: (coords.top / window.innerHeight) * 100,
                viewportPercentageX: (coords.left / window.innerWidth) * 100,
                isInViewport: true,
                offset: 0,
                offsetNode: editorRef.current as unknown as globalThis.Node,
                getClientRect: () => new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
              }
              handleCaretPosition(caretPosition)
            }
          }
        }),
        EditorView.lineWrapping,
        // Make editor non-interactive until explicitly focused
        ...(preventInitialFocus ? [
          editableCompartment.of(EditorView.editable.of(false)),
        ] : []),
      ],
    })

    // Create view
    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
      ...(preventInitialFocus && {
        // Prevent focus on mousedown to let TipTap handle block selection first
        dispatch(tr) {
          view.update([tr])
          return true
        }
      })
    })

    viewRef.current = view

    // Store editableCompartment on view for external access
    if (preventInitialFocus) {
      (view as any)._editableCompartment = editableCompartment
    }

    // Call onMount callback with view instance
    if (onMount) {
      onMount(view)
    }

    // Make editor editable when it gains focus (if preventInitialFocus is enabled)
    if (preventInitialFocus && editorRef.current) {
      const editorElement = editorRef.current;

      editorElement.addEventListener('focusin', () => {
        if (view) {
          // Make editable
          view.dispatch({
            effects: editableCompartment.reconfigure(EditorView.editable.of(true))
          })
          // Re-enable pointer events
          if (editorElement) {
            editorElement.style.pointerEvents = 'auto';
          }
        }
      })
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [language]) // Recreate when language changes

  // Update content when value changes externally
  useEffect(() => {
    if (viewRef.current && value !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: value,
        },
      })
    }
  }, [value])

  return <div ref={editorRef} className="w-full h-full" />
}
