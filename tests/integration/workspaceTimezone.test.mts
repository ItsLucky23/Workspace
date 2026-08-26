//? Integration test for the WIRING half of ADR 0328's timezone work, against the REAL Mongo.
//?
//? `tests/unit/dateTz.test.mts` already proves the date MATH (DST, date line, month anchors). What it
//? cannot prove is the part that actually broke for users: that `Workspace.timezone` reaches the code doing
//? that math. A perfectly correct `dayKeyInTz` still produces UTC buckets if the snapshot forgets to pass
//? the zone — which is exactly what every one of these surfaces did before this change.
//?
//? So this drives `buildSnapshot` — the real read path the client renders — with ONE fixed spend row and
//? flips only the workspace's zone, then asserts the derived buckets moved. Same data, different day: that
//? is the whole feature, and it is only true if the wiring is intact end to end.
//?
//? Run: `npx tsx tests/integration/workspaceTimezone.test.mts`.

import { db, cleanupWorkspace, createRealUser, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { bootstrapWorkspace } = await import('../../server/orchestrator/conductor');

const stamp = Date.now();
const owner = await createRealUser(prisma, `wstz-${String(stamp)}`);
let workspaceId: string | null = null;

//? An instant chosen so the calendar DATE genuinely differs by zone: 22:30 UTC is already the next day in
//? Tokyo (+9) while still the previous evening in Los Angeles (-7/-8). Anchored to yesterday so it stays
//? inside the 7-day window the usage panel reads no matter what time this test runs.
const yesterday = new Date(Date.now() - 86_400_000);
const spendAt = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), 22, 30, 0));

const setZone = async (zone: string): Promise<void> => {
  await prisma.workspace.update({ where: { id: workspaceId ?? '' }, data: { timezone: zone } });
};
const usageFor = async (zone: string): Promise<{ activity: { day: string; tokens: number }[]; total: number }> => {
  await setZone(zone);
  const snap = await buildSnapshot(prisma, owner.id, workspaceId ?? undefined);
  return { activity: snap.usage.activity, total: snap.usage.totalTokens };
};

