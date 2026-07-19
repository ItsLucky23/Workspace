//? StudioBrief mutation lock. Studio remains an ADR-0033 direct writer, but begin-generation and
//? brief deletion must serialize per brief across app instances so a deleted brief cannot gain an
//? orphan artifact. The Redis lease has a bounded wait + TTL and releases owner-safely.

import { acquireLease, formatKey, releaseLease, tryCatch } from '@luckystack/core';

const STUDIO_BRIEF_LOCK_TTL_MS = 15_000;
const STUDIO_BRIEF_LOCK_RETRY_MS = 25;
const STUDIO_BRIEF_LOCK_MAX_WAIT_MS = 5000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const briefLockKey = (workspaceId: string, briefId: string): string =>
  formatKey('studio-brief-lock', `${workspaceId}:${briefId}`);

export async function withStudioBriefLock<T>(
  workspaceId: string,
  briefId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = briefLockKey(workspaceId, briefId);
  const deadline = Date.now() + STUDIO_BRIEF_LOCK_MAX_WAIT_MS;
  let token: string | null = null;
  while (token === null && Date.now() < deadline) {
    token = await acquireLease(key, STUDIO_BRIEF_LOCK_TTL_MS);
    if (token === null) await sleep(Math.min(STUDIO_BRIEF_LOCK_RETRY_MS, Math.max(1, deadline - Date.now())));
  }
  if (token === null) throw new Error('[studio] brief lock acquisition timed out');

  const [actionError, outcome] = await tryCatch(async () => ({ value: await fn() }));
  const [releaseError, released] = await tryCatch(() => releaseLease(key, token));
  if (releaseError || released !== true) throw new Error('[studio] brief lock owner release failed');
  if (actionError) throw actionError;
  if (!outcome) throw new Error('[studio] brief lock action returned no outcome');
  return outcome.value;
}
