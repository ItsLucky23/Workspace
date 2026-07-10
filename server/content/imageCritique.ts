//? F5 — AI image critique ("what should change about this photo"). A MULTIMODAL model (Gemini, via the
//? provider abstraction) looks at the ACTUAL pixels of an uploaded/generated image asset and returns concrete,
//? actionable improvement suggestions + which existing EDIT op each maps to (inpaint / adjust / regenerate).
//? It NEVER edits the asset — it only advises (the user then runs an edit op). Degrades to an honest stub
//? without a vision key. Pure prompt-builder + a thin service; the Conductor calls it (B-23).

import type { PrismaClient } from '@prisma/client';

import { runAiCompletion } from '../ai/registry';

export interface CritiqueResult { ok: boolean; critique: string; stub: boolean; error?: string }

//? The critique system prompt — asks for a short, concrete, prioritized list + the edit each maps to.
export function buildCritiquePrompt(userNote?: string): string {
  return [
    'You are an art director reviewing a single image. Look at the ACTUAL image provided and give concrete, specific, PRIORITIZED feedback on what to improve — composition, lighting, colour, subject, distractions, crop.',
    'For each point, name the ONE edit that fixes it, using exactly one of these edit ops: [inpaint] (mask + replace a region), [adjust] (brightness/contrast/saturation/filter), [crop], [regenerate] (re-generate with a tweak).',
    'Be brief: 3–6 bullet points, each "• <problem> → [<op>] <how>". No preamble, no praise-padding.',
    ...(userNote && userNote.trim().length > 0 ? [`The user specifically asks: ${userNote.trim()}`] : []),
  ].join('\n');
}

//? A deterministic honest stub when no vision provider is configured (mirrors the media stubs).
function stubCritique(): string {
  return '• (no vision key configured — connect a Gemini key to get real feedback)\n• Meanwhile you can still [adjust] colour/contrast or [crop] manually in the editor.';
}

//? Critique the image at `imageUrl` for `workspaceId`. Returns the critique text (or an honest stub).
export async function critiqueImage(
  prisma: PrismaClient,
  args: { workspaceId: string; imageUrl: string; userNote?: string },
): Promise<CritiqueResult> {
  void prisma; // reserved for future per-workspace context; kept for a uniform service signature
  if (!args.imageUrl || args.imageUrl.startsWith('stub://')) return { ok: false, critique: '', stub: true, error: 'critique.noImage' };
  const res = await runAiCompletion('image-critique', {
    prompt: 'Critique this image and list what to improve.',
    system: buildCritiquePrompt(args.userNote),
    imageUrls: [args.imageUrl],
    workspaceId: args.workspaceId,
    label: 'Image critique',
    timeoutMs: 60_000,
  });
  if (!res.ok) return { ok: true, critique: stubCritique(), stub: true };
  const text = res.text.trim();
  if (text.length === 0) return { ok: true, critique: stubCritique(), stub: true };
  return { ok: true, critique: text, stub: false };
}
