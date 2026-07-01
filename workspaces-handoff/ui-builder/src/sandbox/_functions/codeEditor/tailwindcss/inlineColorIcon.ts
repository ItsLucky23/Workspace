import * as monaco from "monaco-editor";

export default function InitInlineColorIcon(
  editorInstance: monaco.editor.IStandaloneCodeEditor,
  extractColorValue: (cls: string) => string | null = () => null
) {
  let tailwindColorDecorationIds: string[] = [];

  const updateColorIcons = () => {
    const model = editorInstance.getModel();
    if (!model) return;

    const newColorDecorations = findTailwindColors(model, extractColorValue);

    tailwindColorDecorationIds = editorInstance.deltaDecorations(
      tailwindColorDecorationIds,
      newColorDecorations
    );
  }

  updateColorIcons();

  return editorInstance.onDidChangeModelContent(updateColorIcons);
}

function findTailwindColors(
  model: monaco.editor.ITextModel,
  extractColorValue: (cls: string) => string | null = () => null,
) {
  const regex = /\b(?:text|decoration|bg|divide|outline|ring|shadow|accent|caret|fill|stroke|border|border-t|border-b|border-l|border-r|border-x|border-y)-([a-z]+)-\d{3}\b/g;
  const decorations = [];

  const lines = model.getLineCount();

  for (let line = 1; line <= lines; line++) {
    const text = model.getLineContent(line);
    let match;

    while ((match = regex.exec(text))) {
      const cls = match[0];
      const color = extractColorValue(cls);
      if (!color) continue;
      const safeColor = color.replace("#", "");

      //? add icon color to style tag in head
      let styleTag = document.getElementById("dynamicColorIcons") as HTMLStyleElement | null;
      if (!styleTag) {
        styleTag = document.createElement("style");
        styleTag.id = 'dynamicColorIcons'
        document.head.appendChild(styleTag);
      }

      if (!styleTag.innerHTML.includes(`dynamicColorIcon-${safeColor}`)) {
        styleTag.innerHTML += `
          .dynamicColorIcon-${safeColor} {
            background-color: ${color};
          }
        `;
      }

      decorations.push({
        range: new monaco.Range(
          line,
          match.index + 1,
          line,
          match.index + cls.length + 1
        ),
        options: {
          before: {
            content: " ",
            inlineClassName: `inlineColorIcon dynamicColorIcon-${safeColor}`,
            inlineClassNameAffectsLetterSpacing: true, // ensures spacing works without a fake char
          },
        },
      });
      decorations.push({
        range: new monaco.Range(
          line,
          match.index + 1,
          line,
          match.index + cls.length + 1
        ),
        options: {
          before: {
            content: " ",
            inlineClassName: 'inlineColorIconGap',
          },
        },
      })
    }
  }

  return decorations;
}
