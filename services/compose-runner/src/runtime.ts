import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';

import type { CommandResult, Result } from './types.js';

export const MAX_COMPOSE_BYTES = 1024 * 1024;
export const MAX_PUBLIC_RESPONSE_BYTES = 64 * 1024;
export const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
export const WORKSPACE_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
export const PROJECT_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

export function parseJson(value: string): Result<unknown> {
  // eslint-disable-next-line luckystack/no-raw-try-catch -- standalone runner deliberately has zero LuckyStack runtime dependencies
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

export function requiredString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim() ?? '';
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function optionalInt(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer between ${String(min)} and ${String(max)}`);
  return value;
}

export function optionalBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  throw new Error(`${key} must be 1/0 or true/false`);
}

export function splitCsv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

const appendBounded = (current: Buffer[], currentBytes: number, chunk: Buffer): { chunks: Buffer[]; bytes: number } => {
  if (currentBytes >= MAX_COMMAND_OUTPUT_BYTES) return { chunks: current, bytes: currentBytes };
  const remaining = MAX_COMMAND_OUTPUT_BYTES - currentBytes;
  const accepted = chunk.subarray(0, remaining);
  return { chunks: [...current, accepted], bytes: currentBytes + accepted.length };
};

export async function runCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; stdin?: string; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdoutChunks: Buffer[] = [];
    let stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, options.timeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      const next = appendBounded(stdoutChunks, stdoutBytes, chunk);
      stdoutChunks = next.chunks;
      stdoutBytes = next.bytes;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const next = appendBounded(stderrChunks, stderrBytes, chunk);
      stderrChunks = next.chunks;
      stderrBytes = next.bytes;
    });
    child.on('error', (error) => {
      stderrChunks = [Buffer.from(error.message, 'utf8')];
      stderrBytes = stderrChunks[0]?.length ?? 0;
      finish(127);
    });
    child.on('close', (code) => { finish(code ?? 1); });

    if (options.stdin === undefined) {child.stdin.end();}
    else {child.stdin.end(options.stdin);}
  });
}

const deferred = (): { promise: Promise<void>; release: () => void } => {
  let resolver: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => { resolver = resolve; });
  return {
    promise,
    release: () => {
      if (resolver) resolver();
    },
  };
};

export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = deferred();
    const tail = previous.then(() => current.promise);
    this.tails.set(key, tail);
    await previous;
    return operation().finally(() => {
      current.release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
  }
}
