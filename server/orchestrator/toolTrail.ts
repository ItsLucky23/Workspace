//? GAP_SCAN D2 — the per-tool-call turn audit trail.
//?
//? Before this, the only record of what an agent turn actually DID was the live PTY tail (broadcast,
//? never persisted) plus the carry-over summary the agent wrote about itself. After the fact you could
//? not answer "which files did it touch, and which commands did it run, in what order?" — the question
//? every review and every incident starts with.
//?
//? The PostToolUse hook appends one JSON line per tool call inside the container; this module turns those
//? lines into ordered, human-readable TicketEvents. Pure parsing here (unit-testable, no container, no DB);
//? the stage runner owns draining the file and writing the rows.

//? What the CLI hands the hook. Every field is optional on purpose — this is untrusted, version-drifting
//? input from another process, and a shape change must degrade to a coarser line, never throw.
export interface ToolCallLine {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  at?: number;
}

const str = (o: Record<string, unknown>, k: string): string | undefined => (typeof o[k] === 'string' ? o[k] : undefined);

//? Hook output is another process's stdout: a truncated or half-flushed line is expected, not exceptional.
const safeJson = (text: string): unknown => {
  const [error, value] = tryCatchSync<unknown>(() => JSON.parse(text) as unknown);
  return error ? null : value;
};

//? The repo bans raw try/catch (lint rule); `tryCatch` is async-only, so this is its sync twin, kept local.
function tryCatchSync<T>(fn: () => T): [Error | null, T | null] {
  // eslint-disable-next-line luckystack/no-raw-try-catch -- JSON.parse is sync; this IS the tryCatch primitive, one line, no I/O
  try { return [null, fn()]; } catch (error) { return [error instanceof Error ? error : new Error(String(error)), null]; }
}

//? One JSONL line → a normalized tool call. Returns null for blank lines, non-JSON, or a payload with no
//? recognizable tool name (a malformed line must not poison the whole trail).
export function parseToolCallLine(line: string): ToolCallLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith('{')) return null;
  const raw = safeJson(trimmed);
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  //? The CLI has used both `tool_name` and `tool` across versions; accept either.
  const tool = str(obj, 'tool_name') ?? str(obj, 'tool') ?? '';
  if (tool.length === 0) return null;
  const rawInput = obj.tool_input ?? obj.input;
  const input = rawInput !== null && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput as Record<string, unknown> : {};
  //? A response carrying an explicit error marks the call failed; anything else counts as ok.
  const response = obj.tool_response ?? obj.response;
  const failed = response !== null && typeof response === 'object' && !Array.isArray(response)
    ? (response as Record<string, unknown>).error !== undefined || (response as Record<string, unknown>).is_error === true
    : false;
  const at = typeof obj.at === 'number' ? obj.at : undefined;
  return { tool, input, ok: !failed, ...(at === undefined ? {} : { at }) };
}

//? The feed line for one call: "Edit src/foo.ts" / "Bash: npm run build" / "Read package.json".
export function describeToolCall(call: ToolCallLine): string {
  const file = str(call.input, 'file_path') ?? str(call.input, 'path') ?? str(call.input, 'notebook_path');
  const command = str(call.input, 'command');
  const pattern = str(call.input, 'pattern');
  const detail = command ?? file ?? pattern ?? str(call.input, 'url') ?? '';
  const head = detail.length > 0 ? `${call.tool}: ${detail.slice(0, 200)}` : call.tool;
  return call.ok ? head : `${head} (failed)`;
}

//? Which TicketEvent type a call belongs to, so the feed can filter "what did it CHANGE" from "what did
//? it look at". Write-tools are file-changes, shell is a command, everything else is a plain tool use.
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'str_replace_editor']);
export function toolEventType(call: ToolCallLine): 'file-change' | 'command' | 'tool-use' {
  if (WRITE_TOOLS.has(call.tool)) return 'file-change';
  if (call.tool === 'Bash' || call.tool === 'BashOutput') return 'command';
  return 'tool-use';
}

export interface ToolTrailEntry {
  type: 'file-change' | 'command' | 'tool-use';
  text: string;
  metadata: { tool: string; ok: boolean; changedFiles?: string[] };
}

//? A whole JSONL blob → the ordered trail. Bounded: a 500-tool turn should not write 500 rows, so only the
//? newest `max` calls are kept (the tail is what a reviewer reads). Order is preserved.
export function parseToolTrail(jsonl: string, max = 100): ToolTrailEntry[] {
  const calls = jsonl.split('\n').map((l) => parseToolCallLine(l)).filter((c): c is ToolCallLine => c !== null);
  return calls.slice(-max).map((call) => {
    const file = str(call.input, 'file_path') ?? str(call.input, 'path');
    return {
      type: toolEventType(call),
      text: describeToolCall(call),
      metadata: { tool: call.tool, ok: call.ok, ...(file !== undefined && toolEventType(call) === 'file-change' ? { changedFiles: [file] } : {}) },
    };
  });
}
