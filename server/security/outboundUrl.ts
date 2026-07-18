//? Central outbound URL validation. Every hostname is resolved once with ALL A/AAAA answers; every
//? answer must be globally routable before one validated address may be pinned by the HTTP transport.
//? Literal and resolved loopback/private/link-local/multicast/documentation/reserved/metadata addresses
//? fail closed. HTTPS is the default; public HTTP needs an explicit read-only transport opt-in.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { tryCatch, tryCatchSync } from '@luckystack/core';

export type OutboundErrorCode =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'insecure-http-not-allowed'
  | 'non-default-port'
  | 'credentials-not-allowed'
  | 'blocked-hostname'
  | 'blocked-address'
  | 'dns-failed'
  | 'dns-empty'
  | 'dns-invalid'
  | 'timeout';

export interface OutboundError {
  code: OutboundErrorCode;
  message: string;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type OutboundResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface ValidatedOutboundTarget {
  url: URL;
  hostname: string;
  addresses: readonly ResolvedAddress[];
  pinnedAddress: ResolvedAddress;
}

export interface OutboundTargetOptions {
  allowInsecureHttp?: boolean;
}

export type OutboundTargetResult =
  | { ok: true; target: ValidatedOutboundTarget }
  | { ok: false; error: OutboundError };

interface AddressRange {
  base: string;
  prefix: number;
  reason: string;
}

const IPV4_RANGES: readonly AddressRange[] = [
  { base: '0.0.0.0', prefix: 8, reason: 'reserved' },
  { base: '10.0.0.0', prefix: 8, reason: 'private' },
  { base: '100.64.0.0', prefix: 10, reason: 'shared/reserved' },
  { base: '127.0.0.0', prefix: 8, reason: 'loopback' },
  { base: '169.254.0.0', prefix: 16, reason: 'link-local' },
  { base: '172.16.0.0', prefix: 12, reason: 'private' },
  { base: '192.0.0.0', prefix: 24, reason: 'reserved' },
  { base: '192.0.2.0', prefix: 24, reason: 'documentation' },
  { base: '192.31.196.0', prefix: 24, reason: 'reserved' },
  { base: '192.52.193.0', prefix: 24, reason: 'reserved' },
  { base: '192.88.99.0', prefix: 24, reason: 'reserved' },
  { base: '192.168.0.0', prefix: 16, reason: 'private' },
  { base: '192.175.48.0', prefix: 24, reason: 'reserved' },
  { base: '198.18.0.0', prefix: 15, reason: 'benchmark/reserved' },
  { base: '198.51.100.0', prefix: 24, reason: 'documentation' },
  { base: '203.0.113.0', prefix: 24, reason: 'documentation' },
  { base: '224.0.0.0', prefix: 4, reason: 'multicast' },
  { base: '240.0.0.0', prefix: 4, reason: 'reserved' },
];

const IPV6_RANGES: readonly AddressRange[] = [
  { base: '::1', prefix: 128, reason: 'loopback' },
  { base: '::', prefix: 96, reason: 'reserved/IPv4-compatible' },
  { base: '::ffff:0:0', prefix: 96, reason: 'reserved IPv4-mapped' },
  { base: '64:ff9b::', prefix: 96, reason: 'reserved translation' },
  { base: '64:ff9b:1::', prefix: 48, reason: 'reserved translation' },
  { base: '100::', prefix: 64, reason: 'discard-only' },
  { base: '2001::', prefix: 23, reason: 'protocol/reserved' },
  { base: '2001:db8::', prefix: 32, reason: 'documentation' },
  { base: '2002::', prefix: 16, reason: 'reserved 6to4' },
  { base: '3ffe::', prefix: 16, reason: 'reserved' },
  { base: '3fff::', prefix: 20, reason: 'documentation' },
  { base: '5f00::', prefix: 16, reason: 'reserved' },
  { base: 'fc00::', prefix: 7, reason: 'private' },
  { base: 'fe80::', prefix: 10, reason: 'link-local' },
  { base: 'fec0::', prefix: 10, reason: 'reserved site-local' },
  { base: 'ff00::', prefix: 8, reason: 'multicast' },
];

const METADATA_IPV4 = new Set([
  '100.100.100.200',
  '168.63.129.16',
  '169.254.169.254',
  '169.254.170.2',
]);

const METADATA_HOSTS = new Set([
  'instance-data',
  'instance-data.ec2.internal',
  'metadata',
  'metadata.google.internal',
]);

function failure(code: OutboundErrorCode, message: string): OutboundTargetResult {
  return { ok: false, error: { code, message } };
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replaceAll(/^\[|\]$/g, '').replace(/\.$/, '');
}

function addressFamily(address: string): 0 | 4 | 6 {
  const family = isIP(address);
  if (family === 4) return 4;
  if (family === 6) return 6;
  return 0;
}

function ipv4Value(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function ipv4InRange(address: string, range: AddressRange): boolean {
  const value = ipv4Value(address);
  const base = ipv4Value(range.base);
  if (value === null || base === null) return false;
  const divisor = 2 ** (32 - range.prefix);
  return Math.floor(value / divisor) === Math.floor(base / divisor);
}

function ipv6Value(address: string): bigint | null {
  if (isIP(address) !== 6 || address.includes('%')) return null;
  let normalized = address.toLowerCase();
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const embedded = ipv4Value(normalized.slice(lastColon + 1));
    if (lastColon < 0 || embedded === null) return null;
    const high = Math.floor(embedded / 65_536).toString(16);
    const low = (embedded % 65_536).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const compression = normalized.indexOf('::');
  if (compression !== -1 && normalized.includes('::', compression + 2)) return null;
  const left = (compression === -1 ? normalized : normalized.slice(0, compression)).split(':').filter(Boolean);
  const right = (compression === -1 ? '' : normalized.slice(compression + 2)).split(':').filter(Boolean);
  const missing = compression === -1 ? 0 : 8 - left.length - right.length;
  if ((compression === -1 && left.length !== 8) || (compression !== -1 && missing < 1)) return null;
  const groups = compression === -1 ? left : [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  let value = 0n;
  for (const group of groups) value = value * 65_536n + BigInt(`0x${group}`);
  return value;
}

function ipv6InRange(address: string, range: AddressRange): boolean {
  const value = ipv6Value(address);
  const base = ipv6Value(range.base);
  if (value === null || base === null) return false;
  const shift = BigInt(128 - range.prefix);
  return (value >> shift) === (base >> shift);
}

//? Returns WHY an IP is unsafe, or null when it is globally routable according to the central policy.
export function blockedAddressReason(rawAddress: string): string | null {
  const address = normalizeHostname(rawAddress);
  if (address.includes('%')) return 'invalid scoped address';
  const family = isIP(address);
  if (family === 4) {
    if (METADATA_IPV4.has(address)) return 'metadata';
    for (const range of IPV4_RANGES) if (ipv4InRange(address, range)) return range.reason;
    return null;
  }
  if (family === 6) {
    for (const range of IPV6_RANGES) if (ipv6InRange(address, range)) return range.reason;
    return null;
  }
  return 'invalid';
}

function blockedHostnameReason(hostname: string): string | null {
  if (METADATA_HOSTS.has(hostname)) return 'metadata';
  if (!hostname.includes('.')) return 'single-label/reserved';
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'localhost';
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')) return 'private/reserved name';
  return null;
}

interface ParsedOutboundUrl {
  url: URL;
  hostname: string;
  family: 0 | 4 | 6;
}

type ParsedOutboundResult = { ok: true; parsed: ParsedOutboundUrl } | { ok: false; error: OutboundError };

function parseOutboundUrl(rawUrl: string, allowInsecureHttp: boolean): ParsedOutboundResult {
  const [urlError, url] = tryCatchSync(() => new URL(rawUrl));
  if (urlError || !url || url.hostname.length === 0) return { ok: false, error: { code: 'invalid-url', message: 'Invalid outbound URL' } };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: { code: 'unsupported-protocol', message: 'Only HTTP(S) outbound URLs are allowed' } };
  //? WHATWG URL normalizes an explicitly configured default port to ""; any remaining port is non-default.
  if (url.port !== '') return { ok: false, error: { code: 'non-default-port', message: 'Only default HTTP(S) ports are allowed' } };
  if (url.username.length > 0 || url.password.length > 0) return { ok: false, error: { code: 'credentials-not-allowed', message: 'URL credentials are not allowed' } };
  if (url.protocol === 'http:' && !allowInsecureHttp) return { ok: false, error: { code: 'insecure-http-not-allowed', message: 'Plain HTTP requires an explicit safe-read opt-in' } };
  const hostname = normalizeHostname(url.hostname);
  const family = addressFamily(hostname);
  if (family === 0) {
    const reason = blockedHostnameReason(hostname);
    if (reason) return { ok: false, error: { code: 'blocked-hostname', message: `Blocked outbound hostname (${reason})` } };
  }
  return { ok: true, parsed: { url, hostname, family } };
}

//? Synchronous preflight used by legacy guards. Hostnames still require resolveOutboundTarget() before I/O.
export function isObviouslyUnsafeOutboundUrl(rawUrl: string): boolean {
  const parsed = parseOutboundUrl(rawUrl, true);
  if (!parsed.ok) return true;
  return parsed.parsed.family !== 0 && blockedAddressReason(parsed.parsed.hostname) !== null;
}

export const defaultOutboundResolver: OutboundResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
};

async function resolveWithTimeout(resolver: OutboundResolver, hostname: string, timeoutMs: number): Promise<{ addresses: readonly ResolvedAddress[] | null; timedOut: boolean }> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<readonly ResolvedAddress[]>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('Outbound DNS resolution timed out')); }, timeoutMs);
  });
  const [error, addresses] = await tryCatch(() => Promise.race([resolver(hostname), timeout]));
  if (timer !== undefined) clearTimeout(timer);
  return { addresses: error ? null : addresses, timedOut };
}

