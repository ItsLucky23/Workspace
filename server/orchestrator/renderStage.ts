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
  //? Context-docs to inject into CLAUDE.md: the stage's `sourceIds` docs + any enabled
  //? workspace-wide workflow guidance (the starter-library snippets). Loaded by stageRunner
  //? (renderStage stays pure). Each is written inline so the in-container agent reads it.
  contextDocs?: { name: string; content: string }[];
  //? RAG-retrieved code excerpts most relevant to this ticket (07 §D), injected so the agent
  //? starts with the right files in view. Loaded by stageRunner (retrieval stays out of the renderer).
  retrieved?: { filePath: string; content: string }[];
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

//? Read-only shell commands every stage may run WITHOUT a permission prompt — so an
//? autonomous turn can explore the repo (ls/grep/git-log/…) instead of hanging on an
//? approval it will never get. State-mutating shell (rm, git push, …) is NOT here; a stage
//? that needs to write adds its own patterns via StageCommandCfg(mode='allow').
const READ_ONLY_BASH = [
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)', 'Bash(rg:*)',
  'Bash(find:*)', 'Bash(wc:*)', 'Bash(tree:*)', 'Bash(pwd:*)', 'Bash(echo:*)', 'Bash(sed:*)', 'Bash(awk:*)',
  'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git status:*)', 'Bash(git branch:*)',
];

//? The Stop hook writes the turn payload (carries last_assistant_message, spike row B4) to a
//? file on the /work volume the host reads — the in-container analog of claudeCli's capture.
//? `sh -c` so the `>` redirect works regardless of how the CLI executes the hook command.
//? type:command (Stop is command-transport-reliable per the spike).
const STOP_HOOK_CMD = "sh -c 'cat > /work/.claude/turn-stop.json'";

export function renderStage(cfg: PipelineStageCfg, ctx: StageRenderCtx): StageArtifacts {
  //? CLAUDE.md = the stage's task framing (customInstructions verbatim, GOLDEN §4) + any
  //? injected context-docs / workflow guidance (bounded inline, so the agent actually reads
  //? the workspace conventions rather than them being a dead toggle).
  const docs = (ctx.contextDocs ?? []).filter((d) => d.content.trim().length > 0);
  const docsSection = docs.length > 0
    ? `\n\n---\n\n## Project & workflow guidance\n\nFollow the conventions in these workspace documents:\n\n${docs.map((d) => `### ${d.name}\n\n${d.content.trim().slice(0, 4000)}`).join('\n\n')}\n`
    : '';
  //? RAG: the code excerpts retrieved as most relevant to this ticket — a starting map for the agent.
  const hits = (ctx.retrieved ?? []).filter((h) => h.content.trim().length > 0);
  const retrievedSection = hits.length > 0
    ? `\n\n---\n\n## Relevant code from the repository\n\nThese excerpts were retrieved as most relevant to this ticket. Use them as a starting map, then open the full files as needed:\n\n${hits.map((h) => `### ${h.filePath}\n\n\`\`\`\n${h.content.trim().slice(0, 1500)}\n\`\`\``).join('\n\n')}\n`
    : '';
  const claudeMd = `# ${cfg.name} stage — ${ctx.ticketId}\n\n${cfg.customInstructions}\n${docsSection}${retrievedSection}`;

  //? --append-system-prompt = the system layer + the carry-over-filled task, + the teaching
  //? that a stage ENDS by emitting a \`\`\`ws-carryover block (how the runner detects done).
  //? Per-stage "definition of done": if the stage sets one, the AI works toward it; if not,
//? the AI judges completion itself (the product owner's choice). Either way the stage ENDS
//? by emitting the ws-carryover block — that IS the done signal.
  const doneGuidance = (cfg.definitionOfDone ?? '').trim().length > 0
    ? `This stage is DONE when: ${cfg.definitionOfDone}. When that is satisfied, end your final message with the fenced block below.`
    : 'Judge for yourself when this stage\'s goal is achieved, then end your final message with the fenced block below.';
  const stageInstructions = [
    cfg.systemPrompt ?? '',
    renderPromptTemplate(cfg.promptTemplate, ctx.carryOver),
    doneGuidance,
    '```ws-carryover\\n{ "summary": "...", "changedFiles": [], "openQuestions": [] }\\n```',
    'If you are blocked and need a human, end with a ```ws-needs-input block listing the questions instead.',
  ].filter((s) => s.trim().length > 0).join('\n\n');

  //? settings.json — permissions derived from the stage commands (allow/ask/deny) + the
  //? ws-verb allows + Read; deny always includes the auth-path denyRead (07b §2.4).
  const allow = [...WS_VERBS.map((v) => `Bash(ws ${v}:*)`), 'Read(**)', 'Glob(**)', 'Grep(**)', ...READ_ONLY_BASH, ...cfg.commands.filter((c) => c.mode === 'allow').map((c) => c.pattern)];
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
