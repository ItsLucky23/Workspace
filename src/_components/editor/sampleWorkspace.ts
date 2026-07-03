//? A small, believable multi-language project so the Monaco editor demo works fully
//? offline — exercises the file explorer, multi-language highlighting, theme switching,
//? and (via CHANGES) the source-control diff view. This is demo/test data only.

import type { EditorFile } from './fileTree';

export const SAMPLE_FILES: EditorFile[] = [
  {
    path: 'README.md',
    content: `# Sample Project\n\nA tiny multi-language project used to demo the **LuckyStack code editor**.\n\n- \`src/\` — TypeScript + React frontend\n- \`server/\` — Go + Python backend bits\n- \`Dockerfile\` — container build\n\n> Switch themes from the top bar — the theme is shared with the real VS Code editor.\n`,
  },
  {
    path: 'src/app.tsx',
    content: `import { useState } from 'react';\nimport { greet } from './utils';\n\nexport function App() {\n  const [name, setName] = useState('world');\n  return (\n    <div className="app">\n      <h1>{greet(name)}</h1>\n      <input value={name} onChange={(e) => setName(e.target.value)} />\n    </div>\n  );\n}\n`,
  },
  {
    path: 'src/utils.ts',
    content: `export function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nexport const PI = 3.14159;\n\nexport interface User {\n  id: string;\n  name: string;\n  roles: string[];\n}\n`,
  },
  {
    path: 'src/styles.css',
    content: `:root {\n  --accent: #7aa2f7;\n}\n\n.app {\n  display: flex;\n  flex-direction: column;\n  gap: 0.5rem;\n  color: var(--accent);\n}\n`,
  },
  {
    path: 'server/main.go',
    content: `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n\nfunc handler(w http.ResponseWriter, r *http.Request) {\n\tfmt.Fprintf(w, "Hello from Go")\n}\n\nfunc main() {\n\thttp.HandleFunc("/", handler)\n\thttp.ListenAndServe(":8080", nil)\n}\n`,
  },
  {
    path: 'server/worker.py',
    content: `import asyncio\n\n\nasync def process(items: list[str]) -> int:\n    count = 0\n    for item in items:\n        await asyncio.sleep(0.01)\n        count += len(item)\n    return count\n\n\nif __name__ == "__main__":\n    print(asyncio.run(process(["a", "bb", "ccc"])))\n`,
  },
  {
    path: 'package.json',
    content: `{\n  "name": "sample-project",\n  "version": "1.0.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  },\n  "dependencies": {\n    "react": "^19.0.0"\n  }\n}\n`,
  },
  {
    path: 'Dockerfile',
    content: `FROM node:22-slim\nWORKDIR /app\nCOPY package.json .\nRUN npm install\nCOPY . .\nEXPOSE 5173\nCMD ["npm", "run", "dev"]\n`,
  },
  {
    path: 'config/settings.yaml',
    content: `server:\n  host: 0.0.0.0\n  port: 8080\nfeatures:\n  editor: true\n  themes:\n    - luckystack-dark\n    - midnight\n`,
  },
];

//? A few files with an uncommitted change, for the source-control diff demo.
export interface SampleChange {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  original: string;
  modified: string;
}

const orig = (path: string): string => SAMPLE_FILES.find((f) => f.path === path)?.content ?? '';

export const SAMPLE_CHANGES: SampleChange[] = [
  {
    path: 'src/utils.ts',
    status: 'modified',
    original: orig('src/utils.ts'),
    modified: `export function greet(name: string): string {\n  return \`Hello, \${name.trim()}!\`;\n}\n\nexport const PI = 3.14159;\nexport const TAU = PI * 2;\n\nexport interface User {\n  id: string;\n  name: string;\n  roles: string[];\n  createdAt: Date;\n}\n`,
  },
  {
    path: 'src/styles.css',
    status: 'modified',
    original: orig('src/styles.css'),
    modified: `:root {\n  --accent: #9ece6a;\n}\n\n.app {\n  display: flex;\n  flex-direction: column;\n  gap: 0.75rem;\n  color: var(--accent);\n  padding: 1rem;\n}\n`,
  },
  {
    path: 'CHANGELOG.md',
    status: 'added',
    original: '',
    modified: `# Changelog\n\n## Unreleased\n- Add TAU constant\n- Trim names in greet()\n`,
  },
];
