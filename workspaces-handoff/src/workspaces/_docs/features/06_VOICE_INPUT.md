# 06 — Voice input

> Voice → ticket / voice → answer. Capture audio on a phone or desktop, transcribe it self-hosted, and feed the resulting text into the **existing** text paths. Extends [02 §3] (the `UserPromptSubmit` hook + the HTTP `registerCustomRoute` seam) and [02 §5] (the QuestionSet free-text answer path). Falls back to typing whenever the mic is unavailable. Reaches into [09](./09_QUESTIONS_IN_TICKETS.md) as the free-text answer fallback and [11](./11_WORKSPACE_AI_PANEL.md) when targeting the Assistant.

---

## Scope

> **BUILD DEFERRED (late tier)** — per **D5**, this feature is fully designed here but **not built in v1**. The build slots in last (the IDEE_SPEC §15 build order puts voice at step 7, after the board, Workspace-AI, and realtime/presence land). This doc is the buildable spec for that later pass; nothing below should block earlier work.

**In**
- A capture surface: the mobile FAB long-press (`MobileBottomBar`'s floating `+`) and a TopBar mic affordance on desktop.
- Record → live waveform + elapsed timer → stop, with a hard **max clip length** cap.
- **Streaming upload** of the audio over a dedicated `registerCustomRoute` handler (raw `req`/`res`), bypassing the 1 MiB JSON body-cap.
- Self-hosted **whisper.cpp** transcription (B-O1), running in a container with **no audio egress**.
- An **editable transcript-review** step before anything is sent.
- Three **send-to targets**: (1) create a ticket, (2) reply to a specific ticket's Stage-Agent, (3) message the Workspace-AI (Assistant).
- A full state machine: `idle → recording → transcribing → review → sending → error`, with an **offline/permission fallback to plain text entry**.

**Out**
- Any new structured-channel verb. Voice produces *text*; the text then rides the verbs and surfaces that already exist.
- Streaming / partial transcription, speaker diarization, wake-words, voice *output* (TTS). One clip → one transcript → one send.
- A new persisted model. The transcript rides an existing `TicketEvent`.
- Cloud STT. Self-hosted whisper.cpp only (B-O1) — audio never leaves the host.

**Deferred**
- The entire build (D5). Also: multi-language model selection and live captioning are explicitly out of the first build.

---

## User flow

### Mobile (primary — this is the phone-from-the-beach surface)

1. **Enter capture.** Long-press the bottom-bar FAB (the `+` in `MobileBottomBar`) — short-tap keeps its current quick-create behavior, long-press opens the **VoiceCapture bottom-sheet** (overlay P21). A mic affordance in the compact TopBar opens the same sheet.
2. **`recording`.** A big record button, a live **waveform**, and an **elapsed timer** counting up to the max-clip cap. A subtle ring fills toward the cap; at the cap, recording auto-stops and transitions straight to `transcribing`.
3. **Stop → `transcribing`.** On stop, the clip **streams up** while a spinner reads "Transcribing…". (Upload and transcription are presented as one wait; the clip can begin uploading as it finalizes.)
4. **`review`.** The whisper.cpp transcript lands in an **editable textarea** — the user fixes mishears before sending. Below it, a **"Send to"** picker (`Dropdown`) with three targets:
   - **Create ticket** — opens the same New-ticket path with the transcript prefilled as the description (title derived from the first line / left editable).
   - **Reply to `DEV-####`'s agent** — the transcript becomes the user's next answer/prompt to that ticket's Stage-Agent (see Verbs below).
   - **Workspace-AI** — the transcript is sent as a chat message to the Assistant ([11]).
5. **`sending` → toast.** Confirmation toast (`i18nNotify`); the sheet closes. For the "create ticket" target the new ticket opens; for the agent/Assistant targets the relevant ticket/chat is focused.

```
┌─ Voice note ───────────────┐    ┌─ Review ───────────────────┐
│        ◉  0:08              │    │ "Create a ticket: avatar    │
│   ▁▃▅█▆▄▂▁▃▅█▆▄▂  (live)    │ →  │  still flickers on 3G, like │
│        ● Stop              │    │  twelve-forty"  [editable]  │
│   max 2:00 · tap to cancel │    │ Send to: [ Create ticket ▾ ]│
└────────────────────────────┘    │        [Cancel]  [Send →]   │
                                   └────────────────────────────┘
```

### Desktop

Same flow in a smaller mic-popover anchored to the TopBar mic button (not a bottom-sheet). Identical states, identical "Send to" targets. Keyboard: Esc cancels, Enter (in review) sends.

### Mockup hints / states

- **`idle`** — just the mic affordance.
- **`recording`** — waveform + timer + Stop; cancel discards with no upload.
- **`transcribing`** — spinner; the audio is uploading/transcoding.
- **`review`** — editable transcript + target picker; this is the only place the user can correct text.
- **`sending`** — disabled buttons, inline spinner on Send.
- **`error`** — mic-permission denied, STT failure, or upload failure → a friendly message **and the offline fallback**: the same sheet collapses to a plain `<textarea>` ("Type it instead"), so the user always has a path. The typed text uses the exact same three "Send to" targets.

---

## Data

No new model. The transcript rides the **existing** `TicketEvent` event-log row (04 / [02 §3]) via the `UserPromptSubmit` hook, with one optional metadata field:

| Field | Type | On / extends | Validation |
|---|---|---|---|
| `TicketEvent.metadata.voiceTranscript?` | `string` (within the existing `TicketEvent.metadata` JSON) | `TicketEvent` | optional; present only when the prompt originated from voice; trimmed; capped to the same length as a typed prompt. The audio blob itself is **not** persisted past transcription. |

- The "create ticket" target reuses the normal ticket-create input (title + `description`); the transcript fills `description`. No voice-specific ticket fields.
- The "reply to agent" target produces a `UserPromptSubmit`-sourced `TicketEvent` whose `metadata.voiceTranscript` carries the original spoken text for audit, while the prompt body is what's fed to the agent — they are identical unless the user edited the transcript in `review`.
- The "Workspace-AI" target produces a normal `ChatMessage` (role `'user'`); the transcript is the `text`. (Voice does not introduce `ChatMessage` fields — [09] owns `ChatMessage.questionSetId`.)

**INDEX delta:** TicketEvent.metadata.voiceTranscript?

---

## Verbs / Events / Hooks

**No new verbs.** Voice is a *capture-and-transcribe front-end* that drops text onto paths that already exist:

- **Upload transport** — a dedicated **`registerCustomRoute`** handler in the `pre-params` phase (the same streaming seam the webhook/upload work uses — [02 §3], IDEE_SPEC §7). It reads raw `req`/`res`, does **manual auth** (`extractTokenFromRequest` + `getSession`), streams the audio body to disk (or a tmp volume) and thereby **bypasses the 1 MiB body-cap** that the `_api` base64 path would hit. This is plumbing, not a structured-channel verb.
- **Transcription** — the handler shells whisper.cpp (allow-listed `run-command`, never raw shell) inside its container; returns the transcript JSON to the client for the `review` step.
- **`UserPromptSubmit` hook** [02 §3] — when the transcript is sent to a ticket's Stage-Agent, it lands as the user's prompt and the hook logs it as a `TicketEvent` carrying `metadata.voiceTranscript`. The agent resumes exactly as it would for a typed answer (`--resume`), so this is the **same** resume path described in [02 §1].
- **QuestionSet free-text** [02 §5] — if the agent is in `needs-input` with an **open `QuestionSet`**, a voice reply targeting that ticket is the **free-text answer** for the first `kind:'free'` question; the Conductor stamps the answer and resumes. This is the [06]→[09] fallback edge in the dependency graph. (Voice never answers a `choice`/`approve` question — those are one-tap, see [09].)
- **Assistant** target — sends a `ChatMessage`; the Assistant's existing read/propose verbs ([02 §2]) apply unchanged.

No Conductor write path changes: the user is still pulling exactly the three levers from [02 §1] (answer / promote / pause), just dictated instead of typed. B-23 holds — voice gives an LLM no new write capability.

---

## UI

**Reused (real components):**
- `MobileBottomBar` (`_shell/Shell.tsx`) — its FAB gains a long-press gesture to open capture; short-tap keeps quick-create.
- `MenuHandler` / `menuHandler` — the VoiceCapture surface is a `menuHandler` bottom-sheet on mobile (P21) and a popover on desktop.
- `Dropdown` (`_components` shipped) — the "Send to" target picker.
- `WsButton`, `IconButton` (`_components/primitives`) — Stop / Cancel / Send and the TopBar mic button.
- `EmptyState` / `i18nNotify` — error/permission messaging and the success toast.
- The New-ticket path (Board's `+ Ticket`) — reused verbatim for the "create ticket" target with `description` prefilled.

**New components:**
- **`VoiceCapture`** — the capture body: record button, **live waveform** (Web Audio `AnalyserNode` → canvas), elapsed **timer**, max-clip ring, and the `recording → transcribing → review` internal states. Houses the editable transcript textarea + target picker.

**Mobile parity:** mobile is the *primary* surface (the design brief's toetssteen is literally "spreek wat voice-berichten in" from a phone). Desktop is the smaller-popover sibling. Tap-targets ≥ 44px; the sheet has a grab-handle and swipe-to-dismiss; `prefers-reduced-motion` drops the waveform animation to a static level meter.

---

## Extends

- **[02 §3] `UserPromptSubmit`** — "log the prompt (incl. voice transcript) as a `TicketEvent`." The transcript-as-prompt path is exactly this hook; `metadata.voiceTranscript` is the carrier the architecture already anticipated.
- **[02 §3] hooks/HTTP seam** — the `type:http` hooks "POST to an orchestrator endpoint (`registerCustomRoute`, `pre-params` phase, origin-exempt)"; the streaming upload handler lives on the same custom-route seam, with manual `extractTokenFromRequest` + `getSession` auth.
- **[02 §5] QuestionSet** — "The per-user chat panel is the free-text fallback (the Assistant interprets it into the same answers)." Voice is one more way to produce that free-text answer; on a ticket in `needs-input` it fills the first `kind:'free'` `Question`.
- **[02 §1] resume** — "`needs-input→busy` resumes the **same** agent session via `--resume`." A dictated answer resumes identically to a typed one.
- **[02 §2]** — Assistant verbs are reused unchanged for the Workspace-AI target; no verb is added.

---

## Resolved

1. **06.q1 — Max clip length.** A **single global cap of 2:00** (no per-target variation).
2. **06.q2 — Audio retention.** The audio blob is **deleted immediately after transcription**; kept briefly **only on STT failure** (for re-transcribe), then discarded.
3. **06.q3 — whisper.cpp placement.** **One shared orchestrator-side instance** (not per-ticket container), since audio is short and serial.
4. **06.q4 — Transcript-as-prompt vs. interpret.** The transcript is used **raw as the ticket description in v1** (no Assistant-normalize).
5. **06.q5 — Language.** Language is a **per-workspace setting reserved** for later; **auto-detect is off in the first build**.
