/** @docs owner ItsLucky23 */
//? @adr 0276
//? DESIGN_DOCS_PROGRAM 3.4 / A09 — apply the active design tokens without replacing a project's
//? stylesheet. Only color declarations inside one unambiguous Tailwind `@theme` block (and, when
//? supplied, one `.dark` token block) may change; every other byte is retained.

import type { PrismaClient } from '@prisma/client';

export interface DesignTokenSet {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export type ActiveThemeTokensResult =
  | { ok: true; tokens: DesignTokenSet }
  | { ok: false; error: 'design.noActiveTheme' | 'design.invalidTokens' };

export type PatchManagedThemeResult =
  | { ok: true; css: string; changed: boolean }
  | { ok: false; error: 'design.tokensNotTailwind' | 'design.tokensManagedBlockMissing' | 'design.tokensManagedBlockAmbiguous' };

export type DesignTokenCssPathResult =
  | { ok: true; path: string }
  | { ok: false; error: 'design.invalidServicePath' };

const TOKEN_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function hasControlCharacter(value: string): boolean {
  for (const char of value) if ((char.codePointAt(0) ?? 32) < 32) return true;
  return false;
}

//? Theme artifacts are AI/user-authored JSON. Reject values that could terminate a declaration or
//? escape the managed block; token application is fail-closed rather than a CSS-injection path.
function tokenMap(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const tokens: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!TOKEN_KEY.test(key) || typeof raw !== 'string') return null;
    const cssValue = raw.trim();
    if (cssValue.length === 0 || cssValue.length > 500 || /[;{}]/.test(cssValue) || hasControlCharacter(cssValue) || cssValue.includes('/*')) return null;
    tokens[key] = cssValue;
  }
  return tokens;
}

function objectField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.entries(value).find(([key]) => key === field)?.[1];
}

//? Resolve the active theme as validated token data, not a replacement stylesheet.
export async function activeThemeTokens(prisma: PrismaClient, workspaceId: string): Promise<ActiveThemeTokensResult> {
  const theme = await prisma.designArtifact.findFirst({ where: { workspaceId, kind: 'theme', active: true }, select: { content: true } });
  if (!theme) return { ok: false, error: 'design.noActiveTheme' };
  const lightField = objectField(theme.content, 'light');
  const darkField = objectField(theme.content, 'dark');
  const light = lightField === undefined ? {} : tokenMap(lightField);
  const dark = darkField === undefined ? {} : tokenMap(darkField);
  if (!light || !dark || (Object.keys(light).length === 0 && Object.keys(dark).length === 0)) {
    return { ok: false, error: 'design.invalidTokens' };
  }
  return { ok: true, tokens: { light, dark } };
}

//? A Service.path is repo-relative. Keep the root-project default, but reject absolute/traversing or
//? control-character paths before they become a git path. Backslashes are accepted as separators.
export function designTokenCssPath(servicePath?: string | null): DesignTokenCssPathResult {
  const raw = (servicePath ?? '.').trim().replaceAll('\\', '/');
  if (/^(?:\/|[A-Za-z]:)/.test(raw) || hasControlCharacter(raw)) return { ok: false, error: 'design.invalidServicePath' };
  const parts = raw.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.some((part) => part === '..' || part.includes(':'))) return { ok: false, error: 'design.invalidServicePath' };
  return { ok: true, path: [...parts, 'src', 'index.css'].join('/') };
}

interface CssBlock {
  open: number;
  close: number;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

interface TokenDeclaration {
  key: string;
  valueStart: number;
  valueEnd: number;
  indent: string;
}

//? Remove comments while retaining source length, quotes and line endings. Used only to establish
//? whether Tailwind itself is imported without accepting an `@import` hidden in a comment.
function commentsMasked(css: string): string {
  let masked = '';
  let inComment = false;
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i] ?? '';
    const next = css[i + 1] ?? '';
    if (!inComment && char === '/' && next === '*') {
      masked += '  ';
      inComment = true;
      i += 1;
    } else if (inComment && char === '*' && next === '/') {
      masked += '  ';
      inComment = false;
      i += 1;
    } else if (inComment) {
      masked += char === '\r' || char === '\n' ? char : ' ';
    } else {
      masked += char;
    }
  }
  return masked;
}

//? Mask comments AND strings so braces or selectors in either cannot affect block discovery. Length
//? and line endings stay identical, letting all matches address the untouched original string.
function syntaxMasked(css: string): string {
  let masked = '';
  let inComment = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i] ?? '';
    const next = css[i + 1] ?? '';
    if (inComment) {
      if (char === '*' && next === '/') {
        masked += '  ';
        inComment = false;
        i += 1;
      } else {
        masked += char === '\r' || char === '\n' ? char : ' ';
      }
      continue;
    }
    if (quote !== null) {
      masked += char === '\r' || char === '\n' ? char : ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '*') {
      masked += '  ';
      inComment = true;
      i += 1;
    } else if (char === '"' || char === "'") {
      masked += ' ';
      quote = char;
    } else {
      masked += char;
    }
  }
  return masked;
}

function depthBefore(mask: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (mask[i] === '{') depth += 1;
    else if (mask[i] === '}') depth -= 1;
  }
  return depth;
}

