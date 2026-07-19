//? F09 — the `run-command` allowlist.
//?
//? `run-command` executes a user-supplied string as `sh -lc` inside the ticket container. The documented
//? contract (03_AUTOMATION_AND_PLUGINS) promised an allowlist boundary; the code had none. It IS
//? human-gated (an operator approves each run), so this is not an open door — but "a human clicked yes"
//? and "the command is bounded" are different guarantees, and a trigger that was approved once can be
//? edited afterwards.
//?
//? Shipped REPORT-FIRST (ADR 0278): by default a command outside the allowlist is RECORDED and still runs,
//? because an install may legitimately depend on a shell one-liner nobody wrote down. `WS_COMMAND_ENFORCE=1`
//? turns the same decision into a refusal. The report is what tells an operator whether flipping it is safe.

export const COMMAND_ENFORCE = process.env.WS_COMMAND_ENFORCE === '1';

//? The default allowlist: the verbs an automation legitimately needs inside a work container. Deliberately
//? conservative — build/test/inspect, not "administer the box".
const DEFAULT_ALLOWED = [
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'tsx',
  'python', 'python3', 'pip', 'pytest',
  'git', 'make', 'cargo', 'go', 'php', 'composer',
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'echo', 'pwd', 'test', 'true',
];

//? Shell metacharacters that CHAIN a second command. `npm test; rm -rf /` passes a naive
//? "starts with npm" check, which is exactly the hole an allowlist is supposed to close.
const CHAIN_TOKENS = [';', '&&', '||', '|', '`', '$(', '\n'];

export function allowedCommands(): string[] {
  const extra = (process.env.WS_COMMAND_ALLOW ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return [...DEFAULT_ALLOWED, ...extra];
}

export type CommandVerdict = 'allowed' | 'not-allowlisted' | 'chained' | 'empty';

//? Classify a command WITHOUT running it. Pure, so the policy is testable on its own — which matters
//? because the interesting cases are all adversarial strings.
export function classifyCommand(command: string): { verdict: CommandVerdict; binary: string } {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { verdict: 'empty', binary: '' };
  //? A chained command is refused on its shape, before the binary is even considered: the allowlist can
  //? only reason about ONE command, so anything that smuggles a second is out of scope by construction.
  if (CHAIN_TOKENS.some((token) => trimmed.includes(token))) {
    const head = trimmed.split(/[\s;&|]/)[0] ?? '';
    return { verdict: 'chained', binary: head };
  }
  //? Skip leading env assignments (`FOO=bar npm test`) so the real binary is what gets checked.
  const binary = (trimmed.split(/\s+/).find((part) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(part)) ?? '').split('/').at(-1) ?? '';
  if (binary.length === 0) return { verdict: 'empty', binary: '' };
  return { verdict: allowedCommands().includes(binary) ? 'allowed' : 'not-allowlisted', binary };
}

export interface CommandObservation { binary: string; verdict: CommandVerdict; workspaceId: string; at: number }

const observations: CommandObservation[] = [];
const MAX_OBSERVATIONS = 300;

export function recordCommandObservation(o: CommandObservation): void {
  observations.push(o);
  if (observations.length > MAX_OBSERVATIONS) observations.splice(0, observations.length - MAX_OBSERVATIONS);
}

export function commandPolicyReport(): { total: number; refusedIfEnforced: number; byBinary: { binary: string; verdict: CommandVerdict; count: number }[] } {
  const counts = new Map<string, { verdict: CommandVerdict; count: number }>();
  for (const o of observations) {
    const key = `${o.binary}:${o.verdict}`;
    const entry = counts.get(key) ?? { verdict: o.verdict, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return {
    total: observations.length,
    refusedIfEnforced: observations.filter((o) => o.verdict !== 'allowed').length,
    byBinary: [...counts.entries()].map(([key, v]) => ({ binary: key.split(':')[0] ?? '', verdict: v.verdict, count: v.count })),
  };
}

export function resetCommandPolicyReport(): void { observations.length = 0; }

//? The decision the executor acts on. In report mode a non-allowlisted command still runs — and is
//? recorded — so nobody's working automation breaks on an upgrade they did not ask for.
export function shouldRunCommand(command: string, workspaceId: string): { run: boolean; verdict: CommandVerdict; binary: string } {
  const { verdict, binary } = classifyCommand(command);
  recordCommandObservation({ binary, verdict, workspaceId, at: Date.now() });
  if (verdict === 'allowed') return { run: true, verdict, binary };
  if (verdict === 'empty') return { run: false, verdict, binary };
  if (COMMAND_ENFORCE) return { run: false, verdict, binary };
  console.warn(`[command-policy] '${binary}' is not allowlisted (${verdict}); running anyway. Set WS_COMMAND_ENFORCE=1 to refuse, or WS_COMMAND_ALLOW to widen the list.`);
  return { run: true, verdict, binary };
}
