//? U1 — the ONE canonical UI-review problem taxonomy, shared by the designer form (checkboxes)
//? AND the server-side validator (server/ui/uiReview.ts). The client and server previously each
//? carried their own diverging list, so every ticked problem was silently sanitized to [] — this
//? file is the single source of truth both sides import (regression test: uiReviewTaxonomy.test).
//? Stable keys — the UI localizes labels via `workspaces.uiReview.problem_<key with _>`.

export const UI_PROBLEMS = [
  'cluttered',         // too busy / too much on one page
  'confusing',         // unclear what to do
  'not-responsive',    // breaks on small screens
  'spacing-alignment', // spacing / alignment off
  'color-contrast',    // color usage / contrast
  'inconsistent',      // inconsistent controls between pages
  'visual-hierarchy',  // no clear visual hierarchy
] as const;
export type UiProblem = (typeof UI_PROBLEMS)[number];

//? The i18n suffix for a problem key (dashes → underscores, matching the locale key style).
export function uiProblemI18nKey(p: UiProblem): string {
  return `problem_${p.replaceAll('-', '_')}`;
}
