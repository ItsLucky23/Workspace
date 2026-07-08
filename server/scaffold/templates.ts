//? Greenfield scaffolding (ADR 0046, F1) — a small CURATED catalog of stack templates. "Create a new
//? project from a stack template" generates a fresh project (repo/service scaffold) instead of only
//? LINKing an existing repo (additions/04 covers the existing-repo path). A template carries the seed
//? config a fresh project needs: a base image, a dev command, and starter context-docs (registered as
//? `InfoSource`s so the coding agent + the pipeline see them). Pure data + lookups — the Conductor
//? consumes it when a `project-from-template` op runs. Curated set first (V1); a marketplace is later.

import { baseImageFor, type BaseStack } from '../container/baseImages';

export interface StarterDoc { name: string; content: string }
//? A seed file committed to the greenfield repo's first `main` commit (G1) — a minimal, runnable
//? skeleton the impl-stage agent then fleshes out. `path` is repo-relative (forward slashes).
export interface StarterFile { path: string; content: string }
export interface StackTemplate {
  key: string;
  label: string;
  description: string;
  stack: BaseStack;           // S2 — the stack base image the project runs on (any-stack, S1)
  baseImageRef?: string;      // a hint for the project's image (else the framework base)
  devCommand: string;         // the dev-server command for preview/deploy
  starterDocs: StarterDoc[];  // seeded as context-doc InfoSources (conventions the agent follows)
  files: StarterFile[];       // G1 — the seed file-tree committed to the fresh repo's first `main` commit
}

//? A README + .gitignore every seed shares (kept out of each template for brevity).
const commonFiles = (label: string, run: string): StarterFile[] => [
  { path: 'README.md', content: `# ${label}\n\nScaffolded by Workspaces (greenfield). Run:\n\n\`\`\`\n${run}\n\`\`\`\n\nThe implementation stage will flesh this out.` },
  { path: '.gitignore', content: 'node_modules/\ndist/\n.env\n__pycache__/\n.venv/\ntarget/\nbin/\n' },
];

//? S2 — the `.workspaces/Dockerfile` (the project's L2 image, FROM its stack base per S1) + `.workspaces/ci.yml`
//? (a minimal install→build gate the built-in CI runs), so a greenfield project is BUILDABLE + CI-gated from its
//? first commit — not just a file skeleton. `run` is the container CMD (dev server).
function workspacesFiles(stack: BaseStack, cmds: { install: string; build: string; run: string }): StarterFile[] {
  return [
    { path: '.workspaces/Dockerfile', content: `# syntax=docker/dockerfile:1\nFROM ${baseImageFor(stack)}\nWORKDIR /work\nCOPY . .\nRUN ${cmds.install}\nCMD ${cmds.run}\n` },
    { path: '.workspaces/ci.yml', content: `build:\n  script:\n    - ${cmds.install}\n    - ${cmds.build}\n` },
  ];
}

