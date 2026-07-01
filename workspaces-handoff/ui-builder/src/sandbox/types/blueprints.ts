import { Viewports } from "./viewportMapping";

export type note = {
  id: string;
  position: { x: number; y: number; };
  title: string; // Title of the note for display and search
  content: string; // JSON content from TipTap
  width: number;
  height: number;
}

export type drawing = {
  id: string;
  position: { x: number; y: number; };
}

export type codeContext = {
  id: string;
  name: string;
  code: string;
  language?: string; // Optional language for Monaco editor
}

/**
 * Unified file type - replaces component, screen, and previous file type
 * Babel compatibility is determined dynamically from filename extension
 */
export type file = {
  id: string;
  position: { x: number; y: number };
  name: string; // Full filename with extension (e.g., "MyComponent.tsx")
  code: string; // Source code content

  // Optional viewport settings for rendered files
  viewport?: Viewports;
  rendered?: boolean;
  // viewport?: {
  //   width: number;
  //   height: number;
  //   enabled: boolean;
  // };

  // View mode: 'card' shows file card UI, 'rendered' shows Babel-compiled output
  viewMode?: 'card' | 'rendered';

  // Metadata
  size?: number; // Original file size in bytes
  lastModified?: number;
}

export type blueprints = {
  files: file[];
  notes: note[];
  drawings: drawing[];
}  