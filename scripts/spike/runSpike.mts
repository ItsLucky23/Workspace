//? P0.5 spike — the interactive-PTY runner (Spike A billing + Spike B hooks,
//? P0_CLI_SPIKE.md §1/§2). Spawns `claude` in a node-pty with a SCRUBBED env (no
//? ANTHROPIC_*/CLAUDE_CODE api overrides — Spike A2: a stray key silently flips
//? billing to metered) inside a temp project whose `.claude/settings.json` renders
//? every lifecycle hook as `type:http` → the capture endpoint (run `npm run
//? spike:hooks` first). It then streams the PTY so the operator can drive one real
//? turn and observe billing.
//?
//? GATED ACTION — running this spawns a REAL `claude` turn that bills your Max
//? subscription; it must be run BY A HUMAN against a logged-in host on the real
//? server OS (G-SPIKE-3), never by an unattended agent. Verdicts (billing on
//? subscription? hooks fired?) are HUMAN-OBSERVED (host `claude /usage` +
//? the hook-capture summary) and recorded in SPIKE_RESULTS.md.
//?
//? `--dry` renders the config + prints the exact spawn WITHOUT launching claude — the
//? safe path to review the harness. Usage: `npx tsx scripts/spike/runSpike.mts` (real)
//? / `npx tsx scripts/spike/runSpike.mts --dry` (review only). Start the hook capture
//? first: `npx tsx scripts/spike/hookCapture.mts`.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as pty from 'node-pty';

const DRY = process.argv.includes('--dry');
const HOOK_PORT = Number(process.env.WS_SPIKE_HOOK_PORT ?? '8790');
const HOOK_TOKEN = process.env.WS_SPIKE_HOOK_TOKEN ?? 'spike-dev-token';
const HOOK_BASE = `http://127.0.0.1:${String(HOOK_PORT)}/hook`;
const CLAUDE_BIN = process.env.WS_SPIKE_CLAUDE_BIN ?? 'claude';

//? Render a type:http hook for one event → the capture endpoint (token-gated). The
//? EXACT type:http schema is what Spike B verifies against the running CLI; this is a
//? best-effort per P0_CLI_SPIKE.md §2 — adjust if the CLI version rejects it.
function httpHook(event: string): unknown {
  return { matcher: '*', hooks: [{ type: 'http', url: `${HOOK_BASE}/${event}`, headers: { 'X-WS-Hook-Token': HOOK_TOKEN } }] };
}

const settings = {
  hooks: {
    SessionStart: [httpHook('SessionStart')],
    Stop: [httpHook('Stop')],
    PostToolUse: [httpHook('PostToolUse')],
    Notification: [httpHook('Notification')],
    PreCompact: [httpHook('PreCompact')],
    UserPromptSubmit: [httpHook('UserPromptSubmit')],
  },
};

//? Spike A: a CLEAN env — strip every var that could flip billing off the Max
//? subscription onto the metered API pool (A2). CLAUDE_CONFIG_DIR is left to the
//? host default so the operator's `/login` session authenticates (Spike A1).
function scrubbedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^ANTHROPIC_/.test(k)) continue;               // API key / auth token / base url
    if (k === 'CLAUDE_CODE_USE_BEDROCK' || k === 'CLAUDE_CODE_USE_VERTEX') continue;
    out[k] = v;
  }
  return out;
}

const projDir = join(tmpdir(), `ws-spike-${String(process.pid)}`);
const claudeDir = join(projDir, '.claude');

function renderConfig(): void {
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}

function printPlan(): void {
  console.log('[spike] ===== P0.5 interactive-PTY spike plan =====');
  console.log(`[spike] project dir      : ${projDir}`);
  console.log(`[spike] settings.json    : ${join(claudeDir, 'settings.json')}`);
  console.log(`[spike] hook endpoint    : ${HOOK_BASE}/<EventName>  (start: npx tsx scripts/spike/hookCapture.mts)`);
  console.log(`[spike] claude binary    : ${CLAUDE_BIN}`);
  console.log('[spike] env: ANTHROPIC_*/bedrock/vertex STRIPPED (Spike A clean-env)');
  console.log('[spike] to record: A1 (turn bills SUBSCRIPTION not API — check `claude /usage`/dashboard before+after)');
  console.log('[spike]            B1..B5 (which hooks POSTed — see the spike:hooks summary)');
  console.log('[spike]            D1 (any hook payload carried a usage field)');
}

renderConfig();
printPlan();

if (DRY) {
  console.log('\n[spike] --dry: config rendered, claude NOT spawned. Review settings.json above, then run without --dry.');
  rmSync(projDir, { recursive: true, force: true });
  process.exit(0);
}

console.log('\n[spike] spawning interactive claude (REAL turn — bills your subscription). Ctrl+C to end.\n');
const term = pty.spawn(CLAUDE_BIN, [], { name: 'xterm-color', cols: 120, rows: 34, cwd: projDir, env: scrubbedEnv() });
term.onData((d) => { process.stdout.write(d); });
//? Bridge the operator's keystrokes into the PTY so they can drive the turn manually.
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (d) => { term.write(String(d)); });
term.onExit(({ exitCode }) => {
  console.log(`\n[spike] claude exited (code ${String(exitCode)}). Record A1/B/D verdicts in SPIKE_RESULTS.md.`);
  rmSync(projDir, { recursive: true, force: true });
  process.exit(0);
});
