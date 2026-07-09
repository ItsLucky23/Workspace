//? K1 — the compose-engine SANITIZER. The user chose "run any docker-compose", so the risk isn't running the
//? services (that's just `docker compose up`) — it's MULTI-TENANCY (host-port collisions between workspaces) and
//? SECURITY (a compose file can request `privileged`, mount the host / docker.sock, or share the host network/
//? pid/ipc namespace → host takeover). This module VALIDATES a compose file fail-closed: hard-dangerous
//? directives REJECT the whole file; published host ports are REWRITTEN to container-only (services stay
//? reachable intra-network by name, no host collision). Parsing reuses the dep-free `parseYamlSubset`; a raw-text
//? scan is a belt-and-suspenders for flow-style the subset parser folds to an opaque scalar. Pure + unit-tested.
//? Namespacing (`docker compose -p ws-<id>` + a per-workspace network + volume prefix) happens at provision time.

import { parseYamlSubset, type YamlValue, type YamlMap } from '../ci/parse';

const isMap = (v: YamlValue | undefined): v is YamlMap => typeof v === 'object' && !Array.isArray(v);
const asArr = (v: YamlValue | undefined): YamlValue[] => (Array.isArray(v) ? v : (v === undefined || v === '' ? [] : [v]));

export interface ComposeSanitizeResult {
  ok: boolean;
  sanitized: string;        // the input with published host ports rewritten to container-only (empty when !ok)
  services: string[];       // the service names found
  violations: string[];     // hard-dangerous directives (present ⇒ ok:false)
  rewrites: string[];       // safe rewrites applied (host-port → container-only)
}

//? Directives that grant host access — their mere PRESENCE on any service rejects the file.
const FORBIDDEN_KEYS = ['privileged', 'cap_add', 'devices', 'security_opt', 'userns_mode', 'group_add'];
const HOST_MODE_KEYS = ['network_mode', 'pid', 'ipc'];

//? A volume SOURCE that is a HOST path (bind mount) vs a named volume. Host = starts with `/`, `~`, `.`, or a
//? Windows drive (`C:\`), or contains a path separator. A plain `name:...` is a managed named volume (allowed).
function isHostBindSource(source: string): boolean {
  const s = source.trim();
  return s.startsWith('/') || s.startsWith('~') || s.startsWith('.') || /^[a-zA-Z]:[\\/]/.test(s) || s.includes('/') || s.includes('\\');
}

//? Raw-text tokens that must never appear (catches flow-style `{privileged: true}` the subset parser opacifies).
const RAW_FORBIDDEN: { re: RegExp; label: string }[] = [
  { re: /docker\.sock/i, label: 'docker.sock mount (host daemon access)' },
  { re: /\bprivileged\b/i, label: 'privileged' },
  { re: /network_mode\s*:\s*["']?host/i, label: 'network_mode: host' },
  { re: /\bpid\s*:\s*["']?host/i, label: 'pid: host' },
  { re: /\bipc\s*:\s*["']?host/i, label: 'ipc: host' },
  { re: /\bcap_add\b/i, label: 'cap_add' },
];

//? Rewrite one `ports` entry to CONTAINER-ONLY: compose short syntax is `[[IP:]HOST:]CONTAINER[/proto]`. We keep
//? only the container port (+ proto) so nothing is published to the host (no cross-workspace collision). A
//? bare container port is returned unchanged. Returns { value, rewritten }.
export function rewritePortEntry(entry: string): { value: string; rewritten: boolean } {
  const raw = entry.trim().replaceAll(/^["']|["']$/g, '');
  const slash = raw.split('/');
  const portPart = slash[0] ?? '';
  const proto = slash[1];
  const parts = portPart.split(':');
  if (parts.length <= 1) return { value: entry, rewritten: false }; // already container-only
  const container = parts.at(-1) ?? portPart;
  return { value: proto ? `"${container}/${proto}"` : `"${container}"`, rewritten: true };
}

//? Rewrite every published host port in the raw compose text (line-based, under a `ports:` block). Robust enough
//? for the block-sequence shape compose uses; combined with the structural checks above.
function rewriteHostPorts(body: string): { text: string; rewrites: string[] } {
  const lines = body.split('\n');
  const rewrites: string[] = [];
  let inPorts = false;
  let portsIndent = -1;
  const out = lines.map((line) => {
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (/^ports\s*:/.test(trimmed)) { inPorts = true; portsIndent = indent; return line; }
    if (inPorts) {
      if (trimmed.startsWith('- ')) {
        const item = trimmed.slice(2).trim();
        const { value, rewritten } = rewritePortEntry(item);
        if (rewritten) {
          rewrites.push(`host port published in "${item}" → container-only ${value}`);
          return `${' '.repeat(indent)}- ${value}`;
        }
        return line;
      }
      //? A non-list line at/above the ports indent ends the block.
      if (trimmed.length > 0 && indent <= portsIndent) inPorts = false;
    }
    return line;
  });
  return { text: out.join('\n'), rewrites };
}

//? Validate + sanitize a docker-compose file. Hard-dangerous directives → ok:false + the violation list; else
//? ok:true with published host ports rewritten to container-only.
export function sanitizeCompose(body: string): ComposeSanitizeResult {
  const violations: string[] = [];
  //? Belt-and-suspenders raw scan first (fail-closed on flow-style the parser would opacify).
  for (const { re, label } of RAW_FORBIDDEN) if (re.test(body)) violations.push(label);

  const root = parseYamlSubset(body);
  const services: string[] = [];
  if (isMap(root) && isMap(root.services)) {
    for (const [name, svc] of Object.entries(root.services)) {
      services.push(name);
      if (!isMap(svc)) continue;
      for (const key of FORBIDDEN_KEYS) if (key in svc) violations.push(`service "${name}": ${key}`);
      for (const key of HOST_MODE_KEYS) if (typeof svc[key] === 'string' && svc[key] === 'host') violations.push(`service "${name}": ${key}: host`);
      for (const vol of asArr(svc.volumes)) {
        if (typeof vol === 'string' && vol.includes(':')) {
          const source = vol.split(':')[0] ?? '';
          if (isHostBindSource(source)) violations.push(`service "${name}": host bind-mount "${vol}"`);
        }
      }
    }
  } else if (violations.length === 0) {
    violations.push('no `services:` map found');
  }

  const unique = [...new Set(violations)];
  if (unique.length > 0) return { ok: false, sanitized: '', services, violations: unique, rewrites: [] };
  const { text, rewrites } = rewriteHostPorts(body);
  return { ok: true, sanitized: text, services, violations: [], rewrites };
}