function closingBrace(mask: string, open: number): number | null {
  let depth = 0;
  for (let i = open; i < mask.length; i += 1) {
    if (mask[i] === '{') depth += 1;
    else if (mask[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

function topLevelBlocks(mask: string, pattern: RegExp): CssBlock[] {
  const blocks: CssBlock[] = [];
  let match = pattern.exec(mask);
  while (match !== null) {
    if (depthBefore(mask, match.index) === 0) {
      const open = mask.indexOf('{', match.index);
      const close = open === -1 ? null : closingBrace(mask, open);
      if (open !== -1 && close !== null) blocks.push({ open, close });
    }
    match = pattern.exec(mask);
  }
  return blocks;
}

function declarationsInBlock(css: string, mask: string, block: CssBlock): TokenDeclaration[] {
  const innerStart = block.open + 1;
  const innerMask = mask.slice(innerStart, block.close);
  const pattern = /^([ \t]*--color-([A-Za-z0-9_-]+)[ \t]*:[ \t]*)([^;\r\n]*)(;[^\r\n]*)(\r?\n|$)/gm;
  const declarations: TokenDeclaration[] = [];
  let match = pattern.exec(innerMask);
  while (match !== null) {
    const prefix = match[1];
    const key = match[2];
    const value = match[3];
    if (prefix !== undefined && key !== undefined && value !== undefined) {
      const lineStart = innerStart + match.index;
      const valueStart = lineStart + prefix.length;
      const indentEnd = prefix.indexOf('--color-');
      declarations.push({ key, valueStart, valueEnd: valueStart + value.length, indent: indentEnd === -1 ? '  ' : prefix.slice(0, indentEnd) });
    }
    match = pattern.exec(innerMask);
  }
  return declarations;
}

function patchBlock(css: string, mask: string, block: CssBlock, tokens: Record<string, string>): { ok: true; replacements: Replacement[] } | { ok: false; error: 'missing' | 'ambiguous' } {
  const declarations = declarationsInBlock(css, mask, block);
  if (declarations.length === 0) return { ok: false, error: 'missing' };
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (seen.has(declaration.key)) return { ok: false, error: 'ambiguous' };
    seen.add(declaration.key);
  }

  const replacements: Replacement[] = [];
  for (const declaration of declarations) {
    const nextValue = tokens[declaration.key];
    if (nextValue === undefined) continue;
    const previous = css.slice(declaration.valueStart, declaration.valueEnd);
    const commentAt = previous.indexOf('/*');
    const valuePart = commentAt === -1 ? previous : previous.slice(0, commentAt);
    const suffix = commentAt === -1 ? '' : previous.slice(commentAt);
    const trailingSpace = /[ \t]*$/.exec(valuePart)?.[0] ?? '';
    replacements.push({ start: declaration.valueStart, end: declaration.valueEnd, text: `${nextValue}${trailingSpace}${suffix}` });
  }

  const missing = Object.entries(tokens).filter(([key]) => !seen.has(key));
  if (missing.length > 0) {
    const newline = css.includes('\r\n') ? '\r\n' : '\n';
    const indent = declarations[0]?.indent ?? '  ';
    const inner = css.slice(block.open + 1, block.close);
    const leadingNewline = inner.length > 0 && !inner.endsWith('\n') && !inner.endsWith('\r') ? newline : '';
    const added = missing.map(([key, value]) => `${indent}--color-${key}: ${value};${newline}`).join('');
    replacements.push({ start: block.close, end: block.close, text: `${leadingNewline}${added}` });
  }
  return { ok: true, replacements };
}

//? Patch only declarations in structurally-recognised managed blocks. No block is ever created and
//? no whole-file template is generated: non-Tailwind, missing and ambiguous layouts fail closed.
export function patchManagedThemeCss(css: string, tokens: DesignTokenSet): PatchManagedThemeResult {
  const importSource = commentsMasked(css);
  if (!/@import\s+(?:url\(\s*)?["']tailwindcss(?:\/[^"']*)?["']/.test(importSource)) {
    return { ok: false, error: 'design.tokensNotTailwind' };
  }

  const mask = syntaxMasked(css);
  const themeBlocks = topLevelBlocks(mask, /^[ \t]*@theme[ \t]*\{/gm);
  if (themeBlocks.length === 0) return { ok: false, error: 'design.tokensManagedBlockMissing' };
  if (themeBlocks.length !== 1) return { ok: false, error: 'design.tokensManagedBlockAmbiguous' };

  const themeBlock = themeBlocks[0];
  if (!themeBlock) return { ok: false, error: 'design.tokensManagedBlockMissing' };
  const lightPatch = patchBlock(css, mask, themeBlock, tokens.light);
  if (!lightPatch.ok) {
    return { ok: false, error: lightPatch.error === 'ambiguous' ? 'design.tokensManagedBlockAmbiguous' : 'design.tokensManagedBlockMissing' };
  }

  const replacements = [...lightPatch.replacements];
  if (Object.keys(tokens.dark).length > 0) {
    const darkBlocks = topLevelBlocks(mask, /^[ \t]*\.dark[ \t]*\{/gm);
    if (darkBlocks.length === 0) return { ok: false, error: 'design.tokensManagedBlockMissing' };
    if (darkBlocks.length !== 1) return { ok: false, error: 'design.tokensManagedBlockAmbiguous' };
    const darkBlock = darkBlocks[0];
    if (!darkBlock) return { ok: false, error: 'design.tokensManagedBlockMissing' };
    const darkPatch = patchBlock(css, mask, darkBlock, tokens.dark);
    if (!darkPatch.ok) {
      return { ok: false, error: darkPatch.error === 'ambiguous' ? 'design.tokensManagedBlockAmbiguous' : 'design.tokensManagedBlockMissing' };
    }
    replacements.push(...darkPatch.replacements);
  }

  let patched = css;
  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    patched = `${patched.slice(0, replacement.start)}${replacement.text}${patched.slice(replacement.end)}`;
  }
  return { ok: true, css: patched, changed: patched !== css };
}
