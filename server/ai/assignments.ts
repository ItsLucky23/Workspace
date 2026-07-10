//? Feature → provider assignment (project rule: ai-provider-abstraction). The single
//? place that decides which AI backend runs each feature. V1 is a global default map;
//? the seam below (`resolveAssignment`) is where a per-workspace / user-chosen override
//? plugs in later (a DB setting surfaced in the UI) WITHOUT touching any feature code.

import type { AiFeature, AiProviderId } from './types';

//? Sensible defaults: the pipeline/coding + chat work goes to the Claude CLI (the
//? subscription-billed PTY the P0.5 spike proved); everything is overridable per feature.
const DEFAULT_ASSIGNMENTS: Record<AiFeature, AiProviderId> = {
  'workspace-chat': 'claude-cli',
  'docs-generate': 'claude-cli',
  'dockerfile-generate': 'claude-cli',
  'pipeline-agent': 'claude-cli',
  'conflict-resolve': 'claude-cli',
  //? Studio is non-coding one-shot generation — default to the always-available Claude CLI,
  //? overridable to gemini-api (faster/cheaper for bulk text) once the picker UI exists.
  'studio-designer': 'claude-cli',
  'studio-marketer': 'claude-cli',
  //? Designer theme generation is short structured JSON — always-available Claude CLI default,
  //? overridable to gemini-api (a good fit for cheap fast JSON) once the picker UI exists.
  'designer-theme': 'claude-cli',
  'designer-style': 'claude-cli',
  'designer-animation': 'claude-cli',
  //? Interviewer reasoning — default to the always-available Claude CLI, overridable per workspace.
  'interviewer': 'claude-cli',
  //? Web-scrape summarisation — always-available Claude CLI default, overridable.
  'scraper': 'claude-cli',
  //? AI MR-review reasoning — always-available Claude CLI default, overridable per workspace.
  'mr-review': 'claude-cli',
  //? AI root-cause / rollback reasoning — always-available Claude CLI default, overridable.
  'root-cause': 'claude-cli',
  //? Plan-critique reasoning — always-available Claude CLI default, overridable per workspace.
  'plan-critique': 'claude-cli',
  //? Reference-video analysis — multimodal video understanding → defaults to Gemini (video-capable).
  'reference-video-analysis': 'gemini-api',
  //? Content script generation — non-coding bulk text → defaults to Gemini (fast/cheap), overridable.
  'script': 'gemini-api',
  //? E5 — user-defined custom AI tasks → always-available Claude CLI default, overridable per workspace (P1).
  'custom-generate': 'claude-cli',
  //? F5 — image critique needs a VISION model → defaults to Gemini (multimodal). Degrades to a stub without a key.
  'image-critique': 'gemini-api',
};

//? Resolve the provider for a feature. `overrides` is the extension seam — pass a
//? (partial) per-workspace assignment map here once the UI/DB feature-picker exists; an
//? unset feature falls back to the global default. Kept pure so it stays trivially testable.
export function resolveAssignment(feature: AiFeature, overrides?: Partial<Record<AiFeature, AiProviderId>>): AiProviderId {
  return overrides?.[feature] ?? DEFAULT_ASSIGNMENTS[feature];
}

//? The full default map (for surfacing the current wiring in a settings UI later).
export function defaultAssignments(): Record<AiFeature, AiProviderId> {
  return { ...DEFAULT_ASSIGNMENTS };
}
