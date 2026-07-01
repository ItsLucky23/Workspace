import * as monaco from 'monaco-editor';

export default function generateThemes(monaco: typeof import("monaco-editor")) {
  traeDarkTheme(monaco);
}

const scopeMap: Record<string, string> = {

  "variable": "identifier",

  // Types
  "entity.name.type": "type",

  // Keywords
  "constant.numeric": "number",

  // Comments
  "comment": "comment",
};

const colorParser = (tokens: any[]) => {
  const tokenColors: monaco.editor.ITokenThemeRule[] = [];

  for (const token of tokens) {
    if (!token.scope) continue; // skip tokens without a scope
    const scopes = Array.isArray(token.scope) ? token.scope : [token.scope];
    for (const scope of scopes) {
      tokenColors.push({
        // token: scope,
        token: scopeMap[scope] || scope,
        foreground: token.settings.foreground?.replace("#", ""),
        fontStyle: token.settings.fontStyle,
      });
    }
  }

  return tokenColors;
};


import traeDarkColor from "./trae_dark_color.json"
import traeDarkPlus from "./trae_dark_plus.json"
import traeDarkVs from "./trae_dark_vs.json"

export const traeDarkTheme = (monaco: typeof import("monaco-editor")) => {
  // Combine tokenColors from both VSCode files
  const tokenColors = [
    ...colorParser(traeDarkVs.tokenColors || []),
    ...colorParser(traeDarkPlus.tokenColors || []),
  ];

  // Merge editor colors
  const colors = {
    ...(traeDarkColor.colors || {}),
    ...(traeDarkVs.colors || {}),
  };

  // Define Monaco theme
  monaco.editor.defineTheme("trae-dark", {
    base: "vs-dark",
    inherit: true,
    rules: tokenColors,
    colors,
    encodedTokensColors: [],
  });
};