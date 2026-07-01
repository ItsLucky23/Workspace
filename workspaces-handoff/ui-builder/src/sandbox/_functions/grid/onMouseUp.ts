import { useEffect } from "react";
import { useGrid } from "../../_providers/GridContextProvider";
import { useCode } from "../../_providers/CodeContextProvider";
import { CreateComponentMenuVisibleState } from "../../types/createComponentMenuTypes";
import { BuilderMenuMode, useBuilderPanel } from "../../_providers/BuilderPanelContextProvider";
import { useMenus } from "../../_providers/MenusContextProvider";
import { useNotes } from "src/sandbox/_providers/NotesContextProvider";
import { NoteOptionsVisibleState } from "src/sandbox/types/NotesOptionsTypes";

export default function useOnMouseUp() {

  const {
    setDragging,
    draggingRef,
    posMouseDown
  } = useGrid();

  const {
    noteOptionsMenuOpen,
    wasNoteRecentlyActive,
    setWasNoteRecentlyActive
  } = useNotes();

  const {
    lastPositionWindowDivider,
    windowDividerDragging,
    setWindowDivider,
    setWindowDividerPosition,
    setBuilderMenuMode,
    setPrevBuilderMenuMode
  } = useBuilderPanel();

  const {
    setCreateComponentMenuPosition,
    setCreateComponentMenuOpen
  } = useMenus();

  const {
    activeCodeWindow,
    setActiveCodeWindow
  } = useCode();

  const handleOnMouseUp = (e: MouseEvent, leaveEvent: boolean) => {
    e.preventDefault();
    draggingRef.current = false;
    setDragging(false);

    const lastX = posMouseDown.current.x;
    const lastY = posMouseDown.current.y;
    if (!lastX || !lastY) { return };

    const elem = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
    if (elem && elem.closest('#createComponentMenu')) { return; }

    if (elem && elem.closest('.VIEW')) { return; }
    if (elem && elem.closest('.MENU')) { return; }
    if (elem && elem.closest('.dropdown')) { return; }

    const horizontalDifference = Math.abs(lastX - e.clientX);
    const verticalDifference = Math.abs(lastY - e.clientY);
    if (horizontalDifference < 2 && verticalDifference < 2) {

      if (!leaveEvent) {
        setActiveCodeWindow(null);
        setBuilderMenuMode(prev => {
          if (prev !== BuilderMenuMode.CLOSED) {
            setPrevBuilderMenuMode(prev);
          }
          return BuilderMenuMode.CLOSED;
        });
      }

      if (activeCodeWindow) { return; }
      if (noteOptionsMenuOpen == NoteOptionsVisibleState.OPEN) { return; }

      // Don't open menu if user was recently active in a note
      if (wasNoteRecentlyActive) {
        setWasNoteRecentlyActive(false);
        return;
      }

      setCreateComponentMenuOpen(prev => {
        if (prev === CreateComponentMenuVisibleState.FORCECLOSE) {
          return CreateComponentMenuVisibleState.CLOSED;
        }
        return CreateComponentMenuVisibleState.OPEN;
      });
      setCreateComponentMenuPosition({ x: e.clientX, y: e.clientY });
    }
  };

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      e.preventDefault();

      setWindowDivider(false);
      windowDividerDragging.current = false;

      setWindowDividerPosition(lastPositionWindowDivider.current = 50);
    }

    const handleMouseUp = (e: MouseEvent) => onMouseUp(e);
    const handleMouseLeave = (e: MouseEvent) => onMouseUp(e);

    window.addEventListener("mouseup", handleMouseUp, { passive: false });
    window.addEventListener("mouseleave", handleMouseLeave, { passive: false });
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [])

  return { handleOnMouseUp }

}