try {
  const boot = await bootstrapWorkspace({ name: `WS Timezone Test ${String(stamp)}`, ownerId: owner.id });
  workspaceId = boot.workspaceId;

  await prisma.spendRecord.create({
    data: {
      workspaceId, userId: owner.id, sessionKey: `wstz-${String(stamp)}`,
      tokensIn: 700, tokensOut: 300, model: 'e2e-tz-model', costEstimate: 0, createdAt: spendAt,
    },
  });

  // ---- 1. the same row lands on a DIFFERENT weekday depending on the workspace zone ----
  const tokyo = await usageFor('Asia/Tokyo');
  const la = await usageFor('America/Los_Angeles');

  eq(tokyo.total, 1000, 'the spend row is counted in full regardless of zone (the zone moves it, never drops it)');
  eq(la.total, 1000, 'the same row is still counted in full in the western zone');
  eq(tokyo.activity.length, 7, 'the activity panel is always exactly 7 calendar days');
  eq(la.activity.length, 7, 'the western zone gets 7 days too — the window is calendar-based, not 168 hours');

  const dayOf = (activity: { day: string; tokens: number }[]): string => activity.find((d) => d.tokens > 0)?.day ?? '';
  assert(dayOf(tokyo.activity) !== '', 'the spend row shows up somewhere in the Tokyo week');
  assert(dayOf(la.activity) !== '', 'the spend row shows up somewhere in the Los Angeles week');
  //? 22:30 UTC is the NEXT day in Tokyo and the SAME day in Los Angeles, so the weekday label must differ.
  //? This is the assertion that fails the moment someone drops the `tz` argument on the way to aggregateUsage.
  assert(
    dayOf(tokyo.activity) !== dayOf(la.activity),
    'one instant falls on a different weekday per zone — the workspace zone really reaches the usage buckets',
  );

  // ---- 2. UTC is the fail-closed default, never a crash --------------------------
  const utc = await usageFor('UTC');
  eq(utc.total, 1000, 'a UTC workspace aggregates normally');
  const broken = await usageFor('Not/AZone');
  eq(broken.total, 1000, 'an unusable stored zone still aggregates (reads fail CLOSED to UTC, they never throw)');
  eq(dayOf(broken.activity), dayOf(utc.activity), 'a broken zone buckets exactly like UTC rather than producing nonsense');

  // ---- 3. the snapshot hands the client the zone + the pricing map ---------------
  await setZone('Europe/Amsterdam');
  await prisma.workspace.update({ where: { id: workspaceId }, data: { pricing: { 'e2e-tz-model': 1.5, bogus: 'not-a-number' } } });
  const snap = await buildSnapshot(prisma, owner.id, workspaceId);
  const ws = snap.workspaces.find((w) => w.id === workspaceId);
  eq(ws?.timezone, 'Europe/Amsterdam', 'the snapshot carries the stored zone to the client (this is what useWorkspaceTimeZone reads)');
  eq(ws?.pricing?.['e2e-tz-model'], 1.5, 'the snapshot carries the per-model price map to the pricing panel');
  eq(Object.hasOwn(ws?.pricing ?? {}, 'bogus'), false, 'a non-numeric price is sanitised away rather than reaching the UI as junk');

  // ---- 4. sprint days are workspace days, not UTC days ---------------------------
  //? A sprint stored as a bare calendar day must READ BACK as that same day. Storing midnight in one zone and
  //? formatting it in another is the classic "ends a day early" bug, and it is the reason the sprint labels
  //? go through dayKeyInTz at all.
  const sprintEnd = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), 22, 0, 0));
  //? bootstrapWorkspace does not seed a project (that is the onboarding flow's job), and a Sprint belongs to
  //? a project's board — so the fixture makes its own.
  const project = await prisma.project.create({ data: { workspaceId, name: `TZ Project ${String(stamp)}`, gitlabPath: `tz/${String(stamp)}` } });
  await prisma.sprint.create({ data: { workspaceId, projectId: project.id, name: `TZ Sprint ${String(stamp)}`, startAt: spendAt, endAt: sprintEnd, active: true } });
  const amsterdam = await buildSnapshot(prisma, owner.id, workspaceId);
  const sprint = amsterdam.sprints.find((s) => s.name === `TZ Sprint ${String(stamp)}`);
  assert(sprint !== undefined, 'the sprint reaches the snapshot');
  eq(typeof sprint?.end, 'string', 'the sprint end is rendered as a calendar day string, not a raw instant');
  eq(sprint?.end?.length, 10, 'the sprint day label is a bare YYYY-MM-DD (10 chars) in the workspace zone');

  //? Compared against UTC, not against Amsterdam: at 22:00 UTC an Amsterdam summer clock (+2) has ALREADY
  //? rolled past midnight, so Amsterdam and UTC+14 land on the same calendar day and would prove nothing.
  await setZone('UTC');
  const utcSnap = await buildSnapshot(prisma, owner.id, workspaceId);
  const sprintUtc = utcSnap.sprints.find((s) => s.name === `TZ Sprint ${String(stamp)}`);
  await setZone('Pacific/Kiritimati'); // UTC+14 — the furthest-forward zone there is.
  const kiritimati = await buildSnapshot(prisma, owner.id, workspaceId);
  const sprintFar = kiritimati.sprints.find((s) => s.name === `TZ Sprint ${String(stamp)}`);
  assert(
    sprintFar?.end !== sprintUtc?.end,
    'a 22:00 UTC sprint end reads as a LATER calendar day at UTC+14 — sprint labels follow the workspace zone too',
  );
  //? And Amsterdam, being past midnight at that instant, must agree with UTC+14 rather than with UTC: the
  //? label follows the CLOCK in the zone, not a fixed offset bucket.
  eq(sprint?.end, sprintFar?.end, 'a zone already past midnight at that instant reads the same day as UTC+14');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: `lstest_wstz-` } } }).catch(() => undefined);
}

report('tests/integration/workspaceTimezone.test.mts');
