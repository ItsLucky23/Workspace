//? GAP_SCAN A5/A6 — the two PURE halves of "are all my channels still posting?".
//?
//? A5 (health): a channel posts through a (platform, accountId) pair, but a PublishJob only records that
//? pair — never the channel. This folds the job history back onto the channels so the UI can answer
//? "which channel stopped working, and since when" at a glance, instead of the user finding out because a
//? week went by with no posts.
//?
//? A6 (staggering): many autopilot posts can come due in one scheduler tick. Firing them back-to-back on the
//? same account is exactly what platform quotas punish, so all but the first per account are pushed out over
//? a spacing interval.
//?
//? Both are pure so they can be tested without Mongo, a clock, or a platform.

export const PUBLISH_STAGGER_MS = Math.max(0, Number(process.env.WS_PUBLISH_STAGGER_MIN ?? '5')) * 60_000;

//? The identity a platform actually rate-limits: one connected account on one platform.
export const accountKey = (platform: string, accountId: string | null | undefined): string => `${platform}::${accountId ?? ''}`;

/* ------------------------------------------------------------------ A5: per-channel health */

export interface HealthJobLite {
  platform: string;
  accountId: string | null;
  status: string;
  error: string | null;
  updatedAt: Date;
}

export interface HealthChannelLite {
  id: string;
  name: string;
  platform: string;
  defaultAccountId: string | null;
}

//? `down` — the channel cannot post right now (dead OAuth, or its latest attempt failed and nothing has
//? succeeded since). `warn` — it recovered but failed at least once recently. `idle` — never posted.
export type ChannelHealthState = 'ok' | 'warn' | 'down' | 'idle';

export interface ChannelHealth {
  channelId: string;
  name: string;
  platform: string;
  accountId: string | null;
  state: ChannelHealthState;
  posts: number;
  failures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  needsReconnect: boolean;
}

const isSuccess = (status: string): boolean => status === 'done' || status === 'stub';

export function buildChannelHealth(
  channels: HealthChannelLite[],
  jobs: HealthJobLite[],
  //? The `accountKey`s flagged by A4's connection-health markers.
  unhealthyAccounts = new Set<string>(),
): ChannelHealth[] {
  const byAccount = new Map<string, HealthJobLite[]>();
  for (const j of jobs) {
    const key = accountKey(j.platform, j.accountId);
    const list = byAccount.get(key) ?? [];
    list.push(j);
    byAccount.set(key, list);
  }

  return channels.map((c) => {
    const key = accountKey(c.platform, c.defaultAccountId);
    const mine = byAccount.get(key) ?? [];
    const needsReconnect = unhealthyAccounts.has(key);

    let posts = 0;
    let failures = 0;
    let lastSuccessAt: number | null = null;
    let lastFailureAt: number | null = null;
    let lastError: string | null = null;
    for (const j of mine) {
      const at = j.updatedAt.getTime();
      if (isSuccess(j.status)) {
        posts += 1;
        if (lastSuccessAt === null || at > lastSuccessAt) lastSuccessAt = at;
      } else if (j.status === 'error') {
        failures += 1;
        if (lastFailureAt === null || at > lastFailureAt) { lastFailureAt = at; lastError = j.error; }
      }
    }

    const stalled = lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt);
    const healthy: ChannelHealthState = failures > 0 ? 'warn' : 'ok';
    const state: ChannelHealthState = needsReconnect || stalled ? 'down' : (posts === 0 && failures === 0 ? 'idle' : healthy);

    return { channelId: c.id, name: c.name, platform: c.platform, accountId: c.defaultAccountId, state, posts, failures, lastSuccessAt, lastFailureAt, lastError, needsReconnect };
  });
}

/* ------------------------------------------------------------------ A6: burst staggering */

export interface StaggerJobLite { id: string; platform: string; accountId: string | null }

//? Per account: the first due job fires now, the rest are pushed out one spacing interval apart. Returns
//? only the jobs to DEFER (id → new scheduledAt ms), so the caller's happy path stays untouched.
export function staggerPlan(due: StaggerJobLite[], now: number, spacingMs = PUBLISH_STAGGER_MS): Map<string, number> {
  const deferred = new Map<string, number>();
  if (spacingMs <= 0) return deferred;
  const seen = new Map<string, number>();
  for (const job of due) {
    const key = accountKey(job.platform, job.accountId);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    if (index > 0) deferred.set(job.id, now + index * spacingMs);
  }
  return deferred;
}
