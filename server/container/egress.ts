//? Egress control (07b §6). Opt-in via WS_EGRESS=1 (default OFF ⇒ current behaviour, workers keep
//? full network). When ON, a worker container joins an `--internal` docker network (no direct route
//? out) and routes ALL HTTP(S) through an allowlist forward proxy (squid), so AI/tenant code can
//? only reach package registries, git hosts and the AI API — it can't exfiltrate secrets/code to an
//? arbitrary host. Domain-level allowlist (squid ACLs on the CONNECT/GET destination — no MITM).
//?
//? Topology: `ws-egress` is internal (workers have no external route); the squid proxy sits on BOTH
//? `ws-egress` AND a normal network, so it — and ONLY it — bridges to the outside. Inbound preview/
//? editor traffic (Caddy → container) is a SEPARATE concern: to combine egress with the per-ticket
//? subdomains, put the reverse proxy on `ws-egress` too (see docs/WORKSPACES_MULTI_INSTANCE.md /
//? HOSTING.md). Best-effort: infra failures degrade to a warning, never block a launch.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { docker } from './runtime';

const EGRESS_NET = 'ws-egress';
const PROXY_NAME = 'ws-egress-proxy';
const PROXY_PORT = 3128;
const PROXY_IMAGE = process.env.WS_EGRESS_IMAGE ?? 'ubuntu/squid:latest';

//? Sensible default allowlist — package registries, git hosts, OS repos, the AI APIs. Extend via
//? WS_EGRESS_ALLOW (comma-separated leading-dot domains, e.g. `.internal.example.com`).
const DEFAULT_ALLOW = [
  '.npmjs.org', '.yarnpkg.com', '.pypi.org', '.pythonhosted.org', '.crates.io',
  '.github.com', '.githubusercontent.com', '.gitlab.com', '.googlesource.com',
  '.debian.org', '.ubuntu.com', '.alpinelinux.org', '.anthropic.com', '.googleapis.com',
];

export function egressEnabled(): boolean {
  return (process.env.WS_EGRESS ?? '') === '1';
}

function allowDomains(): string[] {
  const extra = (process.env.WS_EGRESS_ALLOW ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return [...DEFAULT_ALLOW, ...extra];
}

//? squid.conf allowing HTTP + HTTPS(CONNECT) ONLY to the allowlisted destination domains, deny rest.
function squidConf(): string {
  const domains = allowDomains();
  const acls = domains.map((d, i) => `acl allow_${String(i)} dstdomain ${d}`).join('\n');
  const grants = domains.map((_, i) => `http_access allow allow_${String(i)}`).join('\n');
  return `http_port ${String(PROXY_PORT)}
acl SSL_ports port 443
acl CONNECT method CONNECT
http_access deny CONNECT !SSL_ports
${acls}
${grants}
http_access deny all
access_log none
cache deny all
`;
}

//? Ensure the internal network + the allowlist proxy exist (idempotent). Called before a worker
//? launch when egress is enabled. Never throws — returns whether egress is ready to attach.
export async function ensureEgressInfra(): Promise<boolean> {
  if (!egressEnabled()) return false;
  //? Internal network (no external route for its members).
  const net = await docker(['network', 'inspect', EGRESS_NET]);
  if (net.code !== 0) await docker(['network', 'create', '--internal', EGRESS_NET]);

  const running = await docker(['inspect', '-f', '{{.State.Running}}', PROXY_NAME]);
  if (running.code === 0 && running.out === 'true') return true;
  if (running.code === 0) { await docker(['rm', '-f', PROXY_NAME]); }

  //? Write the allowlist config to a host path (data/ is gitignored) + mount it read-only.
  const confDir = process.env.WS_EGRESS_DIR ?? path.join(process.cwd(), 'data', '_egress');
  if (!existsSync(confDir)) mkdirSync(confDir, { recursive: true });
  const confPath = path.join(confDir, 'squid.conf');
  writeFileSync(confPath, squidConf());

  //? Launch on a NORMAL network first (external access), then also attach the internal one so
  //? workers can reach it while it — and only it — bridges outward.
  const run = await docker([
    'run', '-d', '--name', PROXY_NAME, '--restart', 'unless-stopped',
    '-v', `${confPath}:/etc/squid/squid.conf:ro`,
    PROXY_IMAGE,
  ]);
  if (run.code !== 0) { console.warn(`[egress] proxy launch failed: ${run.err}`); return false; }
  await docker(['network', 'connect', EGRESS_NET, PROXY_NAME]);
  return true;
}

//? Extra `docker run` args to confine a worker to egress-via-proxy: join the internal network + point
//? every HTTP(S) client at the proxy. Empty when egress is disabled (no change to the launch).
export function egressLaunchArgs(): string[] {
  if (!egressEnabled()) return [];
  const proxyUrl = `http://${PROXY_NAME}:${String(PROXY_PORT)}`;
  return [
    '--network', EGRESS_NET,
    '-e', `HTTP_PROXY=${proxyUrl}`, '-e', `HTTPS_PROXY=${proxyUrl}`,
    '-e', `http_proxy=${proxyUrl}`, '-e', `https_proxy=${proxyUrl}`,
    '-e', 'NO_PROXY=localhost,127.0.0.1', '-e', 'no_proxy=localhost,127.0.0.1',
  ];
}
