import { randomBytes } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';
import { docker, dockerAvailable } from '../../../server/container/runtime';
import { MEDIA_DIR } from '../../../server/media/store';
import { saveConnection } from '../../../server/content/publishOAuth';

//? Per-route tests for `workspaces/contentControl/v1` — the content-generation control-op
//? gateway (create/advance/archive + every gen op, whitelisted to `CONTENT_OPS`). Covers:
//?  [1] happy path — `content-create` dispatched through the Conductor; asserted via the
//?      real Prisma post-condition (a `ContentProject` row), not just the ack.
//?  [2] the op whitelist itself — an op outside `CONTENT_OPS` (e.g. a settings-only op) is
//?      rejected with `sync.invalidRequest` before it ever reaches the Conductor/RBAC.
//?  [3] `studio-unpublish-site` — the Conductor's plain `PublishedSite.deleteMany` write;
//?      asserted via the REAL Prisma post-condition (row gone), not just the ack. The
//?      fixture `PublishedSite` row is seeded directly (unpublish never dereferences the
//?      source `StudioArtifact`).
//?  [4] `studio-publish-site` — `publishArtifactSite` reads a real, `status: 'ready'`
//?      `StudioArtifact` (`content: { html }`) and upserts a `PublishedSite`; asserted via
//?      the REAL Prisma post-condition (a `PublishedSite` row pointing at the artifact),
//?      not just the ack.
//?  [5] `content-trim-audio` — a REAL ffmpeg trim (Docker) of a generated source audio asset:
//?      asserts the trimmed sibling `ContentAsset` (gain applied, chained via `parentId`).
//?  [6] `content-reply-comment` — real Conductor dispatch with a real `Channel` + saved
//?      publish connection + `SocialComment` fixture. TikTok has no public reply endpoint
//?      (`buildReplyRequest` returns null deterministically, no network call), so this proves
//?      the op reaches `postReply` and the `SocialComment.read` post-condition stays untouched
//?      on failure. A genuine SUCCESS post-condition needs a live YouTube OAuth connection.
//?  [7] regression for the former target/payload split: scene-save + audio-mix cases read the piece id
//?      from payload while this gateway also uses target for mixed legacy cases. Both now receive the same
//?      top-level `contentProjectId` and prove real Prisma post-conditions (never success-without-effect).

//? A valid-shape (24-hex) Mongo ObjectId string that doesn't need to reference a real row.
const fakeObjectId = (): string => randomBytes(12).toString('hex');

interface ContentControlInput {
  op: string; clientRequestId: string;
  projectId?: string; title?: string; slug?: string; artifactId?: string;
  contentProjectId?: string; assetId?: string; prompt?: string; referenceUrl?: string;
  headline?: string; startMs?: number; endMs?: number; gain?: number;
  scenes?: { id?: string; durationMs?: number; prompt?: string }[];
  voiceVolume?: number; musicVolume?: number;
  commentId?: string; replyText?: string;
}
interface ContentControlOk { status: 'success' }
interface ContentControlErr { status: 'error'; errorCode: string }
type ContentControlResponse = ContentControlOk | ContentControlErr;

