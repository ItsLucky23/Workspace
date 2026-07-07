---
title: Users upload their own image/video (a real /media/upload endpoint) and import it as a first-class asset
status: accepted
date: 2026-07-07
tags: [media, upload, content, http, freedom-program]
---

## Context

FREEDOM_PROGRAM item **K1** — the enabler for bring-your-own-material + the editors. References were
URL-only (paste a hosted url) and there was no way to bring your own image/video into a piece — every asset had
to be AI-generated. The "Upload spec" button was a `noop`. No multipart parser is bundled.

## Decision

- A new authenticated HTTP route `POST /media/upload?ws=<id>&ext=<ext>` (`server/media/uploadRoute.ts`,
  registered in `server.ts` next to the download route). It reads the file as the **raw request body** (no
  multipart dep needed) into a bounded Buffer (64 MB cap), validates the extension against an image/video
  allowlist, and `persistMediaBytes(...)` → returns `{ url: '/media/<uuid>.<ext>', kind }`. Authed via the
  session token + membership-gated (`workTickets`) + tenant-scoped by the `ws` param.
- A reusable `MediaUploadButton` + `uploadMedia()` client helper. The piece page uses it to (a) upload a
  reference for reference-conditioned gen (replacing URL-only), and (b) **import your own** image/video via a
  new `content-import-asset` control-op that creates a `ready` ContentAsset (no MediaJob) on the single-writer
  chain (B-23) and broadcasts the live delta.

## Rejected alternatives

- **Add a multipart parser (busboy/multer).** A new dependency for no gain — a single-file raw-body POST is
  simpler, and the ext/kind travel as query params. Multipart can be added later if multi-file forms need it.
- **Upload straight into a ContentAsset from the HTTP route (architecture A).** Bypasses the Conductor
  single-writer chain. Persisting bytes over HTTP + creating the asset via a control-op keeps every asset write
  on the Conductor like all other `content-*` ops (B-23).
- **Keep URL-only references.** Blocks any user without a hosted url + blocks the editors (which need to load +
  re-save the user's own pixels).

## Consequences

- Users bring their own image/video — as a reference or a first-class imported asset — and it flows through the
  same live delta + snapshot as generated assets. This unblocks the image/video editors (E1–E4), which upload
  the edited result back through the same route.
- Security: the upload route is origin-exempt (works cross-origin in dev + behind the proxy) but authed +
  membership-gated + requires the unguessable workspaceId; the import op rejects any non-`/media/` url. A
  stricter same-origin/CSRF-token variant can harden it later.
