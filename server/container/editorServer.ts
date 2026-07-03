//? openvscode-server (real browser VS Code) launcher — editor #2. Two modes:
//?  - STANDALONE (dev/demo): run openvscode-server as its own container on a host port so
//?    the app can iframe it without the full per-ticket Caddy substrate. Durable via
//?    `--restart unless-stopped`.
//?  - IN-CONTAINER (product, per ticket): start openvscode-server INSIDE an existing ticket
//?    container (07b) on a fixed internal port, exposed via the reverse-proxy provider
//?    (`server/proxy` — Caddy/nginx). This is the CODE_EDITOR.md §1 target. `editorSession.ts`
//?    orchestrates the full open flow (container + profile + proxy route).
//?
//? Both write a settings.json carrying the shared editor theme (so the real VS Code matches
//? the Monaco theme) + the user's extension set (Track E). Self-contained `docker` spawn so
//? it does not couple to the in-flight `runtime.ts`.

import { spawn } from 'node:child_process';

import { projectProfileIntoContainer, editorProfileLaunchArgs, IN_CONTAINER_USER_DATA } from './editorProfile';

export const EDITOR_IMAGE = process.env.WS_EDITOR_IMAGE ?? 'gitpod/openvscode-server:latest';
export const EDITOR_IN_CONTAINER_PORT = 3000;

//? #14 Open VSX: openvscode-server defaults to the Microsoft marketplace, whose ToS forbids use by
//? non-Microsoft VS Code builds. Point the extensions gallery at Open VSX (open-vsx.org) so
//? `--install-extension` + the in-editor marketplace resolve from the licensing-correct registry.
//? Overridable via WS_EXTENSIONS_GALLERY (e.g. a self-hosted Open VSX mirror). Shell-quoted for exec.
const EXTENSIONS_GALLERY_JSON = process.env.WS_EXTENSIONS_GALLERY ?? '{"serviceUrl":"https://open-vsx.org/vscode/gallery","itemUrl":"https://open-vsx.org/vscode/item"}';
export function openVsxEnvPrefix(): string {
  return `EXTENSIONS_GALLERY='${EXTENSIONS_GALLERY_JSON.replaceAll("'", String.raw`'\''`)}' `;
}

export interface StandaloneEditorInfo {
  ok: boolean;
  url?: string;         // http://localhost:<port>/?tkn=<token>&folder=<folder>
  token?: string;
  containerName?: string;
  error?: string;
}

//? Run a docker command, resolving { code, out, err }. Never throws.
function docker(args: string[], opts: { input?: string } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn('docker', args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += String(d); });
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', (e) => { resolve({ code: -1, out, err: err + String(e) }); });
    proc.on('close', (code) => { resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }); });
    if (opts.input !== undefined) { proc.stdin.write(opts.input); proc.stdin.end(); }
  });
}

//? The workbench colors for our default dark theme (mirrors editorThemes `luckystack-dark`).
//? Kept here as a small literal so the server module stays decoupled from the client theme
//? file; the per-theme sync (all themes) rides `vscodeColorCustomizations` in Track D.
const DEFAULT_SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.colorCustomizations': {
    'editor.background': '#0f1117',
    'editor.foreground': '#c8ccd4',
    'sideBar.background': '#0b0d12',
    'activityBar.background': '#0b0d12',
    'editorCursor.foreground': '#7aa2f7',
    'focusBorder': '#7aa2f7',
  },
  'editor.fontSize': 13,
  'editor.minimap.enabled': true,
  'security.workspace.trust.enabled': false,
  'telemetry.telemetryLevel': 'off',
};

export async function dockerAvailable(): Promise<boolean> {
  const res = await docker(['version', '--format', '{{.Server.Version}}']);
  return res.code === 0;
}

