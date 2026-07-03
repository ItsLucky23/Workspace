//? Forge-provider abstraction (#10). The push-on-approval + MR paths were GitLab-hardcoded; this
//? generalizes "open a merge/pull request" behind a provider so a workspace can target GitLab OR
//? GitHub with the same engine code. The REST call SHAPING (url/method/headers/body + how to read
//? the response url) is pure + per-provider, so it is unit-testable without a network — the thin
//? fetch wrapper just executes the shaped request. Tokens travel in headers only (never the url).

export type ForgeType = 'gitlab' | 'github';

//? A shaped HTTP request the fetch wrapper executes verbatim.
export interface ForgeRequest { url: string; method: string; headers: Record<string, string>; body?: string }

export interface OpenMrInput {
  //? Provider API base. GitLab: the instance url (…/api/v4 appended). GitHub: https://api.github.com
  //? (or an Enterprise …/api/v3). Trailing slashes are trimmed.
  base: string;
  //? "group/project" (GitLab) or "owner/repo" (GitHub).
  path: string;
  token: string;
  source: string;   // the ticket's branch
  target: string;   // the target branch
  title: string;
}

const trim = (s: string): string => s.replace(/\/+$/, '');

//? GitHub's PR "head" is `owner:branch` (owner derived from path). GitLab just uses the branch.
function githubHead(path: string, source: string): string {
  const owner = path.split('/')[0] ?? '';
  return owner.length > 0 ? `${owner}:${source}` : source;
}

//? Shape the "open a new MR/PR" request for a provider. Pure.
export function buildOpenMrRequest(type: ForgeType, m: OpenMrInput): ForgeRequest {
  const base = trim(m.base);
  if (type === 'github') {
    return {
      url: `${base}/repos/${m.path}/pulls`, method: 'POST',
      headers: { Authorization: `Bearer ${m.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ head: m.source, base: m.target, title: m.title }),
    };
  }
  return {
    url: `${base}/api/v4/projects/${encodeURIComponent(m.path)}/merge_requests`, method: 'POST',
    headers: { 'PRIVATE-TOKEN': m.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_branch: m.source, target_branch: m.target, title: m.title }),
  };
}

//? Shape the "find the existing open MR/PR for this source branch" request (used when the open call
//? reports a duplicate). Pure.
export function buildFindMrRequest(type: ForgeType, m: OpenMrInput): ForgeRequest {
  const base = trim(m.base);
  if (type === 'github') {
    return {
      url: `${base}/repos/${m.path}/pulls?state=open&head=${encodeURIComponent(githubHead(m.path, m.source))}`, method: 'GET',
      headers: { Authorization: `Bearer ${m.token}`, Accept: 'application/vnd.github+json' },
    };
  }
  return {
    url: `${base}/api/v4/projects/${encodeURIComponent(m.path)}/merge_requests?state=opened&source_branch=${encodeURIComponent(m.source)}`, method: 'GET',
    headers: { 'PRIVATE-TOKEN': m.token },
  };
}

//? Read the MR/PR web url off a provider's create/list JSON. GitHub uses `html_url`, GitLab
//? `web_url`. Pure — accepts the object (create) or an array (list).
export function readMrUrl(type: ForgeType, json: unknown): string | null {
  const field = type === 'github' ? 'html_url' : 'web_url';
  const pick = (o: unknown): string | null => (o !== null && typeof o === 'object' && typeof (o as Record<string, unknown>)[field] === 'string' ? ((o as Record<string, string>)[field] ?? null) : null);
  if (Array.isArray(json)) return json.length > 0 ? pick(json[0]) : null;
  return pick(json);
}

//? Did the "open" call report a duplicate (an MR/PR already exists for this branch)? GitLab → 409,
//? GitHub → 422. Pure.
export function isDuplicateStatus(type: ForgeType, status: number): boolean {
  return type === 'github' ? status === 422 : status === 409;
}

//? Execute the shaped open-MR flow: POST; on a duplicate, GET the existing one. Returns the web url
//? or null. The ONLY network path — everything above is pure + tested.
export async function openForgeMergeRequest(type: ForgeType, m: OpenMrInput): Promise<string | null> {
  const open = buildOpenMrRequest(type, m);
  //? External forge REST API (GitLab /api/v4 or GitHub api.github.com) — not a framework `/api/*`
  //? route, so a raw fetch is correct; a json() throw is caught by the caller's tryCatch.
  // eslint-disable-next-line luckystack/no-raw-fetch-in-src
  const res = await fetch(open.url, { method: open.method, headers: open.headers, ...(open.body ? { body: open.body } : {}) });
  if (res.ok) return readMrUrl(type, await res.json());
  if (!isDuplicateStatus(type, res.status)) return null;
  const find = buildFindMrRequest(type, m);
  // eslint-disable-next-line luckystack/no-raw-fetch-in-src
  const list = await fetch(find.url, { method: find.method, headers: find.headers });
  if (!list.ok) return null;
  return readMrUrl(type, await list.json());
}
