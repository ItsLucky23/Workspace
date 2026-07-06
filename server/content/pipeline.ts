//? The generic content-pipeline (F1.1, ADR 0049). A content piece (ContentProject) flows through a FIXED
//? ordered stage sequence — the content-lane analog of the dev board's PipelineStages. The per-stage
//? generation (script → voice → images → assembly) wires into these stages in F1.2–F1.5. The Conductor is
//? the only writer of `ContentProject.stageId`/`status` (B-23); control-ops drive the transitions.

//? The ordered content stages. `idea` → a brief; `script` → narration + beats; `generate` → per-beat
//? media; `assemble` → the Remotion render; `review` → human check; `publish` → the platform post (gated).
export const CONTENT_STAGES = ['idea', 'script', 'generate', 'assemble', 'review', 'publish'] as const;
export type ContentStage = (typeof CONTENT_STAGES)[number];

//? The next stage after `current`, or null at the end. Unknown stage → the first stage (defensive).
export function nextContentStage(current: string): ContentStage | null {
  const i = (CONTENT_STAGES as readonly string[]).indexOf(current);
  if (i === -1) return CONTENT_STAGES[0];
  return i + 1 < CONTENT_STAGES.length ? CONTENT_STAGES[i + 1] ?? null : null;
}

//? Is `stage` a valid content stage?
export function isContentStage(stage: string): stage is ContentStage {
  return (CONTENT_STAGES as readonly string[]).includes(stage);
}