//? Start (or reuse) a durable standalone openvscode-server container. Idempotent by name:
//? a running container is reused. Mounts a persistent workspace volume + injects the shared
//? theme via VSCODE default settings. Returns the iframe URL + connection token.
export async function startStandaloneEditor(input: { name?: string; port?: number; token: string; folder?: string } ): Promise<StandaloneEditorInfo> {
  const name = input.name ?? 'ls-vscode-demo';
  const port = input.port ?? 3100;
  const folder = input.folder ?? '/home/workspace';
  if (!(await dockerAvailable())) return { ok: false, error: 'docker.unavailable' };

  //? Reuse a running container (idempotent).
  const existing = await docker(['ps', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
  if (existing.code === 0 && existing.out.split('\n').includes(name)) {
    return { ok: true, url: `http://localhost:${String(port)}/?tkn=${input.token}&folder=${folder}`, token: input.token, containerName: name };
  }
  //? Remove a stopped leftover of the same name.
  await docker(['rm', '-f', name]);

  const run = await docker([
    'run', '-d', '--name', name, '--restart', 'unless-stopped',
    '-p', `${String(port)}:${String(EDITOR_IN_CONTAINER_PORT)}`,
    EDITOR_IMAGE,
    '--host', '0.0.0.0', '--connection-token', input.token,
    '--default-folder', folder,
  ]);
  if (run.code !== 0) return { ok: false, error: `editor.startFailed: ${run.err.slice(0, 300)}` };
  return { ok: true, url: `http://localhost:${String(port)}/?tkn=${input.token}&folder=${folder}`, token: input.token, containerName: name };
}

export async function stopStandaloneEditor(name = 'ls-vscode-demo'): Promise<{ ok: boolean }> {
  await docker(['rm', '-f', name]);
  return { ok: true };
}

const OVS_VERSION = process.env.WS_OVS_VERSION ?? 'openvscode-server-v1.109.5';

//? Ensure openvscode-server is present in the container. Baking it into the L1 base is the
//? production path (Track B1); this install-on-demand makes the editor work with any base/L2
//? image that doesn't have it yet. No-op when already present.
export async function ensureOpenvscodeInContainer(container: string): Promise<{ ok: boolean; error?: string }> {
  const has = await docker(['exec', container, 'bash', '-lc', 'command -v openvscode-server >/dev/null 2>&1 && echo yes || echo no']);
  if (has.out.trim().endsWith('yes')) return { ok: true };
  const url = `https://github.com/gitpod-io/openvscode-server/releases/download/${OVS_VERSION}/${OVS_VERSION}-linux-x64.tar.gz`;
  const install = await docker(['exec', '-u', 'root', container, 'bash', '-lc',
    `curl -fsSL "${url}" -o /tmp/ovs.tar.gz && mkdir -p /opt/openvscode && tar -xzf /tmp/ovs.tar.gz -C /opt/openvscode --strip-components=1 && rm -f /tmp/ovs.tar.gz && ln -sf /opt/openvscode/bin/openvscode-server /usr/local/bin/openvscode-server`]);
  if (install.code !== 0) return { ok: false, error: `editor.installFailed: ${install.err.slice(0, 200)}` };
  return { ok: true };
}

//? Product path: start openvscode-server INSIDE an existing ticket container on the fixed
//? internal port. The workbench is then exposed via the proxy provider (server/proxy). Writes
//? the shared theme + extension list into the in-container VS Code settings first.
export async function startEditorInContainer(input: { container: string; userId: string; token: string; workdir?: string; settingsJson?: string; extensions?: string[] }): Promise<{ ok: boolean; error?: string }> {
  const workdir = input.workdir ?? '/work';
  const profileArgs = editorProfileLaunchArgs().join(' ');
  //? Make sure openvscode is installed (no-op if the image baked it in).
  const ensured = await ensureOpenvscodeInContainer(input.container);
  if (ensured.error !== undefined) return { ok: false, error: ensured.error };
  //? Carry the user's profile (extensions + auth secret-storage) INTO the container FIRST, so a
  //? login done in any prior ticket's editor is reused here (ADR 0010).
  const projected = await projectProfileIntoContainer(input.container, input.userId);
  if (projected.error !== undefined) return { ok: false, error: projected.error };
  //? Land the shared-theme settings into the PROFILE user-data dir (base64 to stay shell-safe).
  const settings = input.settingsJson ?? JSON.stringify(DEFAULT_SETTINGS, null, 2);
  const b64 = Buffer.from(settings, 'utf8').toString('base64');
  const writeSettings = await docker(['exec', input.container, 'bash', '-lc',
    `mkdir -p ${IN_CONTAINER_USER_DATA}/Machine && echo ${b64} | base64 -d > ${IN_CONTAINER_USER_DATA}/Machine/settings.json`]);
  if (writeSettings.code !== 0) return { ok: false, error: `editor.settingsFailed: ${writeSettings.err.slice(0, 200)}` };
  //? Install any extensions from the user's set into the PROFILE extensions dir (idempotent),
  //? resolving from Open VSX (#14) rather than the Microsoft marketplace.
  const gallery = openVsxEnvPrefix();
  for (const ext of input.extensions ?? []) {
    await docker(['exec', input.container, 'bash', '-lc', `${gallery}openvscode-server ${profileArgs} --install-extension ${ext} || true`]);
  }
  //? Start the server detached on the fixed internal port, pointed at the projected profile.
  //? Bind 0.0.0.0 so the Caddy route can dial `<container>:3000` over workspaces-net (the
  //? container is NEVER host-published; edge exposure is Caddy-only). 127.0.0.1 would be
  //? loopback-only inside the container and unreachable by Caddy.
  const start = await docker(['exec', '-d', input.container, 'bash', '-lc',
    `${gallery}openvscode-server --host 0.0.0.0 --port ${String(EDITOR_IN_CONTAINER_PORT)} --connection-token ${input.token} --default-folder ${workdir} ${profileArgs}`]);
  if (start.code !== 0) return { ok: false, error: `editor.startFailed: ${start.err.slice(0, 200)}` };
  return { ok: true };
}
