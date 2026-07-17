---
status: accepted
date: 2026-07-17
tags: [voice, ai, provider-abstraction, documents-and-skills]
---

# 0275 — Voice-interface: provider-abstracte STT + TTS-output (afwijking van de whisper-only-spec)

## Context

Feature-doc `06_VOICE_INPUT.md` ontwierp voice als BUILD-DEFERRED: self-hosted whisper.cpp, ALLEEN speech-to-text, geen TTS, met een streaming-upload-custom-route en drie send-to-targets. De user koos in het interview van 2026-07-17: voice bouwen, **provider-pluggable** STT/TTS, phone-first spraak-in voor de Assistant (PWA-mic → STT → bestaand chat-pad) én spraak-uit (TTS op antwoorden, opt-in). Twee botsingen met de oude spec: provider-abstractie-vs-whisper-only, en TTS-output-vs-out-of-scope.

## Decision

STT rijdt op de bestaande AI-provider-abstractie (ADR 0007): nieuwe `AiFeature 'speech-to-text'` + `AiCompletionRequest.audioUrls`; de Gemini-provider hangt audio als `inline_data` aan (net als images voor vision), tekst-only providers negeren het. Default provider = Gemini. TTS-output hergebruikt de bestáánde gemeterde media-`tts`-feature (ElevenLabs) via `synthesizeSpeech` (budget-guard + spend-record). De transcript rijdt de BESTAANDE tekstpaden (Assistant-chat) — géén nieuwe structured-channel-verb (invariant #2), geen write. UI: mic-knop + "speak replies"-toggle in de `AIPanel`-composer; browser `MediaRecorder` → `/media/upload` (audio-exts toegevoegd) → `voiceTranscribe_v1` → draft-prefill; `voiceSynthesize_v1` speelt antwoorden. Honest degrade overal: geen key ⇒ error (STT) of gevlagde stub (TTS), nooit een verzonnen transcript.

## Rejected alternatives

- **Whisper.cpp-only (de oude spec)**: schendt de project-brede provider-abstractie-regel (ADR 0007); dwingt een container + on-host-model als enige optie. De abstractie laat een self-hosted whisper-provider later toe zónder callers te raken.
- **TTS buiten scope laten (de oude spec)**: de user wil expliciet gesproken antwoorden; de media-`tts`-feature bestond al, dus TTS-output is wiring, geen nieuw systeem.
- **De volledige spec bouwen (streaming-upload-custom-route + 3 send-to-targets + waveform + transcript-review)**: te groot voor deze ronde; v1 bedraadt het Assistant-chat-pad (de phone-first-toetssteen). Ticket/agent-targets + review-stap = follow-up; de spec blijft de bouwbron.

## Consequences

- De default-STT stuurt audio naar de geconfigureerde provider (Gemini), niet strikt on-host — een workspace die on-host STT eist, wisselt de provider (de abstractie staat het toe).
- Geen nieuw persistent model: de transcript rijdt bestaande paden; TTS levert een media-asset.
- Send-to-ticket/agent-targets, de streaming-upload-route, de editable transcript-review en de waveform zijn NIET gebouwd — bewuste follow-up; `06_VOICE_INPUT.md` gemarkeerd als "BUILT met deviaties".
- Live bewezen: echte ElevenLabs-TTS → echte Gemini-STT round-trip herstelt de gesproken zin exact.