//? A real (tiny, solid-colour) PNG on disk: the sweep runs against the KEYED dev server, so the edit op
//? reaches the live image provider, which rejects a reference that is not an actual image (422).
function writeSolidPng(file: string, size = 256): void {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xED_B8_83_20 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer): number => { let c = 0xFF_FF_FF_FF; for (const b of buf) c = (crcTable[(c ^ b) & 0xFF] ?? 0) ^ (c >>> 8); return (c ^ 0xFF_FF_FF_FF) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x4A)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: content-create persists a ContentProject (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c1');
      try {
        await joinRoom(ctx, workspaceId);
        //? `ContentProject.projectId` is `@db.ObjectId` — it points at the seeded demo `Project` row,
        //? not an arbitrary string (an invalid ObjectId here throws inside the Conductor's write and
        //? surfaces as `sync.invalidRequest`, not a Prisma error).
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seeded demo workspace ships at least one Project');
        if (!project) return;
        const projectId = project.id;
        const title = `Sync harness content ${String(Date.now())}`;
        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'content-create', clientRequestId: `cc-c1-${String(Date.now())}`, projectId, title },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'contentControl returns status "success"');

        const piece = await poll(() => ctx.prisma.contentProject.findFirst({ where: { workspaceId, projectId } }));
        ctx.expect.ok(piece !== null, 'the Conductor persisted the ContentProject (post-condition, not just the ack)');
        ctx.expect.eq(piece?.title, title, 'the persisted piece carries the title we sent');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an op outside the content-op whitelist is rejected before reaching the Conductor',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'edit-media-budget', clientRequestId: `cc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an op outside CONTENT_OPS is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected with sync.invalidRequest (whitelist check), not auth/Conductor error');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'studio-unpublish-site deletes the PublishedSite row (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c3');
      try {
        await joinRoom(ctx, workspaceId);
        const slug = `harness-site-${String(Date.now())}`;
        await ctx.prisma.publishedSite.create({
          data: { workspaceId, artifactId: fakeObjectId(), slug, title: 'Harness site', html: '<html></html>' },
        });

        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'studio-unpublish-site', clientRequestId: `cc-c3-${String(Date.now())}`, slug },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'studio-unpublish-site returns status "success"');

        //? `poll()` stops on the first non-null/undefined value, so poll for the row's ABSENCE by
        //? returning a sentinel once it's gone (a `null` Prisma result would otherwise be read as "not ready yet").
        const gone = await poll(async () => {
          const row = await ctx.prisma.publishedSite.findFirst({ where: { workspaceId, slug } });
          return row === null ? ('gone' as const) : null;
        });
        ctx.expect.ok(gone === 'gone', 'the Conductor deleted the PublishedSite row (post-condition, not just the ack)');
      } finally {
        await ctx.prisma.publishedSite.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'studio-publish-site upserts a PublishedSite for a ready StudioArtifact (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c4');
      try {
        await joinRoom(ctx, workspaceId);
        const brief = await ctx.prisma.studioBrief.create({
          data: { workspaceId, name: 'Harness brief', productName: 'Nova', audience: 'devs', tone: 'confident', goals: 'grow' },
        });
        const artifact = await ctx.prisma.studioArtifact.create({
          data: {
            workspaceId, briefId: brief.id, kind: 'landing', role: 'designer',
            title: `Harness landing ${String(Date.now())}`, content: { html: '<html><body>hi</body></html>' }, status: 'ready',
          },
        });

        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'studio-publish-site', clientRequestId: `cc-c4-${String(Date.now())}`, artifactId: artifact.id },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'studio-publish-site returns status "success"');

        const site = await poll(() => ctx.prisma.publishedSite.findFirst({ where: { workspaceId, artifactId: artifact.id } }));
        ctx.expect.ok(site !== null, 'the Conductor persisted the PublishedSite (post-condition, not just the ack)');
        ctx.expect.eq(site?.title, artifact.title, 'the persisted site carries the artifact title');
      } finally {
        await ctx.prisma.publishedSite.deleteMany({ where: { workspaceId } });
        await ctx.prisma.studioArtifact.deleteMany({ where: { workspaceId } });
        await ctx.prisma.studioBrief.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'content-trim-audio produces a trimmed sibling asset via a REAL ffmpeg trim (Docker, Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c7');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seeded demo workspace ships at least one Project');
        if (!project) return;
        const piece = await ctx.prisma.contentProject.create({
          data: { workspaceId, projectId: project.id, title: `Trim-audio piece ${String(Date.now())}`, brief: 'x' },
        });

        //? Generate a 2s source audio file (a sine tone) directly in the served media dir via ffmpeg-in-Docker —
        //? the same real-ffmpeg approach the content-transcode sibling test uses.
        const srcName = `cc-c7-src-${String(Date.now())}.mp3`;
        const gen = await docker(['run', '--rm', '-v', `${MEDIA_DIR.replaceAll('\\', '/')}:/media`, (process.env.WS_FFMPEG_IMAGE ?? '').trim() || 'jrottenberg/ffmpeg:latest', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', `/media/${srcName}`]);
        ctx.expect.eq(gen.code, 0, 'generated a source audio file with ffmpeg');
        const srcUrl = `/media/${srcName}`;
        const src = await ctx.prisma.contentAsset.create({ data: { workspaceId, contentProjectId: piece.id, kind: 'voice', url: srcUrl, status: 'ready' } });

        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          {
            op: 'content-trim-audio', clientRequestId: `cc-c7-${String(Date.now())}`,
            contentProjectId: piece.id, assetId: src.id, startMs: 0, endMs: 1000, gain: 1.5,
          },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'content-trim-audio returns status "success"');

        const trimmed = await poll(() => ctx.prisma.contentAsset.findFirst({ where: { workspaceId, contentProjectId: piece.id, parentId: src.id } }), 15_000);
        ctx.expect.ok(trimmed !== null, 'the Conductor persisted the trimmed sibling ContentAsset (post-condition, not just the ack)');
        ctx.expect.eq(trimmed?.kind, 'voice', 'the trimmed asset keeps the source kind');
        ctx.expect.ok((trimmed?.url ?? '').includes('-trim-'), 'the trimmed asset url carries the ffmpeg trim suffix (a real new file, not the source reused)');
      } finally {
        await ctx.prisma.contentAsset.deleteMany({ where: { workspaceId } });
        await ctx.prisma.contentProject.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'top-level contentProjectId reaches payload-only content cases (no silent success)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c9');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seeded demo workspace ships at least one Project');
        if (!project) return;
        const piece = await ctx.prisma.contentProject.create({ data: { workspaceId, projectId: project.id, title: 'Payload regression', brief: 'x' } });

        const sceneRes = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'content-save-scenes', clientRequestId: `cc-c9-scenes-${String(Date.now())}`, contentProjectId: piece.id, scenes: [{ durationMs: 2345, prompt: 'real scene' }] },
          { receiver: workspaceId },
        );
        ctx.expect.eq(sceneRes.status, 'success', 'content-save-scenes returns success');
        const scene = await poll(() => ctx.prisma.videoScene.findFirst({ where: { workspaceId, contentProjectId: piece.id } }));
        ctx.expect.ok(scene !== null, 'content-save-scenes persisted a VideoScene instead of silently no-oping');
        ctx.expect.eq(scene?.durationMs, 2345, 'the scene payload reached the Conductor');

        const mixRes = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'content-save-audio-mix', clientRequestId: `cc-c9-mix-${String(Date.now())}`, contentProjectId: piece.id, voiceVolume: 1.4, musicVolume: 0.3 },
          { receiver: workspaceId },
        );
        ctx.expect.eq(mixRes.status, 'success', 'content-save-audio-mix returns success');
        const mixed = await poll(async () => {
          const row = await ctx.prisma.contentProject.findFirst({ where: { workspaceId, id: piece.id } });
          return row?.voiceVolume === 1.4 && row.musicVolume === 0.3 ? row : null;
        });
        ctx.expect.ok(mixed !== null, 'audio gains persisted instead of silently no-oping');
      } finally {
        await ctx.prisma.videoScene.deleteMany({ where: { workspaceId } });
        await ctx.prisma.contentProject.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    //? F5 — no honest way to prove a SUCCESSFUL post in this harness: YouTube is the only platform
    //? `buildReplyRequest` supports, and posting for real needs a live OAuth access token + a real
    //? googleapis.com call this harness cannot provide. TikTok is deterministic and network-free
    //? (`buildReplyRequest` returns null — "no public reply endpoint" — before any fetch), so this
    //? proves the REAL dispatch path (RBAC → Conductor → postReply, with a real Channel + saved
    //? connection + SocialComment fixture) and asserts the post-condition that actually IS provable
    //? here: on a platform-unsupported failure, the comment's `read` flag is left untouched.
    name: 'content-reply-comment reaches postReply via the real dispatch path and leaves the comment unread on failure (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c8');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seeded demo workspace ships at least one Project');
        if (!project) return;
        const channel = await ctx.prisma.channel.create({ data: { workspaceId, projectId: project.id, name: 'Harness channel', platform: 'tiktok' } });
        await saveConnection(ctx.prisma, workspaceId, 'tiktok', { accessToken: 'dummy-token' });
        const comment = await ctx.prisma.socialComment.create({
          data: {
            workspaceId, platform: 'tiktok', channelId: channel.id, externalVideoId: 'v1',
            externalId: `cc-c8-${String(Date.now())}`, author: 'someone', text: 'nice video', publishedAt: new Date(), read: false,
          },
        });

        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'content-reply-comment', clientRequestId: `cc-c8-${String(Date.now())}`, commentId: comment.id, replyText: 'Thanks for watching!' },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'the op reaches the Conductor and postReply, which fails deterministically (TikTok has no public reply endpoint)');

        const stillUnread = await ctx.prisma.socialComment.findFirst({ where: { id: comment.id } });
        ctx.expect.eq(stillUnread?.read, false, 'the comment was NOT marked read (postReply only flips `read` after a successful post — no fabricated success)');
      } finally {
        await ctx.prisma.socialComment.deleteMany({ where: { workspaceId } });
        await ctx.prisma.channel.deleteMany({ where: { workspaceId } });
        await ctx.prisma.envVar.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'content image and thumbnail ops persist real assets through the content ID envelope',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c10');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seeded demo workspace ships at least one Project');
        if (!project) return;
        const piece = await ctx.prisma.contentProject.create({ data: { workspaceId, projectId: project.id, title: `Image envelope ${String(Date.now())}`, brief: 'x' } });
        const sourceFile = path.join(MEDIA_DIR, 'envelope-source.png');
        writeSolidPng(sourceFile);
        const source = await ctx.prisma.contentAsset.create({ data: { workspaceId, contentProjectId: piece.id, kind: 'image', url: '/media/envelope-source.png', status: 'ready' } });

        const editRes = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'content-edit-image', clientRequestId: `cc-c10-edit-${String(Date.now())}`, contentProjectId: piece.id, assetId: source.id, prompt: 'make the sky purple' },
          { receiver: workspaceId },
        );
        ctx.expect.eq(editRes.status, 'success', 'content-edit-image returns success');
        const edited = await poll(() => ctx.prisma.contentAsset.findFirst({ where: { workspaceId, contentProjectId: piece.id, parentId: source.id } }));
        ctx.expect.ok(edited !== null, 'content-edit-image persisted a new asset through the payload contentProjectId');
        ctx.expect.eq(edited?.kind, 'image', 'the edited asset is an image');

        if (!(await dockerAvailable())) {
          console.log('[contentcontrol_c10] Docker unavailable — skipping the thumbnail post-condition.');
          return;
        }
        const thumbnailRes = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'content-gen-thumbnail', clientRequestId: `cc-c10-thumb-${String(Date.now())}`, contentProjectId: piece.id, headline: 'A real headline' },
          { receiver: workspaceId },
        );
        ctx.expect.eq(thumbnailRes.status, 'success', 'content-gen-thumbnail returns success');
        const thumbnail = await poll(() => ctx.prisma.contentAsset.findFirst({ where: { workspaceId, contentProjectId: piece.id, kind: 'thumbnail' } }), 15_000);
        ctx.expect.ok(thumbnail !== null, 'content-gen-thumbnail persisted a thumbnail through the payload contentProjectId');
      } finally {
        const sourceFile = path.join(MEDIA_DIR, 'envelope-source.png');
        if (existsSync(sourceFile)) unlinkSync(sourceFile);
        await ctx.prisma.contentAsset.deleteMany({ where: { workspaceId } });
        await ctx.prisma.contentProject.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
