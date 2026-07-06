//? PTY prompt-ready detection (C4 depth-program). The interactive `claude` turn used hardcoded
//? `wait(7000)`/`wait(3000)` before confirming folder-trust + sending the kickoff — fragile on a
//? slow boot (proceed before the prompt is up → the turn misfires) and wasteful on a fast one. These
//? pure predicates scan the accumulated PTY output for the CLI's known ready/trust markers, and
//? `waitForOutput` early-exits as soon as one appears (with a ceiling so it never hangs). Pure +
//? injectable → unit-tested without a real PTY.

//? Markers that the folder-trust prompt is on screen (the CLI asks before touching files).
const TRUST_PATTERNS: RegExp[] = [
  /trust the files/i,
  /do you trust/i,
  /yes,\s*proceed/i,
];

//? Markers that the interactive input prompt is ready to receive the kickoff (the input box / the
//? shortcuts hint / the welcome banner). Broad on purpose — a superset match just means "ready".
const READY_PATTERNS: RegExp[] = [
  /\?\s*for shortcuts/i,
  /welcome to claude/i,
  /│\s*>/,        // the input box gutter
  /╭[─-]+╮/,      // the boxed prompt border
  /›\s*$/,        // a caret prompt
];

const anyMatch = (patterns: RegExp[], buffer: string): boolean => patterns.some((re) => re.test(buffer));

export const matchesTrustPrompt = (buffer: string): boolean => anyMatch(TRUST_PATTERNS, buffer);
export const matchesReady = (buffer: string): boolean => anyMatch(READY_PATTERNS, buffer);
export const matchesTrustOrReady = (buffer: string): boolean => matchesTrustPrompt(buffer) || matchesReady(buffer);

//? Poll `read()` until `test` passes or `timeoutMs` elapses. Returns whether the condition was met
//? (false = timed out → the caller proceeds anyway, so a wrong pattern degrades to a bounded wait,
//? never a hang). `read`/`sleepFn` are injectable for tests.
export async function waitForOutput(
  read: () => string,
  test: (buffer: string) => boolean,
  opts: { timeoutMs?: number; pollMs?: number; now?: () => number; sleepFn?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 9000;
  const pollMs = opts.pollMs ?? 200;
  const now = opts.now ?? ((): number => Date.now());
  const sleepFn = opts.sleepFn ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  for (;;) {
    if (test(read())) return true;
    if (now() >= deadline) return false;
    await sleepFn(pollMs);
  }
}
