//? I4 bug fix — `refine` is one shared box reused by every Generate AND every card's Regenerate, so
//? a stale value could silently apply to an unrelated older card with nothing recording which refine
//? produced which result. StudioArtifact has no `refine` field yet — adding one is a server/schema
//? change outside this pass's scope (see sharedGaps) — so this is a best-effort per-browser record
//? keyed by artifact id, not server truth: it won't follow the artifact across devices or teammates,
//? but it stops the immediate silent-mismatch bug on the browser that generated it.
//?
//? One key per artifact (no JSON blob) so a read is a plain `localStorage.getItem` — same pattern as
//? src/_components/editor/editorThemes.ts, guarded by a `typeof` check rather than a try/catch.

const KEY_PREFIX = 'ws.studio.refine.';

export function recordArtifactRefine(artifactId: string, refine: string): void {
  if (typeof localStorage === 'undefined' || refine.trim().length === 0) return;
  localStorage.setItem(KEY_PREFIX + artifactId, refine.trim());
}

export function getArtifactRefine(artifactId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(KEY_PREFIX + artifactId);
}
