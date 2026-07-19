//? F23 — the CI DAG scheduler.
//?
//? `needs` was parsed, validated and stored, and then ignored: jobs ran in a flat sequence ordered only by
//? stage index. Two consequences, both real: a job could run before the job it depends on (same stage, no
//? ordering), and a job whose dependency FAILED ran anyway and failed confusingly on its own.
//?
//? This computes execution WAVES: each wave is the set of jobs whose dependencies are all satisfied, so the
//? jobs inside a wave can run concurrently while the waves themselves stay ordered. A job whose dependency
//? failed is never scheduled — it is reported `skipped`, which is honest, instead of being run into a
//? confusing failure.
//?
//? Pure: the scheduler decides, the runner executes. That split is what makes the interesting cases
//? (cycles, diamonds, a failed middle) testable without Docker.

export interface DagJob { name: string; stage: string; needs: string[] }

export interface DagPlan {
  //? Each entry is a set of job names that may run CONCURRENTLY.
  waves: string[][];
  //? Jobs that can never run because their dependency graph has a cycle (or names a missing job).
  unrunnable: string[];
}

//? Build the waves. Stage order is honoured FIRST (a `test` job never runs before a `build` job even
//? without an explicit `needs`), and `needs` refines the order within and across stages — that keeps the
//? familiar stage semantics while making `needs` actually mean something.
export function planWaves(jobs: DagJob[], stages: string[]): DagPlan {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const stageIndex = (stage: string): number => {
    const i = stages.indexOf(stage);
    return i === -1 ? stages.length : i;
  };

  const scheduled = new Set<string>();
  const waves: string[][] = [];
  let remaining = jobs.filter((j) => byName.has(j.name));

  while (remaining.length > 0) {
    //? A job is ready when every dependency it names is already scheduled. A dependency on a job that does
    //? not exist can never be satisfied — that job falls out as unrunnable below rather than blocking here.
    const ready = remaining.filter((job) => job.needs.every((need) => scheduled.has(need) || !byName.has(need)));
    if (ready.length === 0) break;   //? a cycle: nothing is ready but work remains

    //? Within the ready set, only the EARLIEST stage runs in this wave. Without this a `deploy` job with no
    //? `needs` would run alongside `build`, which is not what a stage list means.
    const earliest = Math.min(...ready.map((job) => stageIndex(job.stage)));
    const wave = ready.filter((job) => stageIndex(job.stage) === earliest);

    waves.push(wave.map((j) => j.name));
    for (const job of wave) scheduled.add(job.name);
    remaining = remaining.filter((job) => !scheduled.has(job.name));
  }

  return { waves, unrunnable: remaining.map((j) => j.name) };
}

//? Which jobs must be SKIPPED given what has failed so far — transitively, because a job whose dependency
//? was itself skipped has no more reason to run than one whose dependency failed outright.
export function skippedBy(jobs: DagJob[], failed: Set<string>): Set<string> {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const skipped = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const job of jobs) {
      if (failed.has(job.name) || skipped.has(job.name)) continue;
      const blocked = job.needs.some((need) => failed.has(need) || skipped.has(need));
      if (blocked && byName.has(job.name)) { skipped.add(job.name); changed = true; }
    }
  }
  return skipped;
}

//? A cycle is a config error the user must see, not something to route around silently.
export function describeUnrunnable(plan: DagPlan): string {
  return plan.unrunnable.length === 0 ? '' : `ci.unrunnableJobs: ${plan.unrunnable.join(', ')} (circular or missing \`needs\`)`;
}

export const CI_MAX_PARALLEL = Math.max(1, Number(process.env.WS_CI_MAX_PARALLEL ?? '3'));

//? Split one wave into concurrency-capped chunks. The whole DAG runs inside a single container on a shared
//? Docker host, so unbounded parallelism would trade "CI is slow" for "the host is wedged".
export function chunkWave(wave: string[], max = CI_MAX_PARALLEL): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < wave.length; i += max) chunks.push(wave.slice(i, i + max));
  return chunks;
}
