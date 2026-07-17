//? U1 — the "unfuck the UI" review intake. A user uploads screenshots (K1 upload) of a page/flow, ticks what's
//? wrong from a fixed TAXONOMY, and adds free-text; the request is persisted tenant-scoped. U2 (follow-up) turns
//? an accepted request into N redesign variants → a ticket with the chosen design + the ticked problems as stage
//? instructions. This module is the pure taxonomy + the request validation; the Conductor persists it (B-23).

//? The curated problem taxonomy (the checkboxes) lives in ONE shared module the designer form
//? imports too — re-exported here so server-side consumers keep their import path. U2 folds the
//? ticked ones into the redesign brief. Free-text (`notes`) covers anything off-list.
import { UI_PROBLEMS, type UiProblem } from '../../src/workspaces/_data/uiReviewTaxonomy';

export { UI_PROBLEMS, type UiProblem } from '../../src/workspaces/_data/uiReviewTaxonomy';

export function isUiProblem(s: string): s is UiProblem {
  return (UI_PROBLEMS as readonly string[]).includes(s);
}

//? Keep only valid taxonomy keys (dedup), dropping anything off-list — a client can't inject arbitrary problem tags.
export function sanitizeProblems(raw: unknown): UiProblem[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<UiProblem>();
  for (const p of raw) if (typeof p === 'string' && isUiProblem(p)) out.add(p);
  return [...out];
}

//? Keep only `/media/…` screenshot urls (uploaded via K1) — never an arbitrary external url.
export function sanitizeScreenshots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.startsWith('/media/')).slice(0, 20);
}
