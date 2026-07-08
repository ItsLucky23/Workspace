# Product capabilities — Q&A (product self-knowledge source)

> Hand-curated, plain-language answers to "what can this product do, and how". This is the authoritative
> capability source the in-app Workspace-AI retrieves from (Q-fase, `AI_LIBRARIES_ACCOUNTS_PROGRAM.md`) so it
> can answer "can we edit videos?" with "yes — via the media module: first generate/upload a video, then use
> the timeline editor". Each `### Q:` block becomes one retrievable chunk. Keep answers concrete: name the
> module + the exact steps + the relevant UI. Update this file when a capability changes; `npm run
> ai:product-knowledge` recompiles the corpus.

## Media & content module (video, image, audio)

### Q: Can I edit videos in this product?
Yes — in the **media/content module**. A video is a "content piece". First you need a video to edit: either
generate one with AI (from a brief → script → scenes) or import/upload your own clips. Then open the piece and
use the **Video timeline editor**: reorder/trim scenes, change transitions (cut/fade/crossfade), split or
delete a scene, refine a selected time-range with AI, and balance the **audio track** (voiceover + music
volume/duck) with a live waveform. Steps: open a content piece → "Timeline editor" → edit → Save.

### Q: Can I make a video with AI from just an idea/topic?
Yes. In the content module, create a piece from a **brief** (a plain-language topic). The pipeline chains:
generate a **script** (beats) → **voiceover** (ElevenLabs) → **visuals** (per scene: AI video-gen via fal, or
images for a slideshow) → **assemble** into a real `.mp4` with ffmpeg. You approve cost/gates along the way
(the human accepts; the Conductor executes — single-writer). Without provider keys it still runs on
valid-shaped stubs so you can rehearse the flow.

### Q: Can I edit images?
Yes — the **image editor** in the media module (open an image asset on a content piece). It does brightness/
contrast/saturation, one-tap look filters (grayscale/sepia), a draggable text overlay, **crop + resize** to a
preset, and a **side-by-side compare** (original vs edited). The edit is exported as a NEW image asset
(non-destructive — the original stays).

### Q: Can I make longer videos (e.g. several minutes)?
Yes, via **scene decomposition**: the idea is split into N scenes that flow into each other (continuity
prompts), one AI-generated clip per scene, stitched with transitions. Video length ≈ number of scenes × per-
scene duration; the media budget is the practical cap. A duration target ("short / long") plans the number of
beats/scenes.

### Q: Can I refine just one part of a video (e.g. seconds 13–18)?
Yes — in the timeline editor, select a time-range and "Refine selection" with an instruction; only the covered
scene(s) are regenerated as a new version (the rest is untouched).

### Q: Can I add or balance audio (voiceover + background music)?
Yes — the timeline editor has an **audio track**: it shows a waveform for the voiceover and the music, with a
**voice-volume** slider and a **music-duck** slider. The saved mix is applied when the video is rendered
(voice + ducked music mixed into one track).

### Q: Can I generate a voiceover / music / sound effects?
Yes — voiceover and SFX via **ElevenLabs**, music via **Suno**, all through the media providers. They attach
to a content piece as assets and feed the render.

### Q: Can I publish a video to YouTube or TikTok?
Yes — connect the platform account first (content settings → connect), then on a finished (non-stub) render
click Publish and pick the platform. YouTube uses a resumable byte-upload; TikTok uses async status polling. A
publish only lands as "done" when the account is really connected; otherwise it is honestly marked as a stub.

## Design & Studio module

### Q: Can I design a UI theme / pick a style?
Yes — the **Designer module**. It has themes (colour palette, light+dark), styles (component language: radius/
shadow/fonts/density/motion — e.g. Apple, Material, Glassmorphic), animations, and typography. You can AI-
generate a theme/style from a brief, preview it live, pick from premade catalog entries, and "Use in project"
to apply it (it becomes the design-system context the coding agent follows).

### Q: Can I upload or customize my own theme/style?
Yes — duplicate a premade or generated theme, rename + edit its tokens, delete your own (premades are read-
only), and import/export a theme as JSON. Changes persist to your workspace.

## Dev-orchestration module (software projects)

### Q: Can I build software / a new project?
Yes — the **dev module**. Create a project (link an existing git repo, or **greenfield** from a stack
template which initialises a real repo with a runnable seed file-tree). Tickets move across an AI pipeline
(refine → plan → implement → test → review); the code-writing agent runs in a Docker container. You approve;
the Conductor executes.

### Q: Can I preview or deploy my app?
Yes — a per-ticket preview container, and persistent environments (dev/staging/prod). A **demo** environment
serves `main` at a stable URL and can auto-redeploy when main moves; a **prod build-export** produces a real
build tarball + fires a deploy-hook to an external server.

### Q: Can the AI ask me questions while working?
Yes — a stage can park on a **needs-input** question that surfaces as a structured approve/reject/choice card
(phone-usable). You answer; the parked turn resumes with your answer.

## Workspace-AI (the assistant)

### Q: What can the Workspace-AI assistant do?
It proposes actions from a plain-language request — create a ticket, create a content piece, move/assign
tickets, add a comment, or a multi-step plan — as a **proposal you accept** (it never writes state directly;
the Conductor is the single writer). It grounds on the workspace snapshot + your linked code (RAG) + (Q-fase)
the product's own capabilities.

### Q: Does the AI know my codebase / uploaded media?
Yes — the linked repo is indexed for retrieval (RAG), so the coding agent + the assistant ground on the actual
code; uploaded media becomes content assets the pipeline uses.

## Sources / knowledge / RAG

### Q: Can I give the AI extra context or docs?
Yes — add **Sources** (context-docs, per-channel brand voice); they're indexed and injected into the relevant
AI stages. The repo is indexed on merge; you can re-scan the index.

## Accounts & channels

### Q: Can I manage multiple social accounts / channels?
Channels carry a platform + brand voice; a content piece bound to a channel grounds its generation on that
channel's brand. Connecting and routing publishes to a specific account is what the account-management surface
provides.
