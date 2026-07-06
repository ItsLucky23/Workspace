//? Built-in CI — `.workspaces/ci.yml` parser (ADR 0039, C1). Turns the deterministic YAML config into a
//? typed job DAG (BUILTIN_CI_PIPELINES §2), NOT loosely-interpreted shell. Pure + total: a malformed or
//? empty config yields `{ ok:false }` (never throws), so a bad ci.yml surfaces as a config error rather
//? than crashing a run. A DEP-FREE parser for the documented subset (top-level `version`/`stages`/`jobs`
//? with 2-space job names + 4-space fields; arrays inline `[a, "b"]`) — no js-yaml (no types, and a
//? transitive dep is a boot-crash risk). Anything outside the documented shape is ignored, not guessed.

export interface CiJob { name: string; stage: string; script: string[]; needs: string[]; image: string; allowFailure: boolean }
export interface CiSpec { version: number; stages: string[]; jobs: CiJob[] }
export type ParseResult = { ok: true; spec: CiSpec } | { ok: false; error: string };

//? Parse an inline YAML array `[a, "b", 'c']` → string[]. Non-arrays → [].
function inlineArray(v: string): string[] {
  const t = v.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return [];
  return t.slice(1, -1).split(',').map((s) => s.trim().replaceAll(/^['"]|['"]$/g, '')).filter((s) => s.length > 0);
}

//? The indentation (leading spaces) of a line.
const indentOf = (line: string): number => line.length - line.trimStart().length;
//? Split `key: value` at the FIRST colon; value may be empty (a block-opening key).
function kv(line: string): { key: string; value: string } {
  const trimmed = line.trim();
  const i = trimmed.indexOf(':');
  if (i === -1) return { key: trimmed, value: '' };
  return { key: trimmed.slice(0, i).trim(), value: trimmed.slice(i + 1).trim() };
}

//? Parse `.workspaces/ci.yml` → a typed job DAG. `stages` orders the phases; `needs` are the DAG edges;
//? `image` 'project' (default) resolves to the L2 tag. Comments (`#`) and blank lines are ignored.
export function parseCiYaml(body: string): ParseResult {
  const lines = body.split('\n').filter((l) => l.trim().length > 0 && !l.trimStart().startsWith('#'));
  if (lines.length === 0) return { ok: false, error: 'ci.empty' };

  let version = 1;
  let stages: string[] = [];
  const jobs: CiJob[] = [];

  //? Two-pass-ish single scan: top-level keys at indent 0; the `jobs:` block holds 2-space job names,
  //? each with 4-space fields. We walk the jobs block when we hit `jobs:`.
  let inJobs = false;
  let current: Partial<CiJob> & { name?: string } = {};
  const flush = (): void => {
    if (current.name && (current.script?.length ?? 0) > 0) {
      jobs.push({ name: current.name, stage: current.stage ?? (stages[0] ?? 'test'), script: current.script ?? [], needs: current.needs ?? [], image: current.image ?? 'project', allowFailure: current.allowFailure ?? false });
    }
    current = {};
  };

  for (const line of lines) {
    const indent = indentOf(line);
    const { key, value } = kv(line);
    if (indent === 0) {
      inJobs = false;
      flush();
      switch (key) {
      case 'version': {
      version = Number(value) || 1;
      break;
      }
      case 'stages': {
      stages = inlineArray(value);
      break;
      }
      case 'jobs': { {
      inJobs = true;
      // No default
      }
      break;
      }
      }
      continue;
    }
    if (!inJobs) continue;
    if (indent === 2) {                                   // a job name (its value is empty; fields follow)
      flush();
      current = { name: key };
    } else if (indent >= 4 && current.name) {             // a job field
      switch (key) {
      case 'stage': {
      current.stage = value.replaceAll(/^['"]|['"]$/g, '');
      break;
      }
      case 'image': {
      current.image = value.replaceAll(/^['"]|['"]$/g, '');
      break;
      }
      case 'script': {
      current.script = inlineArray(value);
      break;
      }
      case 'needs': {
      current.needs = inlineArray(value);
      break;
      }
      case 'allowFailure': { {
      current.allowFailure = value.trim() === 'true';
      // No default
      }
      break;
      }
      }
    }
  }
  flush();

  if (stages.length === 0) return { ok: false, error: 'ci.noStages' };
  const runnable = jobs.filter((j) => stages.includes(j.stage) && j.script.length > 0);
  if (runnable.length === 0) return { ok: false, error: 'ci.noRunnableJobs' };
  return { ok: true, spec: { version, stages, jobs: runnable } };
}

//? A stable content fingerprint of the spec (job names + scripts + order) — the `Pipeline.specHash` for
//? reuse/invalidation. Not a crypto hash; a deterministic fingerprint of the parsed shape.
export function specFingerprint(spec: CiSpec): string {
  const parts = [`v${String(spec.version)}`, spec.stages.join(','), ...spec.jobs.map((j) => `${j.name}:${j.stage}:${j.script.join('|')}:${j.needs.join('+')}`)];
  let h = 0;
  const s = parts.join(';');
  for (const ch of s) { h = Math.trunc(Math.imul(31, h) + (ch.codePointAt(0) ?? 0)); }
  return (h >>> 0).toString(16);
}
