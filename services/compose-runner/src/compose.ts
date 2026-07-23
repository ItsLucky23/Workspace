import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentConfig } from './config.js';
import { asRecord, parseJson, PROJECT_PATTERN, runCommand, WORKSPACE_ID_PATTERN } from './runtime.js';
import type { AgentComposeResponse, CommandResult, ComposeDownRequest, ComposeUpRequest } from './types.js';

const COMPOSE_FILE = 'compose.yml';
const GATEWAY_ENV_PREFIX = 'io.luckystack.gateway.env.';
const GATEWAY_PORTS_LABEL = 'io.luckystack.gateway.ports';
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export type CommandRunner = (
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; stdin?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

const failure = (error: string): AgentComposeResponse => ({ ok: false, services: [], env: {}, gatewayPorts: [], error });

function projectDirectory(config: AgentConfig, project: string): string {
  if (!PROJECT_PATTERN.test(project)) throw new Error('invalid project');
  const directory = path.resolve(config.dataDir, 'projects', project);
  const root = path.resolve(config.dataDir, 'projects');
  if (!directory.startsWith(`${root}${path.sep}`)) throw new Error('project path escaped root');
  return directory;
}

function readLabels(service: unknown): Record<string, string> {
  const serviceRecord = asRecord(service);
  const labels = asRecord(serviceRecord?.labels);
  if (!labels) return {};
  return Object.fromEntries(Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function parseGatewayMetadata(configJson: string, gatewayHost: string): { services: string[]; env: Record<string, string>; gatewayPorts: number[] } | null {
  const parsed = parseJson(configJson);
  if (!parsed.ok) return null;
  const root = asRecord(parsed.value);
  const servicesRecord = asRecord(root?.services);
  if (!servicesRecord) return null;
  const services = Object.keys(servicesRecord).filter((name) => SERVICE_NAME.test(name)).slice(0, 256);
  const env: Record<string, string> = {};
  const ports = new Set<number>();
  for (const service of Object.values(servicesRecord)) {
    const labels = readLabels(service);
    for (const [label, value] of Object.entries(labels)) {
      if (label.startsWith(GATEWAY_ENV_PREFIX)) {
        const key = label.slice(GATEWAY_ENV_PREFIX.length);
        if (ENV_KEY.test(key) && value.length <= 8192) env[key] = value.replaceAll('{gatewayHost}', gatewayHost);
      }
      if (label === GATEWAY_PORTS_LABEL) {
        for (const item of value.split(',')) {
          const port = Number(item.trim());
          if (Number.isInteger(port) && port >= 1 && port <= 65_535) ports.add(port);
        }
      }
    }
  }
  return { services, env, gatewayPorts: [...ports].toSorted((left, right) => left - right).slice(0, 32) };
}

const dockerComposeArgs = (project: string, file: string, action: string[]): string[] => [
  'compose', '-p', project, '-f', file, ...action,
];

//? Compose performs host-environment interpolation before it launches containers. Never let user YAML expand
//? the agent bearer token or unrelated systemd/controller secrets; pass only Docker/runtime plumbing.
const dockerEnvironment = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const allowed = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'XDG_RUNTIME_DIR', 'TMPDIR', 'TEMP', 'TMP'];
  const result: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
};

export class ComposeExecutor {
  constructor(
    private readonly config: AgentConfig,
    private readonly commandRunner: CommandRunner = runCommand,
  ) {}

  async health(): Promise<boolean> {
    const result = await this.commandRunner(this.config.dockerBin, ['compose', 'version'], { timeoutMs: 10_000, env: dockerEnvironment() });
    return result.code === 0;
  }

  async up(input: ComposeUpRequest): Promise<AgentComposeResponse> {
    if (input.workspaceId.toLowerCase() !== this.config.workspaceId || !WORKSPACE_ID_PATTERN.test(input.workspaceId)) return failure('workspace.mismatch');
    if (!PROJECT_PATTERN.test(input.project)) return failure('project.invalid');
    const directory = projectDirectory(this.config, input.project);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, COMPOSE_FILE);
    const temporary = path.join(directory, `${COMPOSE_FILE}.next`);
    await writeFile(temporary, input.compose, { encoding: 'utf8', mode: 0o600 });

    const rendered = await this.commandRunner(this.config.dockerBin, dockerComposeArgs(input.project, temporary, ['config', '--format', 'json']), {
      cwd: directory,
      timeoutMs: Math.min(this.config.operationTimeoutMs, 60_000),
      env: dockerEnvironment(),
    });
    if (rendered.code !== 0) {
      await rm(temporary, { force: true });
      const previousExists = await readFile(file, 'utf8').then(() => true).catch(() => false);
      if (!previousExists) await rm(directory, { recursive: true, force: true });
      return failure(rendered.timedOut ? 'compose.validationTimeout' : 'compose.invalid');
    }
    const metadata = parseGatewayMetadata(rendered.stdout, this.config.gatewayHost);
    if (!metadata) {
      await rm(temporary, { force: true });
      const previousExists = await readFile(file, 'utf8').then(() => true).catch(() => false);
      if (!previousExists) await rm(directory, { recursive: true, force: true });
      return failure('compose.invalidConfigOutput');
    }
    await rename(temporary, file);
    const started = await this.commandRunner(this.config.dockerBin, dockerComposeArgs(input.project, file, ['up', '-d', '--remove-orphans']), {
      cwd: directory,
      timeoutMs: this.config.operationTimeoutMs,
      env: dockerEnvironment(),
    });
    if (started.code !== 0) return failure(started.timedOut ? 'compose.upTimeout' : 'compose.upFailed');
    return { ok: true, ...metadata };
  }

  async down(input: ComposeDownRequest): Promise<AgentComposeResponse> {
    if (input.workspaceId.toLowerCase() !== this.config.workspaceId || !WORKSPACE_ID_PATTERN.test(input.workspaceId)) return failure('workspace.mismatch');
    if (!PROJECT_PATTERN.test(input.project)) return failure('project.invalid');
    const directory = projectDirectory(this.config, input.project);
    const file = path.join(directory, COMPOSE_FILE);
    const existing = await readFile(file, 'utf8').then(() => true).catch(() => false);
    if (!existing) {
      await rm(directory, { recursive: true, force: true });
      return { ok: true, services: [], env: {}, gatewayPorts: [] };
    }
    const stopped = await this.commandRunner(this.config.dockerBin, dockerComposeArgs(input.project, file, ['down', '-v', '--remove-orphans']), {
      cwd: directory,
      timeoutMs: this.config.operationTimeoutMs,
      env: dockerEnvironment(),
    });
    if (stopped.code !== 0) return failure(stopped.timedOut ? 'compose.downTimeout' : 'compose.downFailed');
    await rm(directory, { recursive: true, force: true });
    return { ok: true, services: [], env: {}, gatewayPorts: [] };
  }

  async activeProjects(): Promise<string[]> {
    const root = path.resolve(this.config.dataDir, 'projects');
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory() && PROJECT_PATTERN.test(entry.name)).map((entry) => entry.name).toSorted();
  }
}
