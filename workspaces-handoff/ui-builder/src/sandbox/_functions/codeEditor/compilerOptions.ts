import reactIndex from "../../../types/react/index.d.ts?raw";
import reactGlobal from "../../../types/react/global.d.ts?raw";
import reactDom from "../../../types/react-dom.d.ts?raw";
import reactJsxRuntime from "../../../types/react-jsx-runtime.d.ts?raw";
import { typescript } from "monaco-editor";
// import reactHooksGlobals from "../../../types/react-hooks.d.ts?raw";

export default function setCompilerOptions(monaco: typeof import("monaco-editor")) {

  //? monaco.languages.typescript is deprecated, but using monaco.typescript or just the typescript export from monaco which is recommended it crashes the editor
  const ts = monaco.languages.typescript as any;
  // const ts = monaco.typescript;
  // const ts = typescript;

  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    jsxFactory: "React.createElement",
    jsxFragmentFactory: "React.Fragment",
    allowJs: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    isolatedModules: true,
  });

  // const model = monaco.editor.getModels()[0];
  // if (model) {
  //   monaco.editor.setModelLanguage(model, "typescript");
  // }

  // Inject all React-related types
  ts.typescriptDefaults.addExtraLib(
    reactIndex,
    "file:///node_modules/@types/react/index.d.ts"
  );
  ts.typescriptDefaults.addExtraLib(
    reactGlobal,
    "file:///node_modules/@types/react/global.d.ts"
  );
  ts.typescriptDefaults.addExtraLib(
    reactDom,
    "file:///node_modules/@types/react-dom/index.d.ts"
  );
  ts.typescriptDefaults.addExtraLib(
    reactJsxRuntime,
    "file:///node_modules/@types/react/jsx-runtime.d.ts"
  );
  // ts.typescriptDefaults.addExtraLib(
  //   reactHooksGlobals,
  //   "file:///react-hooks-globals.d.ts"
  // );


  const userComponents = [
    { name: "Dropdown", code: "export function Dropdown() { return <div>...</div> }" },
    { name: "MyButton", code: "export function MyButton() { return <button>Click</button> }" }
  ];

  const componentIndex = `
    declare module "components" {
      import React from "react";
      ${userComponents.map(c => `export { ${c.name} } from "components/${c.name}";`).join("\n")}
    }
  `;

  ts.typescriptDefaults.addExtraLib(
    componentIndex,
    "file:///components/index.d.ts"
  );

  userComponents.forEach((c) => {
    ts.typescriptDefaults.addExtraLib(
      `
        declare module "components/${c.name}" {
          import React from "react";
          export const ${c.name}: React.FC<any>;
        }
      `,
      `file:///components/${c.name}.d.ts`
    );
  });

  ts.typescriptDefaults.addExtraLib(
    `
      import * as components from "components";
      declare global {
        const { ${userComponents.map(c => c.name).join(", ")} } = components;
      }
    `,
    "file:///globalComponents.d.ts"
  );




  // this line in the code editor
  // import { MyButton } from "components/ComponentTest";

  // ts.typescriptDefaults.addExtraLib(
  //   `
  //   declare module "components/ComponentTest" {
  //     import React from "react";
  //     export function MyButton(props: { label: string }) {
  //       return <button>{props.label}</button>;
  //     };
  //   }
  //   `,
  //   `file:///components/ComponentTest.d.ts`
  // );
}