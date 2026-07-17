//? Model-selection wiring — resolves a stage's `modelCfg` (base choice + auto-escalate rules)
//? into the concrete { model, effort, maxTurns } for ONE turn, and maps that choice onto the
//? claude CLI surface (`--model` spawn flag + MAX_THINKING_TOKENS settings env). The score is
//? the task-complexity score (1–10) the agent assigned ITSELF in the previous stage's
//? ws-carryover (`complexityScore`) — no score (first stage / omitted) ⇒ the base choice.
//? Pure + unit-testable; stageRunner is the only runtime caller.

import type { StageEffort, StageModelCfg, StageModelChoice } from '../../src/workspaces/_data/types';

//? "score ≥ minScore → this model/effort/maxTurns" — the HIGHEST satisfied minScore wins.
export function resolveModelChoice(cfg: StageModelCfg, score: number | null): StageModelChoice {
  if (!cfg.autoEscalate || score === null) return cfg.base;
  const hit = cfg.rules
    .filter((r) => score >= r.minScore)
    .toSorted((a, b) => b.minScore - a.minScore)[0];
  return hit ? { model: hit.model, effort: hit.effort, maxTurns: hit.maxTurns } : cfg.base;
}

//? StageEffort → the CLI extended-thinking budget (MAX_THINKING_TOKENS). 'low' keeps a minimal
//? budget rather than 0 so a genuinely-hard step can still think briefly.
const EFFORT_THINKING_TOKENS: Record<StageEffort, number> = {
  low: 1024, medium: 8192, high: 16_384, xhigh: 31_999, max: 63_999,
};
export function effortThinkingTokens(effort: StageEffort): number {
  return EFFORT_THINKING_TOKENS[effort];
}

//? The claude-CLI argv for one in-container turn (after the `claude` binary itself). Exported
//? pure so the spawn-args are testable without a PTY/container.
export function buildTurnArgs(opts: { resumeSessionId?: string; model?: string } = {}): string[] {
  return [
    ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
    ...(opts.model ? ['--model', opts.model] : []),
    '--permission-mode', 'bypassPermissions',
    '--settings', '/work/.claude/settings.json',
    '--append-system-prompt-file', '/work/.claude/stage-instructions.txt',
  ];
}
