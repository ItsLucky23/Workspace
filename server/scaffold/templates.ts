//? Greenfield scaffolding (ADR 0046, F1) — a small CURATED catalog of stack templates. "Create a new
//? project from a stack template" generates a fresh project (repo/service scaffold) instead of only
//? LINKing an existing repo (additions/04 covers the existing-repo path). A template carries the seed
//? config a fresh project needs: a base image, a dev command, and starter context-docs (registered as
//? `InfoSource`s so the coding agent + the pipeline see them). Pure data + lookups — the Conductor
//? consumes it when a `project-from-template` op runs. Curated set first (V1); a marketplace is later.

export interface StarterDoc { name: string; content: string }
export interface StackTemplate {
  key: string;
  label: string;
  description: string;
  baseImageRef?: string;      // a hint for the project's image (else the framework base)
  devCommand: string;         // the dev-server command for preview/deploy
  starterDocs: StarterDoc[];  // seeded as context-doc InfoSources (conventions the agent follows)
}

const TEMPLATES: readonly StackTemplate[] = [
  {
    key: 'node-api',
    label: 'Node.js API',
    description: 'A minimal Node.js + TypeScript HTTP API (Express-free), ready for the pipeline.',
    devCommand: 'npm run dev',
    starterDocs: [
      { name: 'CONVENTIONS.md', content: '# Node API conventions\n- TypeScript strict.\n- One route per file under `src/routes`.\n- Validate inputs at the boundary; never trust the client.\n- No secrets in code — read from env.' },
    ],
  },
  {
    key: 'react-vite',
    label: 'React + Vite',
    description: 'A React 19 + Vite + TailwindCSS single-page app, dev server on 0.0.0.0:5173.',
    devCommand: 'npm run dev -- --host 0.0.0.0 --port 5173',
    starterDocs: [
      { name: 'CONVENTIONS.md', content: '# React + Vite conventions\n- Function components + hooks only.\n- Colors from the theme tokens, never arbitrary hex.\n- All user-facing text via the i18n layer.\n- Co-locate a component with its styles + test.' },
    ],
  },
  {
    key: 'python-fastapi',
    label: 'Python FastAPI',
    description: 'A Python 3 + FastAPI service with a typed request/response layer.',
    devCommand: 'uvicorn app.main:app --host 0.0.0.0 --port 5173 --reload',
    starterDocs: [
      { name: 'CONVENTIONS.md', content: '# FastAPI conventions\n- Pydantic models for every request/response.\n- Async handlers; no blocking IO on the event loop.\n- Dependency-inject the DB session; never a module-global connection.' },
    ],
  },
];

//? The catalog for the picker (key/label/description only — the switcher-facing subset).
export function listTemplates(): { key: string; label: string; description: string }[] {
  return TEMPLATES.map((t) => ({ key: t.key, label: t.label, description: t.description }));
}

//? Resolve a full template by key (null when unknown).
export function getTemplate(key: string): StackTemplate | null {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}
