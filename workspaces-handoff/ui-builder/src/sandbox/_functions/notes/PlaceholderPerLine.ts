import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const PlaceholderPerLine = Extension.create({
  name: 'placeholderPerLine',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('placeholderPerLine'),
        props: {
          decorations: (state) => {
            const { doc, selection } = state
            const decorations: Decoration[] = []

            const { $anchor } = selection

            doc.descendants((node, pos) => {
              const isCursorInNode = pos <= $anchor.pos && $anchor.pos <= pos + node.nodeSize

              if (
                node.isTextblock &&
                node.content.size === 0 &&
                isCursorInNode
              ) {
                const decoration = Decoration.node(pos, pos + node.nodeSize, {
                  class: 'is-empty-with-placeholder',
                  'data-placeholder': 'Type / for commands',
                })
                decorations.push(decoration)
              }
            })

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
