//? Built-in CI — `.workspaces/ci.yml` / `.gitlab-ci.yml` parser (ADR 0039 C1; C4 depth-program).
//? Turns a real YAML config into a typed job DAG (BUILTIN_CI_PIPELINES §2), NOT loosely-interpreted
//? shell. A DEP-FREE recursive YAML-subset parser (`parseYamlSubset`) — no js-yaml (no types + a
//? transitive dep is a boot-crash risk) — handles the real constructs: block mappings at any
//? consistent indent, block sequences (`- item`), inline flow arrays (`[a, "b"]`), quoted scalars,
//? comments. On top of it `parseCiYaml` accepts BOTH the documented `jobs:`-wrapped shape AND a real
//? `.gitlab-ci.yml` (top-level jobs + `stages:`/`script:` as block lists). Pure + total: a malformed
//? config yields `{ ok:false }` (never throws), so a bad config surfaces as an error, not a crash.

export interface CiJob { name: string; stage: string; type: string; script: string[]; needs: string[]; image: string; allowFailure: boolean }
export interface CiSpec { version: number; stages: string[]; jobs: CiJob[] }
export type ParseResult = { ok: true; spec: CiSpec } | { ok: false; error: string };

//? A parsed YAML node: a scalar, a sequence, or a mapping. The subset we accept.
export type YamlValue = string | YamlValue[] | YamlMap;
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- a recursive Record<> collapses to `any`; an interface index signature keeps the recursion sound.
export interface YamlMap { [key: string]: YamlValue }

// ---------------------------------------------------------------------------
// The dep-free YAML-subset parser
// ---------------------------------------------------------------------------

interface Line { indent: number; content: string }

//? Strip an unquoted `#` comment (only when at line start or after whitespace, so a `#` inside a
//? value like `sha#123` survives). Quote-aware.
function stripComment(line: string): string {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1] ?? ''))) return line.slice(0, i);
  }
  return line;
}

function tokenize(body: string): Line[] {
  const out: Line[] = [];
  for (const raw0 of body.split('\n')) {
    const raw = stripComment(raw0.replaceAll('\t', '  ')).trimEnd();
    if (raw.trim().length === 0) continue;
    out.push({ indent: raw.length - raw.trimStart().length, content: raw.trim() });
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

//? A scalar value, or an inline flow array `[a, "b", 'c']` → string[]. (Inline flow maps `{}` aren't
//? used by CI configs — treated as an opaque scalar.)
function parseScalarOrInline(v: string): YamlValue {
  const t = v.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((s) => unquote(s)).filter((s) => s.length > 0);
  }
  return unquote(t);
}

function splitKV(content: string): { key: string; value: string } {
  const i = content.indexOf(':');
  if (i === -1) return { key: content.trim(), value: '' };
  return { key: content.slice(0, i).trim(), value: content.slice(i + 1).trim() };
}

//? Parse the block of lines at exactly `indent` starting at `idx`. Returns the value + the index of
//? the first line NOT consumed. A block is a sequence when its lines start with `- `, else a mapping.
function parseBlock(lines: Line[], idx: number, indent: number): { value: YamlValue; next: number } {
  const first = lines[idx];
  if (first?.content.startsWith('- ') === true) {
    const arr: YamlValue[] = [];
    let i = idx;
    for (;;) {
      const line = lines[i];
      if (line === undefined) break;
      if (line.indent !== indent || !line.content.startsWith('- ')) break;
      const rest = line.content.slice(2).trim();
      if (rest.length === 0) {
        //? A nested block under this `-` item (deeper indent on the following lines).
        const nextLine = lines[i + 1];
        const childIndent = nextLine?.indent ?? indent + 2;
        const parsed = parseBlock(lines, i + 1, childIndent);
        arr.push(parsed.value);
        i = parsed.next;
      } else {
        arr.push(parseScalarOrInline(rest));
        i += 1;
      }
    }
    return { value: arr, next: i };
  }
  const obj: YamlMap = {};
  let i = idx;
  for (;;) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.indent !== indent || line.content.startsWith('- ')) break;
    const { key, value } = splitKV(line.content);
    const nextLine = lines[i + 1];
    if (value.length > 0) {
      obj[key] = parseScalarOrInline(value);
      i += 1;
    } else if (nextLine !== undefined && nextLine.indent > indent) {
      const parsed = parseBlock(lines, i + 1, nextLine.indent);
      obj[key] = parsed.value;
      i = parsed.next;
    } else if (nextLine?.indent === indent && nextLine.content.startsWith('- ')) {
      //? A block sequence indented at the SAME column as its key (valid YAML).
      const parsed = parseBlock(lines, i + 1, indent);
      obj[key] = parsed.value;
      i = parsed.next;
    } else {
      obj[key] = '';
      i += 1;
    }
  }
  return { value: obj, next: i };
}

