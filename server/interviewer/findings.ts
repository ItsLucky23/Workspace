//? Interviewer findings (ADR 0034) — parse the interviewer role's markdown output into CATEGORISED,
//? persisted `InterviewFinding` rows (replacing the old notification-only flow), so ideas survive,
//? group by area, and can be turned into tickets. Pure parser + a thin DB writer.

import type { PrismaClient } from '@prisma/client';

import { assertWorkspaceWriterContext } from '../orchestrator/writerContext';

export type FindingArea = 'reliability' | 'dx' | 'ux' | 'performance' | 'security' | 'product' | 'other';
const AREAS: readonly FindingArea[] = ['reliability', 'dx', 'ux', 'performance', 'security', 'product', 'other'];
const areaOf = (raw: string): FindingArea => {
  const k = raw.trim().toLowerCase();
  return (AREAS as readonly string[]).includes(k) ? (k as FindingArea) : 'other';
};

export interface ParsedFinding { area: FindingArea; severity: 'low' | 'normal' | 'high'; title: string; summary: string }

//? Parse a markdown idea-list into findings. Accepts `- [area] **Title** — summary`, with the
//? `[area]` and the bold optional; the em-dash/colon/hyphen separates title from summary.
export function parseFindings(markdown: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    //? Only markdown list items are findings — skips any preamble/prose the model may add.
    const bullet = /^(?:[-*]|\d+\.)\s+/.exec(line);
    if (!bullet) continue;
    const body = line.slice(bullet[0].length).trim();
    const areaMatch = /^\[([a-zA-Z]+)\]\s*/.exec(body);
    const area = areaMatch ? areaOf(areaMatch[1] ?? '') : 'other';
    const rest = areaMatch ? body.slice(areaMatch[0].length) : body;
    const m = /^\**(.+?)\**\s*[—:–-]\s*(.+)$/.exec(rest);
    const title = (m?.[1] ?? rest).replaceAll('*', '').trim();
    const summary = (m?.[2] ?? '').replaceAll('*', '').trim();
    if (title.length < 3) continue;
    const severity: ParsedFinding['severity'] = area === 'security' || area === 'reliability' ? 'high' : 'normal';
    out.push({ area, severity, title: title.slice(0, 160), summary: summary.slice(0, 400) });
  }
  return out;
}

//? Persist parsed findings for a workspace; returns how many were written.
export async function recordFindings(prisma: PrismaClient, workspaceId: string, findings: ParsedFinding[]): Promise<number> {
  assertWorkspaceWriterContext(workspaceId);
  if (findings.length === 0) return 0;
  await prisma.interviewFinding.createMany({
    data: findings.map((f) => ({ workspaceId, area: f.area, severity: f.severity, title: f.title, summary: f.summary })),
  });
  return findings.length;
}
