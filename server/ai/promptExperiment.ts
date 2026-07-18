//? GAP_SCAN G7 — prompt-quality A/B, measured instead of vibed.
//?
//? Prompts are the product's most-edited surface and the least-measured one: a stage prompt or an ideator
//? hook style gets rewritten on a hunch, and nobody can say whether it helped. The deterministic replay
//? scorer only answers "did this change break a known case", never "which of these two is better".
//?
//? So: an experiment is two prompt variants for one feature; a SUBJECT (a piece, a ticket, a turn) is
//? assigned deterministically by hash — same subject, same variant, forever, with no assignment table to
//? keep in sync — and the outcome that matters (views, a passing test, an accepted plan) is recorded as a
//? trial. The report refuses to call a winner before there is enough evidence, which is the entire point.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

export type Variant = 'a' | 'b';

//? Deterministic 50/50 split from (experimentId, subjectId). Hash-based so the same piece always renders
//? under the same variant — a subject that flipped between variants would poison its own measurement.
export function assignVariant(experimentId: string, subjectId: string): Variant {
  const digest = createHash('sha256').update(`${experimentId}:${subjectId}`).digest();
  return (digest[0] ?? 0) % 2 === 0 ? 'a' : 'b';
}

export interface ExperimentReport {
  trialsA: number;
  trialsB: number;
  meanA: number;
  meanB: number;
  lift: number;                 // (meanB - meanA) / meanA, as a fraction; 0 when A has no signal
  winner: Variant | null;       // null = not enough evidence yet
  verdict: string;
}

//? How many trials per arm before a difference is worth reporting. Deliberately conservative: the failure
//? mode of a prompt A/B is declaring a winner off three samples and rewriting everything around noise.
export const MIN_TRIALS_PER_ARM = 10;
//? And how big the difference must be. Below this, "no difference" is the honest answer.
export const MIN_LIFT = 0.1;

const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

//? Score two arms. Pure over already-fetched trials so the statistics are testable without a DB.
export function scoreExperiment(trials: { variant: string; score: number }[]): ExperimentReport {
  const a = trials.filter((t) => t.variant === 'a').map((t) => t.score);
  const b = trials.filter((t) => t.variant === 'b').map((t) => t.score);
  const meanA = mean(a);
  const meanB = mean(b);
  const lift = meanA === 0 ? (meanB > 0 ? 1 : 0) : (meanB - meanA) / meanA;

  if (a.length < MIN_TRIALS_PER_ARM || b.length < MIN_TRIALS_PER_ARM) {
    return { trialsA: a.length, trialsB: b.length, meanA, meanB, lift, winner: null, verdict: `Not enough data yet (${String(a.length)}/${String(b.length)} of ${String(MIN_TRIALS_PER_ARM)} per variant).` };
  }
  if (Math.abs(lift) < MIN_LIFT) {
    return { trialsA: a.length, trialsB: b.length, meanA, meanB, lift, winner: null, verdict: 'No meaningful difference — keep the simpler prompt.' };
  }
  const winner: Variant = lift > 0 ? 'b' : 'a';
  return { trialsA: a.length, trialsB: b.length, meanA, meanB, lift, winner, verdict: `Variant ${winner.toUpperCase()} wins by ${String(Math.round(Math.abs(lift) * 100))}%.` };
}

//? The active experiment for a feature (at most one — two overlapping experiments on the same prompt make
//? both unreadable).
export async function activeExperiment(prisma: PrismaClient, workspaceId: string, feature: string): Promise<{ id: string; variantA: string; variantB: string } | null> {
  const [, row] = await tryCatch(() => prisma.promptExperiment.findFirst({
    where: { workspaceId, feature, status: 'running' }, orderBy: { createdAt: 'desc' },
    select: { id: true, variantA: true, variantB: true },
  }));
  return row ?? null;
}

//? Resolve which prompt text this subject should get. No experiment ⇒ null, and the caller keeps its own
//? prompt — an experiment layer must never be load-bearing for normal operation.
export async function resolvePromptVariant(
  prisma: PrismaClient, workspaceId: string, feature: string, subjectId: string,
): Promise<{ experimentId: string; variant: Variant; prompt: string } | null> {
  const experiment = await activeExperiment(prisma, workspaceId, feature);
  if (!experiment) return null;
  const variant = assignVariant(experiment.id, subjectId);
  return { experimentId: experiment.id, variant, prompt: variant === 'a' ? experiment.variantA : experiment.variantB };
}

//? Record what a subject actually achieved. Idempotent per (experiment, subject): a metrics ingest runs
//? hourly, and counting the same post ten times would manufacture confidence out of one result.
export async function recordTrial(
  prisma: PrismaClient, workspaceId: string, input: { experimentId: string; subjectId: string; variant: Variant; score: number },
): Promise<void> {
  const existing = await prisma.promptTrial.findFirst({ where: { workspaceId, experimentId: input.experimentId, subjectId: input.subjectId }, select: { id: true } });
  await tryCatch(() => (existing
    ? prisma.promptTrial.update({ where: { id: existing.id }, data: { score: input.score } })
    : prisma.promptTrial.create({ data: { workspaceId, experimentId: input.experimentId, subjectId: input.subjectId, variant: input.variant, score: input.score } })));
}

export async function experimentReport(prisma: PrismaClient, workspaceId: string, experimentId: string): Promise<ExperimentReport> {
  const trials = await prisma.promptTrial.findMany({ where: { workspaceId, experimentId }, select: { variant: true, score: true } });
  return scoreExperiment(trials);
}
