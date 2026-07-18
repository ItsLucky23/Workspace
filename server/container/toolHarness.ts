//? Shared throwaway-container harness (DESIGN_DOCS_PROGRAM Phase 0.1). ONE invocation helper for the
//? "write inputs to a temp dir → run an image over it → read an output file → clean up" pattern that
//? the document exporter (pandoc/chromium) and file parser share. Tool containers are deliberately more
//? constrained than ticket containers: no network, read-only root, bounded resources/output/time, and only
//? `/data` + `/tmp` writable. Never throws — every failure returns null and removes the temp directory.

import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { docker } from './runtime';
import type { DockerResult, DockerRunOptions } from './runtime';

export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
export const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TOOL_DOCKER_OUTPUT_MAX_BYTES = 1024 * 1024;
const TOOL_CLEANUP_TIMEOUT_MS = 10_000;

export interface ToolContainerSpec {
  //? Write the input file(s) the container reads, into `dir` (mounted as /data). Sync — runs before launch.
  buildInput: (dir: string) => void;
  //? The docker image + its args, e.g. [IMAGE, '/data/in.md', '-o', '/data/out.docx']. Paths are /data/*.
  imageAndArgs: string[];
  //? The produced regular file to read back, relative to the temp dir (e.g. 'out.pdf').
  outFile: string;
  //? Hard wall-clock limit. Defaults to two minutes, including an image pull.
  timeoutMs?: number;
  //? Refuse the output before reading it into memory when this many bytes are exceeded.
  maxOutputBytes?: number;
  //? Temp-dir name prefix (cosmetic; helps identify leaked dirs). Default 'ws-tool-'.
  tmpPrefix?: string;
}

export type ToolDockerRunner = (args: string[], options?: DockerRunOptions) => Promise<DockerResult>;

//? Docker on Windows accepts C:\… bind paths; normalize to forward slashes for the -v mount.
function dockerHostPath(p: string): string { return p.replaceAll('\\', '/'); }

//? Pure command builder: every parser/render invocation carries the complete hardening set. `/data` is the
//? sole persistent writable mount; `/tmp` is a bounded tmpfs needed by pandoc/chromium.
export function buildToolContainerArgs(spec: ToolContainerSpec, dir: string, name: string): string[] {
  const mount = `${dockerHostPath(dir)}:/data:rw`;
  return [
    'run', '--rm', '--name', name,
    '--network', 'none',
    '--read-only',
    '--user', '65534:65534',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '512',
    '--memory', '3g', '--memory-swap', '3g',
    '--cpus', '2',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=256m',
    '--env', 'HOME=/tmp',
    '-v', mount,
    ...spec.imageAndArgs,
  ];
}

function isSafeOutFile(outFile: string): boolean {
  return outFile.length > 0 && outFile === path.basename(outFile) && !outFile.includes('/') && !outFile.includes('\\');
}

//? Run ONE throwaway container over a temp dir mounted at /data and return bounded output bytes (or null).
//? The optional runner is a typed test seam; production always uses the shared Windows-safe `docker()`.
export async function runToolContainer(spec: ToolContainerSpec, runner: ToolDockerRunner = docker): Promise<Buffer | null> {
  if (!isSafeOutFile(spec.outFile)) return null;
  const [dirError, dir] = tryCatchSync(() => mkdtempSync(path.join(tmpdir(), spec.tmpPrefix ?? 'ws-tool-')));
  if (dirError || dir === null) return null;

  const name = `ws-tool-${randomUUID()}`;
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const maxOutputBytes = spec.maxOutputBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  const [error, bytes] = await tryCatch(async () => {
    spec.buildInput(dir);
    //? The fixed non-root container user needs traversal + write access, but no directory listing permission
    //? is granted to unrelated host users. Sticky prevents a second host user from deleting the tool's files.
    chmodSync(dir, 0o1733);
    const result = await runner(buildToolContainerArgs(spec, dir, name), { timeoutMs, maxOutputBytes: DEFAULT_TOOL_DOCKER_OUTPUT_MAX_BYTES });
    if (result.timedOut || result.outputLimitExceeded) {
      //? Killing the local Docker client does not guarantee the daemon stopped the named container.
      await runner(['rm', '-f', name], { timeoutMs: TOOL_CLEANUP_TIMEOUT_MS, maxOutputBytes: DEFAULT_TOOL_DOCKER_OUTPUT_MAX_BYTES });
    }
    if (result.code !== 0) throw new Error(`tool container exited ${String(result.code)}: ${result.err.slice(0, 300)}`);

    const outputPath = path.resolve(dir, spec.outFile);
    const outputRelative = path.relative(dir, outputPath);
    if (outputRelative.startsWith('..') || path.isAbsolute(outputRelative)) throw new Error('tool output escapes /data');
    const outputStat = lstatSync(outputPath);
    //? Refuse symlinks: following a container-created absolute symlink from the host could escape /data.
    if (outputStat.isSymbolicLink() || !outputStat.isFile()) throw new Error('tool output is not a regular file');
    if (outputStat.size > maxOutputBytes) throw new Error(`tool output exceeds ${String(maxOutputBytes)} bytes`);
    return readFileSync(outputPath);
  });
  tryCatchSync(() => { rmSync(dir, { recursive: true, force: true }); });
  return error ? null : bytes;
}

//? Convenience wrapper for text-producing tools (pdftotext, pandoc→markdown). Returns utf8 text or null.
export async function runToolContainerText(spec: ToolContainerSpec, runner: ToolDockerRunner = docker): Promise<string | null> {
  const bytes = await runToolContainer(spec, runner);
  return bytes === null ? null : bytes.toString('utf8');
}
