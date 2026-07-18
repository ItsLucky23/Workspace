//? Shared throwaway-container harness (DESIGN_DOCS_PROGRAM Phase 0.1). ONE invocation helper for the
//? "write inputs to a temp dir → run an image over it → read an output file → clean up" pattern that
//? the document exporter (pandoc/chromium), the PDF/docx parser, and future parse/render steps all share.
//? `--network none` by default (a render/parse never needs egress — inputs are mounted); pass
//? `network: true` for a step that must reach the internet (e.g. a screenshot of an external URL).
//? Never throws — returns null on any failure (container non-zero exit, missing output, docker down) so
//? every caller degrades gracefully. Reuses the ONE Windows-safe `docker()` spawn from ./runtime.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { docker } from './runtime';

export interface ToolContainerSpec {
  //? Write the input file(s) the container reads, into `dir` (mounted as /data). Sync — runs before launch.
  buildInput: (dir: string) => void;
  //? The docker image + its args, e.g. [IMAGE, '/data/in.md', '-o', '/data/out.docx']. Paths are /data/*.
  imageAndArgs: string[];
  //? The produced file to read back, relative to the temp dir (e.g. 'out.pdf').
  outFile: string;
  //? Allow egress (default false → `--network none`). Only true for steps that fetch external URLs.
  network?: boolean;
  //? Temp-dir name prefix (cosmetic; helps identify leaked dirs). Default 'ws-tool-'.
  tmpPrefix?: string;
}

//? Docker on Windows accepts C:\… bind paths; normalize to forward slashes for the -v mount.
function dockerHostPath(p: string): string { return p.replaceAll('\\', '/'); }

//? Run ONE throwaway container over a temp dir mounted at /data and return the produced bytes (or null).
export async function runToolContainer(spec: ToolContainerSpec): Promise<Buffer | null> {
  const dir = mkdtempSync(path.join(tmpdir(), spec.tmpPrefix ?? 'ws-tool-'));
  const [err, bytes] = await tryCatch(async () => {
    spec.buildInput(dir);
    const mount = `${dockerHostPath(dir)}:/data`;
    const netArgs = spec.network === true ? [] : ['--network', 'none'];
    const res = await docker(['run', '--rm', ...netArgs, '-v', mount, ...spec.imageAndArgs]);
    if (res.code !== 0) throw new Error(`tool container exited ${String(res.code)}: ${res.err.slice(0, 300)}`);
    return readFileSync(path.join(dir, spec.outFile));
  });
  tryCatchSync(() => { rmSync(dir, { recursive: true, force: true }); });
  return err ? null : bytes;
}

//? Convenience wrapper for text-producing tools (pdftotext, pandoc→markdown). Returns utf8 text or null.
export async function runToolContainerText(spec: ToolContainerSpec): Promise<string | null> {
  const bytes = await runToolContainer(spec);
  return bytes === null ? null : bytes.toString('utf8');
}
