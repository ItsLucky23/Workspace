#!/usr/bin/env node
//? `npm run stop` — stop THIS repo's dev runtimes: the `luckystack-dev` supervisor tree (backend),
//? any orphaned `tsx … server/server.ts` child it left behind, and the Vite dev client.
//?
//? Why a script (lesson 0016 + branch-log 2026-08-23/24): killing the process that holds :4787
//? only kills the supervisor's CHILD — the supervisor respawns it, so the port stays taken and the
//? next `npm run server` hops to :4788/:4789 (or, with SERVER_PORT_AUTO_INCREMENT=0, fails loudly).
//? Stopping a harness background task has the same effect: the shell dies, the supervisor survives.
//? The only reliable stop is the whole tree, keyed on the SUPERVISOR pid.
//?
//? Selection is by command line: it must reference this repo's root (so a sibling project's Vite or
//? supervisor is never touched) AND one of the known runtime entrypoints. Nothing else is killed.
//? Usage: `npm run stop` (add `-- --dry` to list without killing).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry');
const ENTRYPOINTS = ['@luckystack/devkit/dist/supervisor.js', 'vite/bin/vite.js', 'server/server.ts'];
const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
const rootKey = norm(ROOT);

function listProcesses() {
  if (process.platform === 'win32') {
    const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress';
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), cmd: String(p.CommandLine ?? '') }));
  }
  const raw = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return raw.split('\n').filter(Boolean).map((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] } : null;
  }).filter(Boolean);
}

function isRuntime(p) {
  const cmd = norm(p.cmd);
  if (!cmd.includes(rootKey) || !ENTRYPOINTS.some((e) => cmd.includes(e))) return false;
  //? `vite build` (npm run build) shares the entrypoint with the dev client — never kill a build.
  return !/vite\.js"?\s+build\b/.test(cmd);
}

function kill(pid) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
  }
}

const all = listProcesses();
const byPid = new Map(all.map((p) => [p.pid, p]));
const targets = all.filter(isRuntime);
//? Kill from the top of each tree: drop any target whose ancestor is also a target (taskkill /T and
//? the process-group signal take the children along), so the supervisor goes before its child.
const roots = targets.filter((p) => {
  let cur = byPid.get(p.ppid);
  for (let i = 0; cur && i < 8; i += 1) { if (targets.includes(cur)) return false; cur = byPid.get(cur.ppid); }
  return true;
});

if (roots.length === 0) {
  console.log('[stop] no dev runtimes of this repo are running.');
  process.exit(0);
}
for (const p of roots) {
  const label = ENTRYPOINTS.find((e) => norm(p.cmd).includes(e)) ?? 'runtime';
  console.log(`[stop] ${DRY ? 'would kill' : 'killing'} pid ${String(p.pid)} (${label})`);
  if (!DRY) {
    try { kill(p.pid); } catch (error) { console.log(`[stop]   failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
if (!DRY) {
  const left = listProcesses().filter(isRuntime);
  if (left.length > 0) {
    console.log(`[stop] ${String(left.length)} runtime process(es) still alive: ${left.map((p) => String(p.pid)).join(', ')}`);
    process.exit(1);
  }
  console.log(`[stop] done — ${String(roots.length)} tree(s) stopped, nothing of this repo left running.`);
}
