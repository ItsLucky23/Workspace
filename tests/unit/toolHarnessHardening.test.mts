//? A05 tool-container hardening — pure/fake-runner coverage for exact Docker controls, bounded output,
//? timeout cleanup, writable /data, and temp-directory cleanup. No Docker daemon/server required.

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildToolContainerArgs,
  runToolContainer,
} from '../../server/container/toolHarness.ts';
import type { ToolContainerSpec, ToolDockerRunner } from '../../server/container/toolHarness.ts';
import type { DockerResult } from '../../server/container/runtime.ts';
import { assert, eq, report } from '../_helpers.mts';

const spec: ToolContainerSpec = {
  buildInput: (dir) => { writeFileSync(path.join(dir, 'in.txt'), 'input'); },
  imageAndArgs: ['fixture/tool:1', '/data/in.txt', '-o', '/data/out.txt'],
  outFile: 'out.txt',
  timeoutMs: 1234,
  maxOutputBytes: 8,
  tmpPrefix: 'ws-tool-test-',
};

const args = buildToolContainerArgs(spec, 'C:\\temp\\tool', 'ws-tool-fixture');
const expectedPrefix = [
  'run', '--rm', '--name', 'ws-tool-fixture',
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
  '-v', 'C:/temp/tool:/data:rw',
];
eq(args.slice(0, expectedPrefix.length).join('|'), expectedPrefix.join('|'), 'tool command carries the exact hardening args');
eq(args.slice(expectedPrefix.length).join('|'), spec.imageAndArgs.join('|'), 'image + tool args follow Docker controls unchanged');
assert(!args.includes('--network=host') && !args.includes('--privileged'), 'tool command has no host network or privilege escape');

function dockerResult(overrides: Partial<DockerResult> = {}): DockerResult {
  return {
    code: 0,
    out: '',
    err: '',
    timedOut: false,
    outputLimitExceeded: false,
    ...overrides,
  };
}

function mountedHostDir(runArgs: string[]): string {
  const mountIndex = runArgs.indexOf('-v');
  const mount = runArgs[mountIndex + 1] ?? '';
  const suffix = ':/data:rw';
  if (!mount.endsWith(suffix)) throw new Error('missing writable /data fixture mount');
  return mount.slice(0, -suffix.length);
}

let runArgsSeen: string[] = [];
let runOptionsTimeout = 0;
let runOptionsOutputCap = 0;
let tempDirSeen = '';
const successRunner: ToolDockerRunner = async (runArgs, options) => {
  runArgsSeen = runArgs;
  runOptionsTimeout = options?.timeoutMs ?? 0;
  runOptionsOutputCap = options?.maxOutputBytes ?? 0;
  tempDirSeen = mountedHostDir(runArgs);
  writeFileSync(path.join(tempDirSeen, 'out.txt'), 'bounded');
  return dockerResult();
};
const output = await runToolContainer(spec, successRunner);
eq(output?.toString('utf8'), 'bounded', 'bounded regular output is returned');
eq(runOptionsTimeout, 1234, 'spec timeout reaches the Docker runner');
assert(runOptionsOutputCap > 0, 'Docker stdout/stderr capture is capped for tool containers');
assert(runArgsSeen.includes('--read-only') && runArgsSeen.includes('--network'), 'runtime invocation uses the hardened command builder');
assert(tempDirSeen.length > 0 && !existsSync(tempDirSeen), 'temp directory is removed after success');

let oversizedTemp = '';
const oversizedRunner: ToolDockerRunner = async (runArgs) => {
  oversizedTemp = mountedHostDir(runArgs);
  writeFileSync(path.join(oversizedTemp, 'out.txt'), '123456789');
  return dockerResult();
};
const oversizedOutput = await runToolContainer(spec, oversizedRunner);
assert(oversizedOutput === null, 'output over maxOutputBytes is refused before read');
assert(!existsSync(oversizedTemp), 'temp directory is removed after output-cap rejection');

const timeoutCalls: string[][] = [];
let timeoutTemp = '';
const timeoutRunner: ToolDockerRunner = async (runArgs) => {
  timeoutCalls.push(runArgs);
  if (runArgs[0] === 'run') timeoutTemp = mountedHostDir(runArgs);
  return runArgs[0] === 'run'
    ? dockerResult({ code: -1, err: 'timeout', timedOut: true })
    : dockerResult();
};
const timedOut = await runToolContainer(spec, timeoutRunner);
assert(timedOut === null, 'timed-out tool returns null');
assert(timeoutCalls.some((call) => call[0] === 'rm' && call[1] === '-f' && call[2]?.startsWith('ws-tool-')), 'timeout force-removes the named daemon container');
assert(timeoutTemp.length > 0 && !existsSync(timeoutTemp), 'temp directory is removed after timeout');

const overflowCalls: string[][] = [];
const overflowRunner: ToolDockerRunner = async (runArgs) => {
  overflowCalls.push(runArgs);
  return runArgs[0] === 'run'
    ? dockerResult({ code: -1, err: 'output limit', outputLimitExceeded: true })
    : dockerResult();
};
const overflowed = await runToolContainer(spec, overflowRunner);
assert(overflowed === null, 'tool with capped Docker output returns null');
assert(overflowCalls.some((call) => call[0] === 'rm' && call[1] === '-f' && call[2]?.startsWith('ws-tool-')), 'output-cap termination force-removes the named daemon container');

let invalidRunnerCalled = false;
const unsafeOutput = await runToolContainer({ ...spec, outFile: '../out.txt' }, async () => {
  invalidRunnerCalled = true;
  return dockerResult();
});
assert(unsafeOutput === null && !invalidRunnerCalled, 'only a basename output file is accepted before launching a container');

report('toolHarnessHardening');