//? Resolve once, validate every answer, then expose one of those validated addresses as the connect pin.
export async function resolveOutboundTarget(rawUrl: string, resolver: OutboundResolver = defaultOutboundResolver, timeoutMs = 15_000, options: OutboundTargetOptions = {}): Promise<OutboundTargetResult> {
  const parsedResult = parseOutboundUrl(rawUrl, options.allowInsecureHttp === true);
  if (!parsedResult.ok) return { ok: false, error: parsedResult.error };
  const { url, hostname, family } = parsedResult.parsed;

  let resolved: readonly ResolvedAddress[];
  if (family === 4 || family === 6) {
    resolved = [{ address: hostname, family }];
  } else {
    if (timeoutMs <= 0) return failure('timeout', 'Outbound DNS resolution timed out');
    const resolution = await resolveWithTimeout(resolver, hostname, timeoutMs);
    if (resolution.timedOut) return failure('timeout', 'Outbound DNS resolution timed out');
    if (resolution.addresses === null) return failure('dns-failed', 'Outbound DNS resolution failed');
    resolved = resolution.addresses;
  }

  if (resolved.length === 0) return failure('dns-empty', 'Outbound DNS returned no A/AAAA addresses');
  const addresses: ResolvedAddress[] = [];
  const seen = new Set<string>();
  for (const entry of resolved) {
    const address = normalizeHostname(entry.address);
    const actualFamily = addressFamily(address);
    if ((actualFamily !== 4 && actualFamily !== 6) || actualFamily !== entry.family) return failure('dns-invalid', 'Outbound DNS returned an invalid address');
    const reason = blockedAddressReason(address);
    if (reason) return failure('blocked-address', `Outbound address is blocked (${reason})`);
    const key = `${String(actualFamily)}:${address}`;
    if (!seen.has(key)) {
      seen.add(key);
      addresses.push({ address, family: actualFamily });
    }
  }
  const [pinnedAddress] = addresses;
  if (!pinnedAddress) return failure('dns-empty', 'Outbound DNS returned no usable A/AAAA addresses');
  return { ok: true, target: { url, hostname, addresses, pinnedAddress } };
}
