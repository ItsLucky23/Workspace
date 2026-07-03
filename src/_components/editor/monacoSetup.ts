//? Configure @monaco-editor/react to use the LOCALLY-BUNDLED monaco-editor (never the
//? default jsDelivr CDN) and wire its web-workers through Vite's `?worker` imports. This
//? keeps the editor self-hosted + CSP-safe + offline-capable (Rule: no external hosts).
//?
//? Import this module once before rendering any Monaco surface (MonacoEditor does so).
//?
//? eslint-disable-next-line rules for the `?worker` imports: Vite virtual modules that
//? eslint's import resolver can't see a default export on (they DO export a Worker ctor).

/* eslint-disable import-x/default -- Vite `?worker` virtual modules resolve at build time */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
/* eslint-enable import-x/default */

//? Monaco asks for a worker per language "label"; hand back the right bundled worker.
type WorkerFactory = new () => Worker;
const workers: Record<string, WorkerFactory> = {
  json: jsonWorker,
  css: cssWorker, scss: cssWorker, less: cssWorker,
  html: htmlWorker, handlebars: htmlWorker, razor: htmlWorker,
  typescript: tsWorker, javascript: tsWorker,
};

let configured = false;
export function ensureMonacoConfigured(): void {
  if (configured) return;
  configured = true;
  //? MonacoEnvironment is read by monaco at worker-spawn time.
  const g = globalThis as typeof globalThis & { MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker } };
  g.MonacoEnvironment = {
    getWorker(_id: string, label: string): Worker {
      const Factory = workers[label] ?? editorWorker;
      return new Factory();
    },
  };
  //? Point @monaco-editor/react at the bundled instance (skips the CDN loader).
  loader.config({ monaco });
}
