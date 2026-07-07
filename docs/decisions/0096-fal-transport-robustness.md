---
title: The fal transport gets a per-fetch timeout + a clean poll-timeout; triposr's blocker is fal queue congestion
status: accepted
date: 2026-07-07
tags: [media, providers, fal, robustness]
---

## Context

Trying to get `model-3d` (fal `triposr`) working live surfaced two real defects and one environmental
truth:

1. **The fal queue fetches had no timeout.** A stalled connection hung a whole generation *forever* — a
   live model-3d probe ran >15 min with no progress and had to be killed.
2. **On poll-timeout the loop fell through** to fetch the response URL anyway, which returns the
   confusing "Request is still in progress" **400** instead of a clear timeout error.
3. **triposr's real blocker is fal-side QUEUE CONGESTION, not our poll budget.** A controlled diagnostic
   showed the job stuck at `queue_position: 8` and *not moving* over a minute — so bumping `FAL_POLL_MAX`
   (the user's hypothesis) does not help while the queue is backed up.

## Decision

- **`falFetch`** wraps every fal fetch (submit + status poll + result) in an `AbortController` with a hard
  `FAL_FETCH_TIMEOUT_MS` (default 30s) — a hung connection now aborts instead of blocking indefinitely.
- **Clean poll-timeout:** the poll loop tracks completion and throws `fal poll timeout` when the budget is
  exhausted, instead of fetching an incomplete result (the misleading 400).
- **`FAL_POLL_MAX` default raised 60 → 120** (× 2s = 4 min) so a slow-but-*moving* queue still completes;
  `FAL_MODEL_3D` remains an env override for a faster/less-congested 3D model.

## Rejected alternatives

- **Just raise `FAL_POLL_MAX` a lot.** The diagnostic proves the queue wasn't draining — a bigger poll
  budget alone burns minutes (and money on the input image) without completing. The timeout + clean-error
  is the real robustness win; the poll bump only helps when the queue actually moves.
- **Swap triposr for another 3D model by default.** A different model (trellis / hyper3d) has a different
  input/output shape; changing it blind (no browser/docs to verify) risks breaking the working stub path.
  Left as an `FAL_MODEL_3D` override + a documented recommendation.
- **Retry the whole generation on timeout.** Re-submitting to a congested queue just re-queues and doubles
  the spend; a clean typed timeout that the caller/stub-fallback handles is better.

## Consequences

- No fal generation can hang forever anymore; a stuck job fails cleanly and fast. `model-3d` stays a
  best-effort leg in the live suite (its completion depends on fal queue availability, outside our code).
- **Flagged to the user (Rule 3b):** getting triposr green is a fal-account/queue matter, not a poll-tuning
  one — try again when the model's queue is quieter, or set `FAL_MODEL_3D` to a faster 3D endpoint. The
  other 7 media features + all 15 AI-text features are proven live.
