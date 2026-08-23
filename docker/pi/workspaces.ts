//? Workspaces pi extension (CODING_AGENT_PROGRAM.md §2.2, ADR 0322) — baked into the base image at
//? /opt/workspaces/pi/workspaces.ts and loaded per turn with `--no-extensions -e <this>`. It mirrors the three
//? Claude Code hooks the stage runner relies on onto pi's extension events, writing the SAME files:
//?   Stop        → agent_settled          → /work/.claude/turn-stop.json  {last_assistant_message, session_id}
//?   PostToolUse → tool_execution_end     → /work/.claude/tool-calls.jsonl (one line per call, Claude tool names)
//?   PreCompact  → session_before_compact → /work/.claude/precompact-signal
//? and it enforces the stage's `permissions.deny` set from /work/.claude/settings.json on `tool_call` — pi has
//? no permission system of its own, so the deny patterns the stage editor writes are honoured here.
//? Runs INSIDE the hardened container only; it has no network and no secrets.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DIR = process.env.WS_CAPTURE_DIR ?? "/work/.claude";
const CAPTURE = path.join(DIR, "turn-stop.json");
const TRAIL = path.join(DIR, "tool-calls.jsonl");
const PRECOMPACT = path.join(DIR, "precompact-signal");
const SETTINGS = path.join(DIR, "settings.json");

//? pi tool → the Claude tool name the trail feed already classifies (file-change / command / tool-use).
const TOOL_NAMES: Record<string, string> = { bash: "Bash", read: "Read", edit: "Edit", write: "Write", grep: "Grep", find: "Glob", ls: "Bash" };

interface DenyRule { kind: "bash" | "read" | "tool"; prefix: string }

//? `Bash(cat /auth/*:*)` → bash prefix "cat /auth/*"; `Read(/auth/**)` → path prefix "/auth/"; a bare tool name
//? denies the tool. Unknown shapes are ignored (never throw inside the agent loop).
export function parseDenyRules(settingsJson: string): DenyRule[] {
  let parsed: unknown;
  try { parsed = JSON.parse(settingsJson); } catch { return []; }
  const deny = (parsed as { permissions?: { deny?: unknown } } | null)?.permissions?.deny;
  if (!Array.isArray(deny)) return [];
  const rules: DenyRule[] = [];
  for (const raw of deny) {
    if (typeof raw !== "string") continue;
    const m = /^(\w+)\((.*)\)$/.exec(raw);
    if (!m) { if (/^\w+$/.test(raw)) rules.push({ kind: "tool", prefix: raw.toLowerCase() }); continue; }
    const [, tool, pattern] = m;
    const body = (pattern ?? "").replace(/:\*$/, "").replace(/\*+$/, "").replace(/\*/g, "");
    if (tool === "Bash") rules.push({ kind: "bash", prefix: body.trim() });
    else if (tool === "Read" || tool === "Edit" || tool === "Write") rules.push({ kind: "read", prefix: body.trim() });
  }
  return rules;
}

export function deniedBy(rules: DenyRule[], toolName: string, input: Record<string, unknown>): string | null {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const file = typeof input.path === "string" ? input.path : (typeof input.file_path === "string" ? input.file_path : "");
  for (const r of rules) {
    if (r.kind === "tool" && r.prefix === toolName.toLowerCase()) return `tool ${toolName} is denied by the stage`;
    if (r.kind === "bash" && toolName === "bash" && r.prefix.length > 0 && command.startsWith(r.prefix)) return `command "${r.prefix}…" is denied by the stage`;
    if (r.kind === "read" && r.prefix.length > 0 && file.startsWith(r.prefix)) return `path ${r.prefix} is denied by the stage`;
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  mkdirSync(DIR, { recursive: true });
  const rules = existsSync(SETTINGS) ? parseDenyRules(readFileSync(SETTINGS, "utf8")) : [];

  pi.on("tool_call", async (event) => {
    const reason = deniedBy(rules, event.toolName, (event.input ?? {}) as Record<string, unknown>);
    return reason === null ? undefined : { block: true, reason };
  });

  //? `tool_execution_end` carries no args — remember them from `tool_execution_start` per call id.
  const argsByCall = new Map<string, unknown>();
  pi.on("tool_execution_start", async (event) => { argsByCall.set(event.toolCallId, event.args); });

  pi.on("tool_execution_end", async (event) => {
    const toolInput = argsByCall.get(event.toolCallId) ?? {};
    argsByCall.delete(event.toolCallId);
    const line = {
      tool_name: TOOL_NAMES[event.toolName] ?? event.toolName,
      tool_input: toolInput,
      ...(event.isError ? { tool_response: { is_error: true } } : {}),
      at: Date.now(),
    };
    try { appendFileSync(TRAIL, JSON.stringify(line) + "\n"); } catch { /* a lost trail line must never break the turn */ }
  });

  pi.on("session_before_compact", async () => {
    try { writeFileSync(PRECOMPACT, ""); } catch { /* best-effort signal */ }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const entries = ctx.sessionManager.getBranch();
    let last = "";
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as { type?: string; message?: { role?: string; content?: unknown } };
      if (e.type === "message" && e.message?.role === "assistant") {
        const c = e.message.content;
        last = Array.isArray(c)
          ? c.filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text ?? "").join("\n")
          : String(c ?? "");
        break;
      }
    }
    const payload = { last_assistant_message: last, session_id: ctx.sessionManager.getSessionId(), model: ctx.model?.id ?? "" };
    try { writeFileSync(CAPTURE, JSON.stringify(payload)); } catch { /* the runner times out and retries */ }
  });
}