//? Parse a YAML-subset document into a nested value. Exported for tests. Returns `{}` for empty input.
export function parseYamlSubset(body: string): YamlValue {
  const lines = tokenize(body);
  const firstLine = lines[0];
  if (firstLine === undefined) return {};
  return parseBlock(lines, 0, firstLine.indent).value;
}

// ---------------------------------------------------------------------------
// CI-spec interpretation on top of the parsed tree
// ---------------------------------------------------------------------------

const isMap = (v: YamlValue | undefined): v is YamlMap => typeof v === 'object' && !Array.isArray(v);
const asStr = (v: YamlValue | undefined): string => (typeof v === 'string' ? v : '');
//? Coerce a value into a string list: a real array → its string items; a lone scalar → `[scalar]`.
const asStrArray = (v: YamlValue | undefined): string[] => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : '')).filter((s) => s.length > 0);
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
};
const asBool = (v: YamlValue | undefined): boolean => v === 'true';

//? A scanner job (ADR 0040) supplies its command from its TYPE, so it needs no `script`.
const isScanner = (t: string | undefined): boolean => t === 'dep-audit' || t === 'secret-scan' || t === 'sca';

//? Top-level GitLab keys that are NOT jobs (so a real `.gitlab-ci.yml` without a `jobs:` wrapper is
//? read correctly — every OTHER top-level map is treated as a job).
const RESERVED_TOP = new Set(['version', 'stages', 'jobs', 'variables', 'default', 'include', 'workflow', 'image', 'before_script', 'after_script', 'cache', 'services']);

//? Parse a CI config → a typed job DAG. Accepts the documented `jobs:`-wrapped shape AND a real
//? `.gitlab-ci.yml` (top-level jobs). `stages` orders the phases; `needs` are the DAG edges; `image`
//? 'project' (default) resolves to the L2 tag.
export function parseCiYaml(body: string): ParseResult {
  const root = parseYamlSubset(body);
  if (!isMap(root)) return { ok: false, error: 'ci.empty' };
  if (Object.keys(root).length === 0) return { ok: false, error: 'ci.empty' };

  const version = Number(asStr(root.version)) || 1;
  const stages = asStrArray(root.stages);

  //? Jobs come from an explicit `jobs:` map (documented shape) OR every non-reserved top-level map
  //? (real GitLab CI). A job needs a `script` or a scanner `type`.
  const jobEntries: [string, YamlMap][] = [];
  if (isMap(root.jobs)) {
    for (const [name, j] of Object.entries(root.jobs)) if (isMap(j)) jobEntries.push([name, j]);
  } else {
    for (const [name, j] of Object.entries(root)) if (!RESERVED_TOP.has(name) && isMap(j)) jobEntries.push([name, j]);
  }

  const jobs: CiJob[] = jobEntries.map(([name, j]) => ({
    name,
    stage: asStr(j.stage) || (stages[0] ?? 'test'),
    type: asStr(j.type) || 'script',
    script: asStrArray(j.script),
    needs: asStrArray(j.needs),
    image: asStr(j.image) || 'project',
    allowFailure: asBool(j.allowFailure) || asBool(j.allow_failure),
  }));

  if (stages.length === 0) return { ok: false, error: 'ci.noStages' };
  const runnable = jobs.filter((j) => stages.includes(j.stage) && (j.script.length > 0 || isScanner(j.type)));
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
