import { Editor } from '@tiptap/react';

export interface CaretPosition {
  absoluteY: number;
  viewportPercentage: number;
  absoluteX: number;
  viewportPercentageX: number;
  isInViewport: boolean;
  offset: number;
  offsetNode: Node;
  getClientRect: () => DOMRect;
}

export function getCaretPosition(editor: Editor | null): CaretPosition | null {
  if (!editor) {
    return null;
  }

  const { view, state } = editor;
  const { selection } = state;

  const { from } = selection;

  try {
    const coords = view.coordsAtPos(from);

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const viewportPercentage = (coords.top / viewportHeight) * 100;
    const viewportPercentageX = (coords.left / viewportWidth) * 100;

    const isInViewport =
      coords.top >= 0 &&
      coords.top <= viewportHeight &&
      coords.left >= 0 &&
      coords.left <= viewportWidth;

    const domAtPos = view.domAtPos(from);
    const offsetNode = domAtPos.node;

    return {
      absoluteY: coords.top,
      viewportPercentage: Math.max(0, Math.min(100, viewportPercentage)),
      absoluteX: coords.left,
      viewportPercentageX: Math.max(0, Math.min(100, viewportPercentageX)),
      isInViewport,
      offset: from,
      offsetNode: offsetNode,
      getClientRect: () => {
        return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
      },
    };
  } catch (error) {
    console.error('Error getting caret position:', error);
    return null;
  }
}
