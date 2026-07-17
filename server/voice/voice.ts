/** @docs owner ItsLucky23 */
//? VO (DOCUMENTS_AND_SKILLS) — the voice layer, PROVIDER-ABSTRACTED (project rule ai-provider-
//? abstraction, ADR 0007). Deviates from feature-doc 06 (whisper.cpp-only, STT-only) — see ADR 0275:
//? STT rides the pluggable AI-provider layer (`runAiCompletion('speech-to-text', { audioUrls })` → an
//? audio-capable model, Gemini by default), and TTS output for the Assistant reuses the existing
//? metered media 'tts' feature (ElevenLabs). Both degrade honestly to a stub without a key — never a
//? fabricated transcript / silent-but-claimed audio. The transcript rides the EXISTING text paths
//? (Assistant chat / ticket answer); no new structured-channel verb (invariant #2 holds).
//? @adr 0275

import type { PrismaClient } from '@prisma/client';
import { tryCatch } from '@luckystack/core';

import { runAiCompletion } from '../ai/registry';
import { runMediaGeneration, estimateMediaCostCents  } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';

const STT_SYSTEM = 'You are a speech-to-text transcriber. Output ONLY the verbatim transcript of the audio — no preamble, no commentary, no quotes. If the audio is empty or unintelligible, output an empty string.';

//? Transcribe an uploaded audio clip (a `/media/...` url) to text. Provider-abstracted; honest empty on
//? no key / failure. The caller feeds the transcript into the normal text path (chat / ticket answer).
export async function transcribeAudio(workspaceId: string, audioUrl: string): Promise<{ ok: boolean; text: string; error?: string }> {
  if (!audioUrl.startsWith('/media/')) return { ok: false, text: '', error: 'voice.invalidAudio' };
  const [err, res] = await tryCatch(() => runAiCompletion('speech-to-text', {
    prompt: 'Transcribe this audio clip verbatim.', system: STT_SYSTEM, audioUrls: [audioUrl], workspaceId, label: 'Voice → text', timeoutMs: 120_000,
  }));
  if (err || !res?.ok) return { ok: false, text: '', error: res?.error ?? 'voice.sttFailed' };
  //? Strip accidental surrounding quotes/whitespace a model sometimes adds.
  const text = res.text.trim().replaceAll(/^["'`]|["'`]$/g, '').trim();
  return { ok: true, text };
}

//? Synthesize speech from text (the Assistant "speak replies" opt-in) via the metered media 'tts'
//? feature. Budget-guarded + spend-recorded like every media gen; honest stub without an ElevenLabs key.
export async function synthesizeSpeech(prisma: PrismaClient, workspaceId: string, text: string): Promise<{ ok: boolean; url?: string; stub?: boolean; error?: string }> {
  const clean = text.trim().slice(0, 2000);
  if (clean.length === 0) return { ok: false, error: 'voice.emptyText' };
  const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents('tts'));
  if (!budget.ok) return { ok: false, error: 'voice.budgetExceeded' };
  const res = await runMediaGeneration({ feature: 'tts', prompt: clean, workspaceId, label: 'Assistant voice' });
  if (!res.ok || !res.asset) return { ok: false, error: 'voice.ttsFailed' };
  await tryCatch(() => recordMediaSpend(prisma, workspaceId, { feature: 'tts', providerId: res.providerId, costCents: res.costCents }));
  return { ok: true, url: res.asset.url, stub: res.asset.metadata.stub === true };
}
