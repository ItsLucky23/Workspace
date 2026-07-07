//? Shared media-prompt composition (ADR 0053) — every media provider composes the final text the same
//? way: the resolved StylePreset's system-prompt + the caller's prompt + the user's free-form extra
//? instructions. Pure; used by the fal/elevenlabs/suno adapters so the style/extra contract is uniform.

import type { MediaGenerationRequest } from './types';

export function composeMediaPrompt(req: MediaGenerationRequest): string {
  //? Brand/product context (Q2) grounds the generation FIRST, then style + prompt + extra instructions.
  return [req.brandContext, req.style?.systemPrompt, req.prompt, req.extraInstructions]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('. ');
}
