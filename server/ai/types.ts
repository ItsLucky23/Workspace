//? The pluggable AI-provider layer (project rule: ai-provider-abstraction). EVERY AI
//? feature resolves to a provider at dispatch time via the registry, so no feature ever
//? hardcodes a single AI backend — swapping Claude↔Gemini↔… for a feature is a config
//? change, not a code change. This file is the shared contract; the standalone handlers
//? live in ./providers, the feature→provider assignment in ./assignments, dispatch in
//? ./registry.

//? A concrete AI backend. Add one = a new handler in ./providers + a case in the registry.
export type AiProviderId = 'claude-cli' | 'gemini-api';

//? The distinct AI-integration points. Each resolves to a provider independently; adding
//? a feature = one key here + a default in ./assignments. `pipeline-agent` is the
//? long-running in-container coding agent (a session/stream shape layered on later); the
//? rest are one-shot completions.
export type AiFeature =
  | 'workspace-chat'
  | 'docs-generate'
  | 'dockerfile-generate'
  | 'pipeline-agent'
  | 'conflict-resolve'
  //? Studio module (design + marketing). Two non-coding roles, each resolves to a provider
  //? independently (so a design task can run on a different backend than a copy task).
  | 'studio-designer'
  | 'studio-marketer'
  //? Designer module — generates a full design THEME (a light+dark set of the 30 --color-* tokens)
  //? from a plain-language brief. Non-coding structured-JSON generation.
  | 'designer-theme'
  //? Designer — generate a visual STYLE (radius/shadow/typography/motion) or an ANIMATION from a brief.
  | 'designer-style'
  | 'designer-animation'
  //? Interviewer — reasons over the project and proposes concrete improvement ideas (schedulable as
  //? an agent role). Non-coding one-shot completion.
  | 'interviewer'
  //? Web scraper (Marketing reach) — summarises a fetched page for outreach. Schedulable role.
  | 'scraper'
  //? AI MR-review (ADR 0041) — reads an MR diff (RAG-grounded) + proposes line-anchored review
  //? findings a human accepts to post as `ReviewComment(authorKind:'ai')`. Never approves/merges.
  | 'mr-review'
  //? AI root-cause / rollback (ADR 0042) — given a symptom + recent merges, ranks the likely-culprit
  //? merge + explains → a `WorkspaceSuggestion(type:'rollback')`. Never reverts directly (B-23).
  | 'root-cause';

export interface AiCompletionRequest {
  prompt: string;
  system?: string;   //? optional system/context preamble
  cwd?: string;      //? working dir the AI runs in (e.g. a ticket worktree)
  timeoutMs?: number; //? hard cap for the turn (provider default when omitted)
  //? Optional tagging so the run shows up in the workspace's central AI-activity feed (the
  //? "Activity" tab of the Workspace-AI panel). No tenancy is enforced here — it's a display tag.
  workspaceId?: string;
  label?: string;    //? human label for the feed (e.g. "Theme: warm fintech")
}

export interface AiCompletionResult {
  ok: boolean;
  text: string;         //? the assistant's final message (empty on error)
  providerId: AiProviderId;
  error?: string;       //? errorCode when ok=false
}

//? A standalone handler for one AI backend. `available` gates dispatch (claude installed
//? + logged in / gemini key present); `complete` runs a single turn and returns the
//? final assistant message. Streaming/session handlers (the in-container pipeline agent)
//? extend this contract when that runtime lands — not built speculatively here.
export interface AiProvider {
  id: AiProviderId;
  label: string;
  available: () => Promise<boolean>;
  complete: (req: AiCompletionRequest) => Promise<AiCompletionResult>;
}
