import { getFileExtension } from './fileUtils';

export const BABEL_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'] as const;

export const VIEWPORT_PRESETS = {
  LAPTOP: { width: 1440, height: 900 },
  TABLET: { width: 768, height: 1024 },
  PHONE: { width: 375, height: 667 },
  NONE: { width: 800, height: 600 }
} as const;

export function isBabelCompatible(filename: string): boolean {
  const ext = getFileExtension(filename);
  return BABEL_EXTENSIONS.some(babelExt => babelExt === `.${ext}`);
}

export function getFilenameWithoutExtension(filename: string): string {
  if (!filename) return '';
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? filename : filename.substring(0, lastDot);
}

// Validate filename format (basic validation)
export function isValidFilename(filename: string): boolean {
  if (!filename || filename.trim() === '') return false;
  const invalidChars = /[<>:"|?*]/;
  return !invalidChars.test(filename);
}
