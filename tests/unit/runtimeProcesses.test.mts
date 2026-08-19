//? ADR 0317 — the runtime is a LIST of processes, and this pins the resolution that decides WHICH list
//? runs and WHICH process gets the preview URL.
//?
//? It is a unit test because every one of these cases is a silent failure in production: the wrong
//? list means the preview boots the wrong app, and a preview id that names nothing means the proxy
//? points at no process while the container looks perfectly healthy. None of that throws, none of it
//? shows up in a screenshot, and all of it reads to the user as "the preview is broken again".

import { resolveRuntime, type RuntimeProcess } from '../../server/container/runtimeProcesses.ts';
import { assert, eq, report } from '../_helpers.mts';

const proc = (id: string, command: string): RuntimeProcess => ({ id, name: id, cwd: '', env: [], commands: [command] });

/* ------------------------------------------------------------ the legacy path is untouched */

//? Every project that existed before 0317 has an empty list. It must resolve to exactly the single
//? command the preview ran before, or this change breaks every workspace on upgrade.
{
  const r = resolveRuntime({ devCommand: 'npm run start', stack: 'node', runProcesses: [] });
  eq(r.processes.length, 1, 'an empty list falls back to one process');
  eq(r.processes[0]?.commands[0], 'npm run start', '…carrying the legacy devCommand verbatim');
  eq(r.previewId, r.processes[0]?.id, '…and that process owns the preview URL');
}

//? No command anywhere: the stack default still applies, exactly as `resolveDevCommand` decided before.
{
  const r = resolveRuntime({ devCommand: null, stack: 'node', runProcesses: [] });
  eq(r.processes.length, 1, 'no command at all still yields one process');
  assert((r.processes[0]?.commands[0] ?? '').length > 0, '…running the stack default rather than nothing');
}

/* ------------------------------------------------------------ the list */

{
  const list = [proc('a', 'npm run client'), proc('b', 'npm run server')];
  const r = resolveRuntime({ devCommand: 'npm run dev', stack: 'node', runProcesses: list, previewProcessId: 'b' });
  eq(r.processes.length, 2, 'both processes run — the point of the whole change');
  eq(r.previewId, 'b', 'the chosen preview process keeps the URL');
  //? The legacy field must NOT sneak back in as a third process once a list exists, or a project that
  //? migrated would quietly run its old command alongside its new ones.
  assert(!r.processes.some((p) => p.commands.includes('npm run dev')), 'the legacy devCommand is not appended to a real list');
}

//? A row with no command is an unfinished editor row, not a process. It must never become a terminal
//? tab that attaches to a log nothing ever writes.
{
  const r = resolveRuntime({ devCommand: '', stack: 'node', runProcesses: [proc('a', 'npm run client'), proc('blank', '   ')] });
  eq(r.processes.length, 1, 'an empty row is dropped');
  eq(r.previewId, 'a', '…and the preview falls to the row that survives');
}

//? A preview id pointing at a deleted process is the state a UI bug leaves behind. Falling back to the
//? first process is the only answer that still shows the user something; proxying nothing is not.
{
  const r = resolveRuntime({ devCommand: '', stack: 'node', runProcesses: [proc('a', 'x'), proc('b', 'y')], previewProcessId: 'gone' });
  eq(r.previewId, 'a', 'an unknown preview id falls back to the first process');
}

/* ------------------------------------------------------------ service beats project */

//? The pre-0317 service override is a single command and must stay exact: a monorepo ticket that
//? booted `service dev` before this change still boots `service dev`, list or no list on the project.
{
  const r = resolveRuntime(
    { devCommand: 'root dev', stack: 'node', runProcesses: [proc('p1', 'project one'), proc('p2', 'project two')] },
    { devCommand: 'service dev' },
  );
  eq(r.processes.length, 1, "the service's own command wins whole");
  eq(r.processes[0]?.commands[0], 'service dev', '…and it is exactly that command');
  assert(!r.processes.some((p) => p.id === 'p1'), '…so the project list does not run alongside it');
}

//? A service WITHOUT its own command inherits the project's list, not the project's legacy single
//? command — otherwise declaring one service would silently downgrade the whole project to one process.
{
  const r = resolveRuntime(
    { devCommand: 'root dev', stack: 'node', runProcesses: [proc('p1', 'project one'), proc('p2', 'project two')] },
    { devCommand: null },
  );
  eq(r.processes.length, 2, 'a service without an override inherits the project list');
}

report('runtimeProcesses');
