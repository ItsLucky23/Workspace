//? Workspaces — [dev-launch-editor] DEV-ONLY: launch a container editor for a throwaway demo
//? ticket (disk-seeded bare mirror, no DB) and return the REAL `vscode-<slug>.<domain>` subdomain
//? URL, so the editor can be shown in a BROWSER iframe via the real proxy path without an
//? engine-activated ticket. Hard-gated on `WS_DEV_EDITOR=1` (inert otherwise) — it runs docker,
//? so it must never be reachable in production. Not an app feature; a browser-proof harness for
//? the per-container editor (ADR 0010 / CODE_EDITOR §1).

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { openEditorForTicket, editorRoute } from '../../../server/container/editorSession';
import { containerName } from '../../../server/container/runtime';
import { getProxyProvider } from '../../../server/proxy';

export const rateLimit: number | false = 6;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: false, additional: [] };

export interface ApiParams {
  //? authWorkspaceId: point the route's edge-auth at a REAL DB workspace (host→workspace Redis
  //? map, written server-side with the right Redis auth) so /editor-auth-check does per-workspace
  //? membership. The editor container itself stays the disk-only demo. Test-harness only.
  data: { authWorkspaceId?: string };
  user: SessionLayout | null;
  functions: Functions;
}

const WS = 'demows';
const KEY = 'DEV-DEMO';

//? Seed a disk-only bare mirror with the demo branch (no DB), the way launchTicketContainer clones.
function ensureMirror(): void {
  const mirror = path.join(process.cwd(), 'data', 'workspaces', WS, 'repo.git');
  if (existsSync(mirror)) return;
  const tmp = path.join(process.cwd(), 'data', 'workspaces', WS, '_seed');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const git = (a: string[]): void => { spawnSync('git', a, { cwd: tmp, encoding: 'utf8' }); };
  git(['init', '-q']); git(['config', 'user.email', 'a@b.c']); git(['config', 'user.name', 't']);
  spawnSync('bash', ['-lc', `cd "${tmp}" && echo '# Demo editor workspace' > README.md && mkdir -p src && echo 'export const hi = () => "hi";' > src/app.ts`]);
  git(['add', '-A']); git(['commit', '-qm', 'init']); git(['branch', KEY]);
  spawnSync('git', ['clone', '--bare', '-q', tmp, mirror]);
  rmSync(tmp, { recursive: true, force: true });
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  if (process.env.WS_DEV_EDITOR !== '1') return { status: 'error', errorCode: 'editor.devDisabled' };
  ensureMirror();
  const result = await openEditorForTicket({ workspaceId: WS, ticketKey: KEY, branch: KEY, userId: 'demo', image: 'workspaces/base:0.1.0' });
  //? Re-point the route's edge-auth membership at a real workspace (server-side Redis write).
  if (result.ok && typeof data.authWorkspaceId === 'string' && data.authWorkspaceId.length > 0) {
    const route = editorRoute({ workspaceId: data.authWorkspaceId, ticketKey: KEY, branch: KEY, containerName: containerName(WS, KEY) });
    await getProxyProvider().upsertRoute(route);
  }
  return { status: 'success', result };
};
