//? Security & dependency scanning (ADR 0040, C2) — first-class CI job TYPES on the C1 runner. A
//? `dep-audit`/`sca` job runs `npm audit --json`; a `secret-scan` job greps for common credential
//? patterns. Results are PARSED into typed findings + a max severity (not freeform log-grepping). Policy:
//? high/critical BLOCKS a prod promote (report-only on dev/merge — the scanner job stays green so it
//? doesn't hard-block the flow; the SEVERITY is the prod gate). Pure parsers — the runner + gate consume.

import { tryCatchSync } from '@luckystack/core';

//? Ordered severities (critical is highest). Unknown → 'none'.
export const SEVERITY_RANK: Record<string, number> = { none: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const HIGH = SEVERITY_RANK.high ?? 3;

export interface SecurityFinding { id: string; severity: string; title: string }
export interface ScanResult { maxSeverity: string; findings: SecurityFinding[] }

const EMPTY_SCAN: ScanResult = { maxSeverity: 'none', findings: [] };
const rankOf = (s: string): number => SEVERITY_RANK[s] ?? 0;
function maxSev(findings: SecurityFinding[]): string {
  let acc = 'none';
  for (const f of findings) if (rankOf(f.severity) > rankOf(acc)) acc = f.severity;
  return acc;
}

//? Is this a scanner job type (vs a plain `script` job)?
export function isScannerType(t: string): boolean { return t === 'dep-audit' || t === 'secret-scan' || t === 'sca'; }

//? The shell command a scanner job runs in the container. `|| true` so the job never non-zero-exits on
//? findings — we PARSE the output rather than gate on the exit code (report-only for the run status).
export function scannerCommand(type: string): string {
  if (type === 'dep-audit' || type === 'sca') return 'npm audit --json 2>/dev/null || true';
  if (type === 'secret-scan') return String.raw`grep -rInE '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' --exclude-dir=.git --exclude-dir=node_modules . 2>/dev/null || true`;
  return '';
}

//? Parse `npm audit --json` → findings. Handles npm v7+ (`.vulnerabilities` map) + the v6 `.advisories`
//? shape + the `.metadata.vulnerabilities` severity counts. Never throws (bad/empty JSON → clean scan).
export function parseDepAudit(out: string): ScanResult {
  const [, doc] = tryCatchSync(() => JSON.parse(out) as unknown);
  if (doc === null || typeof doc !== 'object') return EMPTY_SCAN;
  const root = doc as Record<string, unknown>;
  const findings: SecurityFinding[] = [];

  const vulns = root.vulnerabilities;
  if (vulns !== null && typeof vulns === 'object') {
    for (const [name, raw] of Object.entries(vulns as Record<string, unknown>)) {
      if (raw === null || typeof raw !== 'object') continue;
      const sev = (raw as Record<string, unknown>).severity;
      if (typeof sev === 'string' && sev !== 'info') findings.push({ id: `dep:${name}`, severity: sev, title: `${name}: ${sev} advisory` });
    }
  }
  const advisories = root.advisories;                          // npm v6 fallback
  if (findings.length === 0 && advisories !== null && typeof advisories === 'object') {
    for (const raw of Object.values(advisories as Record<string, unknown>)) {
      if (raw === null || typeof raw !== 'object') continue;
      const a = raw as Record<string, unknown>;
      const sev = typeof a.severity === 'string' ? a.severity : 'low';
      const mod = typeof a.module_name === 'string' ? a.module_name : 'dep';
      findings.push({ id: `dep:${mod}`, severity: sev, title: `${mod}: ${sev} advisory` });
    }
  }
  return { maxSeverity: maxSev(findings), findings: findings.slice(0, 100) };
}

//? Parse the secret-scan grep output → one HIGH finding per matched line (a leaked credential is high).
export function parseSecretScan(out: string): ScanResult {
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 100);
  const findings: SecurityFinding[] = lines.map((line, i) => ({ id: `secret:${String(i)}`, severity: 'high', title: `possible secret: ${line.slice(0, 120)}` }));
  return { maxSeverity: maxSev(findings), findings };
}

//? Dispatch to the right parser for a scanner job type.
export function parseScan(type: string, out: string): ScanResult {
  if (type === 'dep-audit' || type === 'sca') return parseDepAudit(out);
  if (type === 'secret-scan') return parseSecretScan(out);
  return EMPTY_SCAN;
}

//? Does this severity block a prod promote? high/critical block; below is report-only.
export function severityBlocksProd(sev: string | null | undefined): boolean {
  return rankOf(sev ?? 'none') >= HIGH;
}

//? The higher of two severities (for rolling a run up over its scanner jobs).
export function higherSeverity(a: string, b: string): string { return rankOf(a) >= rankOf(b) ? a : b; }