const TEMPLATES: readonly StackTemplate[] = [
  {
    key: 'node-api',
    label: 'Node.js API',
    description: 'A minimal Node.js + TypeScript HTTP API (Express-free), ready for the pipeline.',
    stack: 'node',
    devCommand: 'npm run dev',
    starterDocs: [
      { name: 'CONVENTIONS.md', content: '# Node API conventions\n- TypeScript strict.\n- One route per file under `src/routes`.\n- Validate inputs at the boundary; never trust the client.\n- No secrets in code — read from env.' },
    ],
    files: [
      { path: 'package.json', content: '{\n  "name": "node-api",\n  "version": "0.1.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "node src/index.js",\n    "start": "node src/index.js"\n  }\n}\n' },
      { path: 'src/index.js', content: "import { createServer } from 'node:http';\n\nconst port = Number(process.env.PORT ?? 5173);\ncreateServer((_req, res) => {\n  res.writeHead(200, { 'content-type': 'application/json' });\n  res.end(JSON.stringify({ ok: true, service: 'node-api' }));\n}).listen(port, '0.0.0.0', () => { console.log(`node-api on :${port}`); });\n" },
      ...commonFiles('Node.js API', 'npm run dev'),
      ...workspacesFiles('node', { install: 'npm install', build: 'npm run build --if-present', run: 'npm run dev' }),
    ],
  },
  {
    key: 'react-vite',
    label: 'React + Vite',
    description: 'A React 19 + Vite + TailwindCSS single-page app, dev server on 0.0.0.0:5173.',
    stack: 'node',
    devCommand: 'npm run dev -- --host 0.0.0.0 --port 5173',
    starterDocs: [
      { name: 'CONVENTIONS.md', content: '# React + Vite conventions\n- Function components + hooks only.\n- Colors from the theme tokens, never arbitrary hex.\n- All user-facing text via the i18n layer.\n- Co-locate a component with its styles + test.' },
    ],
    files: [
      { path: 'package.json', content: '{\n  "name": "react-vite-app",\n  "version": "0.1.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "preview": "vite preview"\n  },\n  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },\n  "devDependencies": { "vite": "^6.0.0", "@vitejs/plugin-react": "^4.3.0" }\n}\n' },
      { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8" /><title>App</title></head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n' },
      { path: 'src/main.jsx', content: "import { createRoot } from 'react-dom/client';\n\nfunction App() {\n  return <h1>Hello from Workspaces</h1>;\n}\n\ncreateRoot(document.getElementById('root')).render(<App />);\n" },
      { path: 'vite.config.js', content: "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()], server: { host: '0.0.0.0', port: 5173 } });\n" },
      ...commonFiles('React + Vite', 'npm install && npm run dev'),
      ...workspacesFiles('node', { install: 'npm install', build: 'npm run build', run: 'npm run dev -- --host 0.0.0.0 --port 5173' }),
    ],
  },
  {
    key: 'python-fastapi',
    label: 'Python FastAPI',
    description: 'A Python 3 + FastAPI service with a typed request/response layer.',
    stack: 'python',
    devCommand: 'uvicorn app.main:app --host 0.0.0.0 --port 5173 --reload',
    starterDocs: [
      { name: 'CONVENTIONS.md', content: '# FastAPI conventions\n- Pydantic models for every request/response.\n- Async handlers; no blocking IO on the event loop.\n- Dependency-inject the DB session; never a module-global connection.' },
    ],
    files: [
      { path: 'requirements.txt', content: 'fastapi>=0.110\nuvicorn[standard]>=0.29\n' },
      { path: 'app/__init__.py', content: '' },
      { path: 'app/main.py', content: 'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/")\nasync def root() -> dict[str, bool | str]:\n    return {"ok": True, "service": "fastapi"}\n' },
      ...commonFiles('Python FastAPI', 'pip install -r requirements.txt && uvicorn app.main:app --reload'),
      ...workspacesFiles('python', { install: 'pip install --break-system-packages -r requirements.txt', build: 'python -m compileall app', run: 'uvicorn app.main:app --host 0.0.0.0 --port 5173' }),
    ],
  },
  {
    key: 'go-api',
    label: 'Go HTTP API',
    description: 'A minimal Go net/http service — exercises the Go stack base (S1).',
    stack: 'go',
    devCommand: 'go run .',
    starterDocs: [
      { name: 'CONVENTIONS.md', content: '# Go conventions\n- Standard library first; add deps deliberately.\n- Handlers return early on error; wrap with context.\n- `go vet ./...` + `go test ./...` must pass before done.' },
    ],
    files: [
      { path: 'go.mod', content: 'module app\n\ngo 1.23\n' },
      { path: 'main.go', content: 'package main\n\nimport (\n\t"encoding/json"\n\t"net/http"\n\t"os"\n)\n\nfunc main() {\n\tport := os.Getenv("PORT")\n\tif port == "" {\n\t\tport = "5173"\n\t}\n\thttp.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {\n\t\tw.Header().Set("content-type", "application/json")\n\t\t_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "go-api"})\n\t})\n\thttp.ListenAndServe("0.0.0.0:"+port, nil)\n}\n' },
      ...commonFiles('Go HTTP API', 'go run .'),
      ...workspacesFiles('go', { install: 'go mod download', build: 'go build ./...', run: 'go run .' }),
    ],
  },
];

//? The catalog for the picker (key/label/description/stack — the switcher-facing subset).
export function listTemplates(): { key: string; label: string; description: string; stack: BaseStack }[] {
  return TEMPLATES.map((t) => ({ key: t.key, label: t.label, description: t.description, stack: t.stack }));
}

//? Resolve a full template by key (null when unknown).
export function getTemplate(key: string): StackTemplate | null {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}
