import { useEffect, useState } from "react";
import { useGrid } from "../../_providers/GridContextProvider";
import CreateComponentMenu from "../menus/CreateComponentMenu";
import { blueprints, file } from "../../types/blueprints";
import { useBlueprints } from "../../_providers/BlueprintsContextProvider";
import DrawingLayer from "../drawing/DrawingLayer";
import BottomLeftMenu from "../menus/BottomLeftMenu";
import DrawingSideMenu from "../drawing/DrawingSideMenu";
import DrawingTopMenu from "../drawing/DrawingTopMenu";
import Note from "../notes/Note";
import File from "../files/File";
import useOnMouseDown from "src/sandbox/_functions/grid/onMouseDown";
import useOnMouseUp from "src/sandbox/_functions/grid/onMouseUp";
import useOnMouseMove from "src/sandbox/_functions/grid/onMouseMove";
import useOnMouseWheel from "src/sandbox/_functions/grid/onMouseWheel";
import useOnFileDrop from "src/sandbox/_functions/grid/onFileDrop";
import { useGridKeyboardShortcuts } from "src/sandbox/_functions/grid/useGridKeyboardShortcuts";
import { isBabelCompatible } from "src/sandbox/_functions/files/babelUtils";
import NoteOptionsMenu from "../menus/NoteOptionsMenu";
import Render from "../files/Render";
import { Viewports } from "src/sandbox/types/viewportMapping";
import Minimap from "./Minimap";

const dummyData = {
  files: [
    {
      id: "view1",
      name: "View1.tsx",
      position: { x: 100, y: 100 },
      viewport: Viewports.LAPTOP,
      code:
        `import React, { useState, useEffect } from "react";
export default function View1() {

  const [name, setName] = useState("Mike")

  useEffect(() => {
    console.log(name)
  }, [name])

  return (
    <div className={"bg-blue-500"}>
      <div>hey {name}!!</div>
      <button 
        className="px-6 py-2"
        onClick={() => {setName(prev => prev == 'Mike' ? 'Jimbo' : 'Mike')}}
      >
        Click me
      </button>
    </div>
  );
}`
    },
    {
      id: "view2",
      name: "View2.tsx",
      position: { x: 1300, y: 1300 },
      // viewport: { width: 1440, height: 900, enabled: true },
      viewport: Viewports.TABLET,
      code: `
import React from "react";
export default function View2() {
  return <div>View 2</div>;
  return <div>View 2</div>;
  return <div>View 2</div>;
  return <div>View 2</div>;
}
      `
    },
    {
      id: "comp1",
      name: "Component1.tsx",
      position: { x: 2000, y: 100 },
      code: `
import React from "react";
export default function Component1() {
  return <div>Component 1</div>;
  return <div>Component 1</div>;
  return <div>Component 1</div>;
  return <div>Component 1</div>;
}
      `
    },
  ],
  notes: [
    {
      id: "note1",
      position: { x: 1900, y: 600 },
      title: "Project Notes",
      width: 400,
      height: 300,
      content: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Project Notes' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Here is a sample note with a code block:' }] },
          { type: 'codeBlock', attrs: { language: 'typescript', code: "console.log('Hello World');" } }
        ]
      })
    }
  ],
  drawings: [],
}

