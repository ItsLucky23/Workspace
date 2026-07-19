//? Designer — a curated font library for quickly TESTING different typefaces. These are all
//? web-safe / system font stacks (no webfont download needed → they render everywhere, no CSP or
//? flash-of-fallback surprises), chosen to give real variety across sans / serif / mono / display.
//? The FontPicker (in ui.tsx) renders each option IN its own font so you can compare at a glance.

export type FontCategory = 'sans' | 'serif' | 'mono' | 'display';
export interface FontOption { id: string; name: string; stack: string; category: FontCategory }

export const FONT_LIBRARY: FontOption[] = [
  // sans
  { id: 'system', name: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', category: 'sans' },
  { id: 'apple', name: 'SF · Apple', stack: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif', category: 'sans' },
  { id: 'helvetica', name: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif', category: 'sans' },
  { id: 'arial', name: 'Arial', stack: 'Arial, "Helvetica Neue", sans-serif', category: 'sans' },
  { id: 'verdana', name: 'Verdana', stack: 'Verdana, Geneva, sans-serif', category: 'sans' },
  { id: 'trebuchet', name: 'Trebuchet', stack: '"Trebuchet MS", Verdana, sans-serif', category: 'sans' },
  { id: 'tahoma', name: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif', category: 'sans' },
  { id: 'geometric', name: 'Geometric', stack: '"Century Gothic", "URW Gothic", "Apple SD Gothic Neo", sans-serif', category: 'sans' },
  // serif
  { id: 'georgia', name: 'Georgia', stack: 'Georgia, "Times New Roman", serif', category: 'serif' },
  { id: 'times', name: 'Times', stack: '"Times New Roman", Times, serif', category: 'serif' },
  { id: 'palatino', name: 'Palatino', stack: '"Palatino Linotype", "Book Antiqua", Palatino, serif', category: 'serif' },
  { id: 'garamond', name: 'Garamond', stack: 'Garamond, "Hoefler Text", "Times New Roman", serif', category: 'serif' },
  { id: 'slab', name: 'Slab', stack: 'Rockwell, "Roboto Slab", "Courier New", serif', category: 'serif' },
  // mono
  { id: 'mono', name: 'Monospace', stack: 'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", monospace', category: 'mono' },
  { id: 'courier', name: 'Courier', stack: '"Courier New", Courier, monospace', category: 'mono' },
  { id: 'consolas', name: 'Consolas', stack: 'Consolas, "Lucida Console", "Liberation Mono", monospace', category: 'mono' },
  // display
  { id: 'impact', name: 'Impact', stack: 'Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif', category: 'display' },
  { id: 'copperplate', name: 'Copperplate', stack: '"Copperplate", "Copperplate Gothic Light", fantasy', category: 'display' },
  { id: 'brush', name: 'Handwritten', stack: '"Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive', category: 'display' },
];

//? Find the library option whose stack matches, so a picker can show the current selection
//? (a custom hand-typed stack simply matches nothing → the picker shows it as custom).
export function fontByStack(stack: string): FontOption | undefined {
  const norm = stack.trim().toLowerCase();
  return FONT_LIBRARY.find((f) => f.stack.toLowerCase() === norm);
}
