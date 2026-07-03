//? Dev tool — launch the REAL per-container VS Code (editor #2) with a named per-user profile,
//? so you can test the whole ADR 0010 flow WITHOUT the app/auth/conductor. Uses the real
//? editorServer + editorProfile code against Docker.
//?
//?   npm run editor:launch            # up with profile "me" on http://localhost:3210
//?   npm run editor:launch -- me 3210 # explicit profile + port
//?   npm run editor:launch -- me 3210 down   # capture the profile back + tear the container down
//?
//? Persistence test: `up`, open the URL, install an extension or sign in, then `down` (captures
//? the profile), then `up` again → your extension/login is still there (it rode the profile).

import { spawnSync } from 'node:child_process';
import { startEditorInContainer } from '../../server/container/editorServer.ts';
import { captureProfileFromContainer, editorProfileDir } from '../../server/container/editorProfile.ts';

const [, , profileArg, portArg, actionArg] = process.argv;
const PROFILE = profileArg ?? 'me';
const PORT = portArg ?? '3210';
const ACTION = actionArg ?? 'up';
const IMAGE = process.env.WS_EDITOR_IMAGE ?? 'workspaces/base-editor:test';
const CONTAINER = `ls-editor-${PROFILE}`;
const TOKEN = 'dev';
const NET = process.env.WS_NET ?? 'workspaces-net';

interface Res { code: number; out: string; err: string }
function run(cmd: string, args: string[]): Res {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const docker = (args: string[]): Res => run('docker', args);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function down(): Promise<void> {
  console.log(`Capturing profile "${PROFILE}" back from ${CONTAINER} …`);
  const cap = await captureProfileFromContainer(CONTAINER, PROFILE);
  console.log(cap.ok ? `Saved to ${editorProfileDir(PROFILE)}` : `(capture: ${cap.error ?? 'container gone?'})`);
  docker(['rm', '-f', CONTAINER]);
  console.log('Container removed. Run `up` again to resume with your profile intact.');
}

async function up(): Promise<void> {
  docker(['rm', '-f', CONTAINER]);
  docker(['network', 'create', NET]); // idempotent
  console.log(`Launching ${CONTAINER} from ${IMAGE} on :${PORT} …`);
  const r = docker(['run', '-d', '--name', CONTAINER, '--network', NET, '-p', `${PORT}:3000`, IMAGE, 'sleep', 'infinity']);
  if (r.code !== 0) { console.error(`docker run failed: ${r.err}`); process.exitCode = 1; return; }
  //? Seed a /work git repo so the editor opens a real folder with source control.
  docker(['exec', CONTAINER, 'bash', '-lc', 'mkdir -p /work/src && cd /work && ([ -d .git ] || (git init -q && printf "# Editor test workspace\\n" > README.md && printf "export const hello = () => \\"hi\\";\\n" > src/app.ts && git add -A && git -c user.email=a@b.c -c user.name=dev commit -qm init))']);
  console.log('Starting openvscode + projecting your profile (installs openvscode on first run) …');
  const started = await startEditorInContainer({ container: CONTAINER, userId: PROFILE, token: TOKEN, workdir: '/work' });
  if (started.error !== undefined) { console.error(`startEditor failed: ${started.error}`); process.exitCode = 1; return; }
  await sleep(3000);
  console.log('\n==============================================================');
  console.log(`  Real VS Code is UP:  http://localhost:${PORT}/?tkn=${TOKEN}`);
  console.log(`  Profile "${PROFILE}"  (store: ${editorProfileDir(PROFILE)})`);
  console.log('  Install an extension / sign in, then:  npm run editor:launch --',
    `${PROFILE} ${PORT} down   (saves it), then up again to prove it persists.`);
  console.log('==============================================================\n');
}

await (ACTION === 'down' ? down() : up());
