//? Owner decision 6 — label the central Brand Library with its provenance. StudioBrandLibrary has no
//? `lastSetFrom`/`lastSetAt` field yet — adding one is a server/schema change outside this pass's
//? scope (see sharedGaps) — so this is a best-effort per-browser record keyed by workspace id: it
//? explains provenance on THIS browser, not durably or across teammates.
//?
//? `source` is either the constant 'manual' (translated at read time, so it survives a language
//? switch) or a raw artifact title (already plain text — never a translation key).

const SOURCE_KEY_PREFIX = 'ws.studio.brandProvenance.source.';
const AT_KEY_PREFIX = 'ws.studio.brandProvenance.at.';

export function recordBrandProvenance(workspaceId: string, source: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SOURCE_KEY_PREFIX + workspaceId, source);
  localStorage.setItem(AT_KEY_PREFIX + workspaceId, new Date().toISOString());
}

export function getBrandProvenance(workspaceId: string): { source: string; at: string } | null {
  if (typeof localStorage === 'undefined') return null;
  const source = localStorage.getItem(SOURCE_KEY_PREFIX + workspaceId);
  const at = localStorage.getItem(AT_KEY_PREFIX + workspaceId);
  if (!source || !at) return null;
  return { source, at };
}