export default function Grid() {
  const {
    containerRef,
    dragging,
    zoom,
    offset,
    isTransitioning
  } = useGrid();


  const {
    blueprints,
    setBlueprints,
    setLocalBlueprints,
  } = useBlueprints();

  // Load initial data (dummy for now, from DB in future)
  // Use setLocalBlueprints so it's not overwritten by the merge effect
  useEffect(() => {
    // For initial load, set local blueprints (this is YOUR data)
    // In future: this will come from DB via socket sync
    setLocalBlueprints(dummyData as blueprints);
  }, [])

  const [showZoom, setShowZoom] = useState(false);

  useEffect(() => {
    setShowZoom(true);
  }, [zoom]);

  useEffect(() => {
    if (!showZoom) { return; }
    const timeout = setTimeout(() => setShowZoom(false), 1000);
    return () => clearTimeout(timeout);
  }, [showZoom, zoom]);

  // Using the new hook approach
  useOnMouseWheel(); // Sets up wheel event listener internally
  useGridKeyboardShortcuts(); // Grid-level Ctrl+Z/Y for undo/redo
  const { handleMouseMove } = useOnMouseMove();
  const { handleOnMouseUp } = useOnMouseUp();
  const { handleMouseDown } = useOnMouseDown();
  const { handleDragOver, handleDrop } = useOnFileDrop();

  const [dragOver, setDragOver] = useState(false);

  // Calculate grid style values
  const spacing = zoom > 1 ? 50 : 100;
  const opacity = 0.2;
  const isLineGrid = zoom > 1;
  const snappedSize = Math.round(spacing * zoom);
  const snappedOffsetX = Math.round(offset.x);
  const snappedOffsetY = Math.round(offset.y);
  const dotSize = Math.max(1, Math.min(2, zoom * 2));

  return (
    //* THIS DIV IS THE GRID BACKGROUND
    <div
      style={{
        width: "100%",
        overflow: "hidden",
        position: "relative",
        cursor: dragging ? "grabbing" : "",

        // Prevent browser overscroll bounce and touch gesture interference
        overscrollBehavior: "none",
        touchAction: "none",

        // Use CSS variables for dynamic values to avoid expensive style recalculations
        // This prevents lag when DevTools Elements tab is open
        ['--grid-size' as string]: `${snappedSize}px`,
        ['--grid-offset-x' as string]: `${snappedOffsetX}px`,
        ['--grid-offset-y' as string]: `${snappedOffsetY}px`,
        ['--grid-opacity' as string]: opacity,
        ['--dot-size' as string]: `${dotSize}px`,

        backgroundSize: 'var(--grid-size) var(--grid-size)',
        backgroundPosition: 'var(--grid-offset-x) var(--grid-offset-y)',
        backgroundImage: isLineGrid
          ? `linear-gradient(rgba(255,255,255,var(--grid-opacity)) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,var(--grid-opacity)) 1px, transparent 1px)`
          : `radial-gradient(circle, rgba(255,255,255,var(--grid-opacity)) var(--dot-size), transparent var(--dot-size))`,
        // Animate background when transitioning to center
        transition: isTransitioning ? 'background-size 0.5s ease-out, background-position 0.5s ease-out' : 'none',
      }}
      className="bg-grid h-full"
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()} //? makes it so we cant open the menu on right click
      onMouseDown={(e) => handleMouseDown(e.nativeEvent)}
      onMouseUp={(e) => handleOnMouseUp(e.nativeEvent, false)}
      onMouseLeave={(e) => handleOnMouseUp(e.nativeEvent, true)}
      onMouseMove={(e) => handleMouseMove(e.nativeEvent)}
      onDragOver={(e) => {
        handleDragOver(e.nativeEvent);
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        handleDrop(e.nativeEvent);
        setDragOver(false);
      }}
    >

      {/* percentage */}
      <div className={`absolute top-2 border border-border ${showZoom ? 'opacity-100' : 'opacity-0'} z-50 transition-all duration-200 left-2 bg-background text-text text-sm px-4 py-1 rounded`}>
        {(zoom * 100).toString().endsWith(".5") ? (zoom * 100).toFixed(1) : (zoom * 100).toFixed(0)}%
      </div>

      <div className="pointer-events-auto">
        <BottomLeftMenu />

        <CreateComponentMenu />

        <NoteOptionsMenu />

        <DrawingSideMenu />

        <DrawingTopMenu />

        <Minimap />
      </div>

      {/* //* THIS DIV MAKES IT SO THE PANNING AND ZOOMING AFFECTS THE CONTENT */}
      <div
        className="h-full w-full"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "absolute",
          top: 0,
          left: 0,
          transition: isTransitioning ? 'transform 0.5s ease-out' : 'none',
        }}
      >
        {/* Notes Layer */}
        {blueprints.notes.map((note) => (
          <Note key={note.id} note={note} />
        ))}

        {/* Files Layer - renders both code modules and uploaded files */}
        {blueprints.files?.map((file) => {
          // Check file type and view mode (with null safety)
          const isBabelFile = file.name ? isBabelCompatible(file.name) : false;

          const shouldRenderAsScreen = isBabelFile && file.viewMode === 'rendered';

          if (shouldRenderAsScreen && isBabelFile) {
            return <Render
              key={file.id}
              file={file}
              setFile={(update: Partial<file>) => {
                setBlueprints(prev => ({
                  ...prev,
                  files: prev.files.map(f =>
                    f.id === file.id
                      ? {
                        ...f,
                        ...update
                      }
                      : f
                  )
                }))
              }
              }
            />;
          } else {
            // Render as file card
            return <File key={file.id} fileBlueprint={file} />;
          }
        })}

        {blueprints.drawings.map(() => {
          // instance is type drawing
          return null; // render nothing
        })}
      </div>

      {/* Drag-and-drop visual indicator */}
      {dragOver && (
        <div
          className="absolute inset-0 pointer-events-none border-4 border-dashed border-primary bg-primary/10 z-50"
          style={{
            borderRadius: '8px',
          }}
        />
      )}

      <DrawingLayer />

    </div>
  )
}