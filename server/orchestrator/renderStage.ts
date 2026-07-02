//? renderStage — PipelineStage config → the container `.claude` artifacts (07 §A step 6,
//? GOLDEN_PLAN_STAGE §2-6). Pure function (unit-testable, no container/credential): given a
//? stage cfg + session context it returns the four rendered strings; a separate step
//? materializes them into the container volume (stageRunner). Deferred + flagged: context-doc
//? @imports from sourceIds, the MCP skill catalog, model-tier→id mapping, and the D2 role
//? prompt-layering — the first version renders the load-bearing task + permissions + Stop hook.

import type { PipelineStageCfg } from '../../src/workspaces/_data/types';
import type { CarryOverEnvelope } from './turnResult';
import { renderPromptTemplate } from './turnResult';

export interface StageRenderCtx {
  ticketId: string;
  commitHash?: string;
  carryOver: CarryOverEnvelope | null;
}

export interface StageArtifacts {
  claudeMd: string;
  stageInstructions: string;
  settingsJson: string;
  mcpJson: string;
}

//? The read/propose structured-channel verbs (02 §2) — always allowed so the agent can
//? report back (emit-carryover is how a stage signals done).
const WS_VERBS = ['emit-carryover', 'request-input', 'report-status', 'emit-event', 'emit-signal', 'emit-handoff', 'query-context'];

//? The Stop hook writes the turn payload (carries last_assistant_message, spike row B4) to a
//? file on the /work volume the host reads — the in-container analog of claudeCli's capture.
//? type:command (SessionStart/Stop are command-transport-reliable per the spike).
const STOP_HOOK_CMD = 'cat > /work/.claude/turn-stop.json';

export function renderStage(cfg: PipelineStageCfg, ctx: StageRenderCtx): StageArtifacts {
  //? CLAUDE.md = the stage's task framing (customInstructions verbatim), per GOLDEN §4.
  const claudeMd = `# ${cfg.name} stage — ${ctx.ticketId}\n\n${cfg.customInstructions}\n`;

  //? --append-system-prompt = the system layer + the carry-over-filled task, + the teaching
  //? that a stage ENDS by emitting a \`\`\`ws-carryover block (how the runner detects done).
  const stageInstructions = [
    cfg.systemPrompt ?? '',
    renderPromptTemplate(cfg.promptTemplate, ctx.carryOver),
    'When this stage is complete, end your final message with a fenced block:',
    '```ws-carryover\\n{ "summary": "...", "changedFiles": [], "openQuestions": [] }\\n```',
    'If you are blocked and need a human, end with a ```ws-needs-input block listing the questions instead.',
  ].filter((s) => s.trim().length > 0).join('\n\n');

  //? settings.json — permissions derived from the stage commands (allow/ask/deny) + the
  //? ws-verb allows + Read; deny always includes the auth-path denyRead (07b §2.4).
  const allow = [...WS_VERBS.map((v) => `Bash(ws ${v}:*)`), 'Read(**)', ...cfg.commands.filter((c) => c.mode === 'allow').map((c) => c.pattern)];
  const ask = cfg.commands.filter((c) => c.mode === 'ask').map((c) => c.pattern);
  const deny = [...cfg.commands.filter((c) => c.mode === 'deny').map((c) => c.pattern), 'Read(/auth/**)', 'Bash(cat /auth/*:*)'];
  const settingsJson = JSON.stringify({
    permissions: { allow, ask, deny },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: STOP_HOOK_CMD }] }] },
  }, null, 2);

  //? .mcp.json — one stdio server per enabled skill. The skill→command catalog is deferred;
  //? for now emit the declared skill keys as placeholders (strict-mcp-config scopes the stage).
  const mcpServers: Record<string, { type: string; command: string; args: string[] }> = {};
  for (const key of cfg.skillKeys) mcpServers[key] = { type: 'stdio', command: 'ws-skill', args: [key] };
  const mcpJson = JSON.stringify({ mcpServers }, null, 2);

  return { claudeMd, stageInstructions, settingsJson, mcpJson };
}
