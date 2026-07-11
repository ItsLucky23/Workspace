//? intent: a content piece's detail — its stage/status, the generation controls (write · voice · images ·
//? video · music · 3D · assemble) with a style + free-form direction, and an asset area — the place a
//? non-technical user turns a brief into finished media, each generation confirmed (it may cost money).

import { useEffect, useMemo, useState } from 'react';

import { useTranslator, i18nNotify as notify } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon, { type IconName } from '../../_components/Icon';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { EmptyState, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import ImageRegionEditor from '../../_components/ImageRegionEditor';
import ImageEditor from '../../_components/ImageEditor';
import VideoTimelineEditor from '../../_components/VideoTimelineEditor';
import type { ContentAssetSummary } from '../../_data/types';
import { backendUrl } from '../../../../config';

export const template = 'workspaces';

//? Asset kind → icon (unknown kinds fall back to the generic file icon).
const ASSET_ICON: Record<string, IconName> = {
  image: 'table-cells-large', render: 'display', video: 'display', voice: 'wave-square',
  music: 'wave-square', sfx: 'wave-square', avatar: 'user', 'model-3d': 'box-archive', script: 'file-lines',
};

//? A downloadable/openable href for an asset: `/media/<file>` is served by the backend (prefix its origin),
//? a hosted `http(s)` url is used as-is, and a `stub://` (dummy-mode) url is not openable → null.
function assetHref(url: string): string | null {
  if (url.startsWith('/media/')) return `${backendUrl}${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return null;
}

//? A generation action: its content-op + label + icon + whether it needs the reference url / a prompt.
//? `costFeature` maps the action to the media feature whose € estimate we show BEFORE the user spends (Q1);
//? `perItem` = the cost is per produced unit (per-beat images), shown as "≈ €X / item".
interface GenAction { op: string; labelKey: string; icon: IconName; needsRef?: boolean; needsPrompt?: boolean; costFeature?: string; perItem?: boolean }
const ACTIONS: GenAction[] = [
  //? M1/M3 — the one-shot whole-video pipeline (script → voice → styled scenes → assemble). This is the ONLY
  //? op that consumes the style picker + the length picker (styleKey + durationMs), so it must be reachable.
  { op: 'content-run-pipeline', labelKey: 'workspaces.content.actPipeline', icon: 'wand-magic-sparkles', costFeature: 'video-gen' },
  { op: 'content-gen-script', labelKey: 'workspaces.content.actScript', icon: 'file-lines' },
  { op: 'content-gen-voice', labelKey: 'workspaces.content.actVoice', icon: 'wave-square', costFeature: 'tts' },
  { op: 'content-gen-images', labelKey: 'workspaces.content.actImages', icon: 'table-cells-large', costFeature: 'image-gen', perItem: true },
  { op: 'content-gen-reference-image', labelKey: 'workspaces.content.actReferenceImage', icon: 'wand-magic-sparkles', needsRef: true, costFeature: 'reference-image' },
  { op: 'content-gen-shortform', labelKey: 'workspaces.content.actShortform', icon: 'wand-magic-sparkles', needsPrompt: true, costFeature: 'video-gen' },
  { op: 'content-gen-music', labelKey: 'workspaces.content.actMusic', icon: 'wave-square', costFeature: 'music' },
  { op: 'content-gen-sfx', labelKey: 'workspaces.content.actSfx', icon: 'wave-square', costFeature: 'sfx' },
  { op: 'content-gen-3d', labelKey: 'workspaces.content.act3d', icon: 'box-archive', costFeature: 'model-3d' },
  { op: 'content-assemble', labelKey: 'workspaces.content.actAssemble', icon: 'diagram-project' },
];

//? Cents → a short € label (e.g. 40 → "€0.40"). Shared by the action chips + the confirm.
const euro = (cents: number): string => `€${(cents / 100).toFixed(2)}`;

//? A publishable asset is a finished, reachable video/render (the thing you post to a platform).
const isPublishable = (asset: ContentAssetSummary): boolean => (asset.kind === 'render' || asset.kind === 'video') && asset.status === 'ready';

//? mm:ss elapsed since the job LEFT the queue (startedAt), for the live generation timer.
function elapsedLabel(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

//? Live generation state for an in-flight asset. QUEUED → a pulsing "in queue · position N" (NO
//? timer — the job hasn't started). PROCESSING → an elapsed timer that ticks from `startedAt` (the
//? moment the job left the provider queue). This is the whole point: the timer never starts while
//? the job is only queued.
function GenProgress({ asset, translate }: { asset: ContentAssetSummary; translate: ReturnType<typeof useTranslator> }) {
  const processing = asset.status === 'processing';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(t); };
  }, [processing]);
  if (asset.status === 'queued') {
    return (
      <div className="flex flex-col items-center gap-1.5 text-muted">
        <Icon name="clock" className="text-xl animate-pulse" />
        <span className="text-[11px] font-medium text-center px-1">
          {asset.queuePosition == null
            ? translate({ key: 'workspaces.content.queued' })
            : translate({ key: 'workspaces.content.queuePos', params: [{ key: 'n', value: asset.queuePosition }] })}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5 text-primary">
      <span className="w-5 h-5 rounded-full border-2 border-container2-border border-t-primary animate-spin" />
      <span className="text-[11px] font-medium tabular-nums">
        {asset.startedAt ? elapsedLabel(asset.startedAt, now) : translate({ key: 'workspaces.content.generating' })}
      </span>
    </div>
  );
}

//? One produced asset: a thumbnail for openable images, else an icon, with its kind + a stub/status badge,
//? an open/download link when reachable, and — for a finished render — a publish button per connected
//? platform (fires content-request-publish behind a confirm; the actual post is B-23-gated on accept).
//? G1/CP1 — the publish composer form: caption + hashtags + privacy + optional schedule for ONE platform.
//? Submits the fields to content-request-publish (G1 persists them as the per-platform publishVariant).
function PublishComposer({ platform, onSubmit, translate }: { platform: string; onSubmit: (fields: { caption?: string; hashtags?: string[]; privacy?: string; scheduledAt?: string }) => void; translate: ReturnType<typeof useTranslator> }) {
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [scheduledAt, setScheduledAt] = useState('');
  const inputCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary w-full';
  const privItems = (['public', 'unlisted', 'private'] as const).map((p) => ({ id: p, value: p, item: translate({ key: `workspaces.publish.priv_${p}` }) }));
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title capitalize">{translate({ key: 'workspaces.publish.title', params: [{ key: 'platform', value: platform }] })}</div>
      <textarea value={caption} onChange={(e) => { setCaption(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.publish.captionPh' })} className="w-full px-3 py-2 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary" />
      <input value={hashtags} onChange={(e) => { setHashtags(e.target.value); }} placeholder={translate({ key: 'workspaces.publish.hashtagsPh' })} className={inputCls} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-common">{translate({ key: 'workspaces.publish.privacy' })}</span>
        <Dropdown size="sm" items={privItems} value={privItems.find((it) => it.id === privacy)} onChange={(it) => { setPrivacy(String(it.value)); }} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-common">{translate({ key: 'workspaces.publish.schedule' })}</span>
        <input type="datetime-local" value={scheduledAt} onChange={(e) => { setScheduledAt(e.target.value); }} className="h-9 px-2 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary" />
      </div>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="paper-plane" onClick={() => {
          const tags = hashtags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter((t) => t.length > 0);
          onSubmit({ ...(caption.trim() ? { caption: caption.trim() } : {}), ...(tags.length > 0 ? { hashtags: tags } : {}), privacy, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}) });
        }}>{translate({ key: scheduledAt ? 'workspaces.publish.scheduleBtn' : 'workspaces.publish.publishBtn' })}</WsButton>
      </div>
    </div>
  );
}

//? F9 — audio-editor-lite: trim a standalone audio asset (start/end over its REAL duration, read from the
//? <audio> metadata) + a linear gain, then fire content-trim-audio (local ffmpeg, no provider cost). Props-
//? injected (menuHandler renders ABOVE WorkspacesProvider — lesson 0011 — so it must not call useWorkspaces).
function AudioTrimEditor({ src, onSubmit, translate }: { src: string; onSubmit: (f: { startMs: number; endMs: number; gain: number }) => void; translate: ReturnType<typeof useTranslator> }) {
  const [dur, setDur] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [gain, setGain] = useState(1);
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.audioEditor.title' })}</div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a user's own audio asset has no caption track to add; this is an editing preview */}
      <audio controls src={src} onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) { setDur(d); setEnd(d); } }} className="w-full" />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{translate({ key: 'workspaces.audioEditor.start' })}: {start.toFixed(1)}s</span>
        <input type="range" min={0} max={dur || 1} step={0.1} value={start} onChange={(e) => { setStart(Math.max(0, Math.min(Number(e.target.value), end - 0.1))); }} className="accent-primary" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{translate({ key: 'workspaces.audioEditor.end' })}: {end.toFixed(1)}s</span>
        <input type="range" min={0} max={dur || 1} step={0.1} value={end} onChange={(e) => { setEnd(Math.min(dur, Math.max(Number(e.target.value), start + 0.1))); }} className="accent-primary" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{translate({ key: 'workspaces.audioEditor.gain' })}: {gain.toFixed(2)}×</span>
        <input type="range" min={0} max={2} step={0.05} value={gain} onChange={(e) => { setGain(Number(e.target.value)); }} className="accent-primary" />
      </label>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="scissors" disabled={dur <= 0 || end <= start} onClick={() => { onSubmit({ startMs: Math.round(start * 1000), endMs: Math.round(end * 1000), gain }); }}>{translate({ key: 'workspaces.audioEditor.apply' })}</WsButton>
      </div>
    </div>
  );
}

function AssetCard({ asset, connectedPlatforms, onPublish, onRegenerate, onEditRegion, onEditImage, onCritique, onInstructEdit, onRestyle, onTrimAudio, translate }: { asset: ContentAssetSummary; connectedPlatforms: string[]; onPublish: (assetId: string, platform: string) => void; onRegenerate: (assetId: string, count: number) => void; onEditRegion: (asset: ContentAssetSummary) => void; onEditImage: (asset: ContentAssetSummary) => void; onCritique: (assetId: string) => void; onInstructEdit: (assetId: string) => void; onRestyle: (assetId: string) => void; onTrimAudio: (asset: ContentAssetSummary) => void; translate: ReturnType<typeof useTranslator> }) {
  const href = assetHref(asset.url);
  //? F4 — a render's url is an .mp4 (can't be an <img>); use its extracted poster frame as the thumbnail.
  //? An image uses its own url directly. Anything without a usable still falls through to the kind icon.
  const posterHref = asset.posterUrl ? assetHref(asset.posterUrl) : null;
  let previewSrc: string | null = null;
  if (asset.status === 'ready') {
    if (asset.kind === 'image') previewSrc = href;
    else if (asset.kind === 'render') previewSrc = posterHref;
  }
  const canPublish = isPublishable(asset) && !asset.stub && connectedPlatforms.length > 0;
  return (
    <div className="rounded-xl border border-container2-border bg-container2 overflow-hidden flex flex-col">
      <div className="aspect-square bg-container1 flex items-center justify-center relative">
        {asset.status === 'queued' || asset.status === 'processing' ? (
          <GenProgress asset={asset} translate={translate} />
        ) : (previewSrc ? (
          <img src={previewSrc} alt={asset.kind} className="w-full h-full object-cover" />
        ) : (
          <Icon name={ASSET_ICON[asset.kind] ?? 'file-lines'} className="text-2xl text-muted" />
        ))}
        {/* P-C — surface the honest states (ADR 0144): an error render (no keys/Docker) shows a failure badge;
            a not-real stub shows the preview badge. Error takes precedence (a stub render is also an error). */}
        {asset.status === 'error' ? (
          <span className="absolute top-1.5 left-1.5 rounded-md bg-wrong/90 px-1.5 py-0.5 text-[10px] font-semibold text-title-primary" title={translate({ key: 'workspaces.content.assetErrorTip' })}>
            {translate({ key: 'workspaces.content.assetError' })}
          </span>
        ) : (asset.stub && (
          <span className="absolute top-1.5 left-1.5 rounded-md bg-warning/90 px-1.5 py-0.5 text-[10px] font-semibold text-title-primary" title={translate({ key: 'workspaces.content.assetStubTip' })}>
            {translate({ key: 'workspaces.content.assetStub' })}
          </span>
        ))}
        {asset.variant && (
          <span className="absolute top-1.5 right-1.5 rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold text-title-primary" title={translate({ key: 'workspaces.content.variantTip' })}>
            {translate({ key: 'workspaces.content.variant' })}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="text-[11px] font-medium text-common capitalize truncate">{asset.kind}</span>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" title={translate({ key: 'workspaces.content.assetOpen' })} className="text-muted hover:text-primary cursor-pointer shrink-0">
            <Icon name="up-right-from-square" />
          </a>
        ) : (
          <span className="text-[10px] text-disabled capitalize shrink-0">{asset.status}</span>
        )}
      </div>
      {canPublish && (
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {connectedPlatforms.map((platform) => (
            <button key={platform} type="button" onClick={() => { onPublish(asset.id, platform); }} className="rounded-md bg-primary/10 text-primary px-1.5 py-1 text-[10px] font-semibold capitalize hover:bg-primary/20 cursor-pointer flex items-center gap-1">
              <Icon name="paper-plane" /> {platform}
            </button>
          ))}
        </div>
      )}
      {/* E1 — region-edit an image asset (draw a mask → inpaint). */}
      {asset.kind === 'image' && asset.status === 'ready' && asset.url.length > 0 && (
        <div className="flex items-center gap-1 px-2 pb-2">
          <button type="button" onClick={() => { onEditRegion(asset); }} title={translate({ key: 'workspaces.editor.edit' })} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95"><Icon name="wand-magic-sparkles" /> {translate({ key: 'workspaces.editor.edit' })}</button>
          <button type="button" onClick={() => { onEditImage(asset); }} title={translate({ key: 'workspaces.imageEditor.edit' })} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95"><Icon name="sliders" /> {translate({ key: 'workspaces.imageEditor.edit' })}</button>
          {/* F5 — AI critique: "what should change about this photo" (advisory; the model sees the pixels). */}
          <button type="button" onClick={() => { onCritique(asset.id); }} title={translate({ key: 'workspaces.content.critique' })} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95"><Icon name="comment-dots" /> {translate({ key: 'workspaces.content.critique' })}</button>
          {/* F6 — AI instruct-edit: "change the sky to sunset" (whole-image, uses the direction field as the prompt). */}
          <button type="button" onClick={() => { onInstructEdit(asset.id); }} title={translate({ key: 'workspaces.content.instructEdit' })} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95"><Icon name="wand-magic-sparkles" /> {translate({ key: 'workspaces.content.instructEdit' })}</button>
        </div>
      )}
      {/* F7 — video-to-video restyle ("make it cinematic") on a ready video asset. */}
      {asset.kind === 'video' && asset.status === 'ready' && !asset.stub && asset.url.length > 0 && (
        <div className="flex items-center gap-1 px-2 pb-2">
          <button type="button" onClick={() => { onRestyle(asset.id); }} title={translate({ key: 'workspaces.content.restyle' })} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95"><Icon name="film" /> {translate({ key: 'workspaces.content.restyle' })}</button>
        </div>
      )}
      {/* F9 — a standalone audio asset (voice/music/sfx): inline preview + a local trim/gain editor. */}
      {(asset.kind === 'voice' || asset.kind === 'music' || asset.kind === 'sfx') && asset.status === 'ready' && href && (
        <div className="flex flex-col gap-1 px-2 pb-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a user's own audio asset has no caption track to add; this is a preview */}
          <audio controls src={href} className="w-full h-8" />
          <button type="button" onClick={() => { onTrimAudio(asset); }} title={translate({ key: 'workspaces.audioEditor.edit' })} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 self-start motion-safe:active:scale-95"><Icon name="scissors" /> {translate({ key: 'workspaces.audioEditor.edit' })}</button>
        </div>
      )}
      {/* F5 — surface a stored critique under the image so the user sees the feedback. */}
      {asset.critique && asset.critique.length > 0 && (
        <div className="px-2 pb-2 text-[10px] text-muted whitespace-pre-line border-t border-container2-border pt-1.5">{asset.critique}</div>
      )}
      {/* I1 — regenerate + variations for a ready AI-generated asset (uses the current direction as a tweak). */}
      {asset.regenerable && (
        <div className="flex items-center gap-1 px-2 pb-2">
          <button type="button" onClick={() => { onRegenerate(asset.id, 1); }} title={translate({ key: 'workspaces.content.regenerate' })} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95"><Icon name="wave-square" /> {translate({ key: 'workspaces.content.regenerate' })}</button>
          <button type="button" onClick={() => { onRegenerate(asset.id, 3); }} className="rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer motion-safe:active:scale-95">{translate({ key: 'workspaces.content.variations' })}</button>
        </div>
      )}
    </div>
  );
}

export default function ContentPiece({ params }: { params: Record<string, string | undefined> }) {
  const id = params.pieceid ?? '';
  const { content, runContentOp, navigate, activeWorkspace } = useWorkspaces();
  const translate = useTranslator();
  const [styleKey, setStyleKey] = useState('');
  const [durationKey, setDurationKey] = useState('auto');
  //? F2 — how captions are delivered on the rendered video (sidecar .srt only / burned-in / soft mov_text track).
  const [captionKey, setCaptionKey] = useState('sidecar');
  const [extra, setExtra] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  //? E1/E2 — the asset currently open in the region editor / image editor (null = closed).
  const [editRegionAsset, setEditRegionAsset] = useState<ContentAssetSummary | null>(null);
  const [editImageAsset, setEditImageAsset] = useState<ContentAssetSummary | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);

  const piece = useMemo(() => content.pieces.find((p) => p.id === id), [content.pieces, id]);
  //? F8 — a resolved assetId → playable-url map for the timeline preview (scenes carry only asset ids). Declared
  //? BEFORE the `!piece` early return so the hook order is stable (rules-of-hooks); empty when the piece is absent.
  const sceneAssetUrls = useMemo(() => Object.fromEntries((piece?.assets ?? []).map((a): [string, string] => [a.id, assetHref(a.url) ?? '']).filter(([, u]) => u.length > 0)), [piece?.assets]);
  //? V-upload — ready video/image assets that can be dropped into the timeline as a new scene (content-save-scenes).
  const pickableSceneAssets = useMemo(() => (piece?.assets ?? []).filter((a) => (a.kind === 'video' || a.kind === 'image') && a.status === 'ready').map((a) => ({ id: a.id, kind: a.kind })), [piece?.assets]);

  if (!piece) {
    return (
      <div className="p-6">
        <EmptyState icon="circle-question" title={translate({ key: 'workspaces.content.notFound' })} sub={
          <button type="button" onClick={() => { navigate('content'); }} className="text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.content.backToBoard' })}</button>
        } />
      </div>
    );
  }

  //? Q3: the style picker options — "no style" + every known style key (deduped across features).
  const styleItems: DropdownItem[] = [
    { id: '', value: '', item: translate({ key: 'workspaces.content.styleNone' }) },
    ...[...new Map(content.styles.map((s) => [s.key, s.label])).entries()].map(([k, l]) => ({ id: k, value: k, item: l })),
  ];
  //? M3 — target-duration presets for the long-form video planner (content-run-pipeline). 0 = auto (default arc).
  const DURATION_MS: Record<string, number> = { auto: 0, short: 20_000, normal: 45_000, long: 90_000 };
  const durationItems: DropdownItem[] = (['auto', 'short', 'normal', 'long'] as const).map((k) => ({ id: k, value: k, item: translate({ key: `workspaces.content.dur_${k}` }) }));
  const captionItems: DropdownItem[] = (['sidecar', 'burn', 'soft'] as const).map((k) => ({ id: k, value: k, item: translate({ key: `workspaces.content.cap_${k}` }) }));

  //? Q1: the € estimate for an action, from the snapshot's per-feature cost table. 0 (no chip) for
  //? non-metered actions (script/assemble).
  const costOf = (action: GenAction): number => (action.costFeature ? (content.mediaCosts.find((c) => c.feature === action.costFeature)?.cents ?? 0) : 0);
  const costLabel = (action: GenAction): string | null => {
    const cents = costOf(action);
    if (cents <= 0) return null;
    return action.perItem ? translate({ key: 'workspaces.content.costPerItem', params: [{ key: 'amount', value: euro(cents) }] }) : `≈ ${euro(cents)}`;
  };

  const fire = (action: GenAction) => {
    void (async () => {
      const label = costLabel(action);
      const warning = translate({ key: 'workspaces.content.costWarning' });
      const ok = await menuHandler.confirm({ title: translate({ key: 'workspaces.content.confirmTitle' }), content: label ? `${warning} (${label})` : warning });
      if (!ok) return;
      const payload: Record<string, unknown> = {};
      if (styleKey.trim()) payload.styleKey = styleKey.trim();
      if (extra.trim()) payload.extraInstructions = extra.trim();
      if (action.needsPrompt) payload.prompt = extra.trim() || piece.title;
      if (action.needsRef && referenceUrl.trim()) payload.referenceUrl = referenceUrl.trim();
      //? M1/M3 — the whole-video pipeline runs the video path; the target duration drives the long-form
      //? beat/scene planner. durationMs only applies here (other ops ignore it). 0 = auto (default arc).
      if (action.op === 'content-run-pipeline') {
        payload.mode = 'video';
        const durMs = DURATION_MS[durationKey] ?? 0;
        if (durMs > 0) payload.durationMs = durMs;
        //? F2 — non-default caption delivery (sidecar is the server default, so only send when it differs).
        if (captionKey !== 'sidecar') payload.captionMode = captionKey;
      }
      runContentOp(action.op, piece.id, payload);
    })();
  };

  //? Request publish of a finished render to a connected platform. Confirmed (it's public + hard to undo),
  //? then fired as content-request-publish — which only PROPOSES it; the post happens on accept (B-23).
  const connectedPlatforms = content.publishTargets.filter((t) => t.connected).map((t) => t.platform);
  //? G1/CP1 — open the publish COMPOSER: per-platform caption + hashtags + privacy + optional schedule, then
  //? fire content-request-publish (which persists the variant + proposes the post; B-23 gated on accept).
  const requestPublish = (assetId: string, platform: string) => {
    void menuHandler.open(
      <PublishComposer platform={platform} translate={translate} onSubmit={(fields) => {
        void menuHandler.close();
        runContentOp('content-request-publish', piece.id, { assetId, platform, ...fields });
      }} />,
      { dimBackground: true, background: 'bg-container1', size: 'sm' },
    );
  };

  //? B4 — the € cost of a media feature from the snapshot cost table (0 = unknown/free).
  const costForFeature = (feature: string): number => content.mediaCosts.find((c) => c.feature === feature)?.cents ?? 0;
  //? A paid-op confirm that SHOWS the price (× count where relevant) — closes the B4 "silent expensive tweak" gap.
  const confirmPaid = async (feature: string, count = 1): Promise<boolean> => {
    const cents = costForFeature(feature) * count;
    const label = cents > 0 ? ` (≈ ${euro(cents)}${count > 1 ? ` — ${String(count)}×` : ''})` : '';
    return menuHandler.confirm({ title: translate({ key: 'workspaces.content.confirmTitle' }), content: `${translate({ key: 'workspaces.content.costWarning' })}${label}` });
  };

  //? I1 — regenerate an asset (N variations), using the current free-form direction as the tweak. Costs money.
  const regenerate = (assetId: string, count: number) => {
    void (async () => {
      //? B4 — show the € amount × count (was a generic "costs money" with no price).
      if (!(await confirmPaid('image-gen', count))) return;
      runContentOp('content-regenerate', piece.id, { assetId, count: String(count), ...(extra.trim() ? { tweak: extra.trim() } : {}) });
    })();
  };

  //? F5 — AI critique of an image asset ("what should change about this photo"). Advisory + cheap → no
  //? cost-confirm; the result lands on the asset (metadata.critique) via a snapshot refresh.
  const critique = (assetId: string) => {
    runContentOp('content-critique-image', piece.id, { assetId, ...(extra.trim() ? { prompt: extra.trim() } : {}) });
  };
  //? F7 — video-to-video restyle ("make this clip cinematic"). Paid → cost-confirm with the € amount.
  const restyle = (assetId: string) => {
    void (async () => {
      if (!(await confirmPaid('video-restyle'))) return;
      runContentOp('content-video-restyle', piece.id, { assetId, prompt: extra.trim() || 'cinematic, warm colour grade, shallow depth of field' });
    })();
  };
  //? F6 — instruct-edit an image asset ("change the sky to sunset"), whole-image. Uses the free-form direction
  //? field as the instruction (required); paid → cost-confirm with the € amount.
  const instructEdit = (assetId: string) => {
    void (async () => {
      if (extra.trim().length === 0) { notify.error({ key: 'workspaces.content.instructEditNeedsPrompt' }); return; }
      if (!(await confirmPaid('image-edit'))) return;
      runContentOp('content-edit-image', piece.id, { assetId, prompt: extra.trim() });
    })();
  };
  //? F9 — open the audio-editor-lite for a standalone audio asset → content-trim-audio (local, no cost).
  const trimAudio = (asset: ContentAssetSummary) => {
    const url = assetHref(asset.url);
    if (!url) return;
    void menuHandler.open(
      <AudioTrimEditor src={url} translate={translate} onSubmit={(f) => { void menuHandler.close(); runContentOp('content-trim-audio', piece.id, { assetId: asset.id, startMs: f.startMs, endMs: f.endMs, gain: f.gain }); }} />,
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
        <button type="button" onClick={() => { navigate('content'); }} title={translate({ key: 'workspaces.content.backToBoard' })} className="w-8 h-8 rounded-lg hover:bg-container2 text-muted hover:text-common flex items-center justify-center cursor-pointer">
          <Icon name="arrow-left" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-title truncate">{piece.title}</h1>
          <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
            <span className="capitalize">{piece.format}</span>
            <span className="text-disabled">·</span>
            <span className="capitalize">{piece.stageId}</span>
            <span className="text-disabled">·</span>
            <span className="capitalize">{piece.status}</span>
            {piece.spentCents > 0 && <>
              <span className="text-disabled">·</span>
              <span className="tabular-nums" title={translate({ key: 'workspaces.content.spentTooltip' })}>{translate({ key: 'workspaces.content.spentLabel', params: [{ key: 'amount', value: euro(piece.spentCents) }] })}</span>
            </>}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Creative direction — the shared style + free-form instruction applied to a generation. */}
          <section className="lg:col-span-1 rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
            <div>
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.directionTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.directionDesc' })}</div>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.styleLabel' })}</span>
              {/* Q3: pick a known style by name (deduped across features) instead of guessing a magic string. */}
              <Dropdown size="md" value={styleItems.find((i) => i.id === styleKey)} items={styleItems} onChange={(it) => { setStyleKey(String(it.id)); }} />
              {/* M1 — a thumbnail preview of the chosen style's look, when the style carries a preview asset.
                  Prefer a video-gen style's preview (the piece is a video), and prefix backend-relative /media URLs. */}
              {(() => {
                const withPreview = content.styles.filter((s) => s.key === styleKey && (s.previewAssetUrl ?? '').length > 0);
                const sp = withPreview.find((s) => s.feature === 'video-gen') ?? withPreview[0];
                const src = sp?.previewAssetUrl ? assetHref(sp.previewAssetUrl) : null;
                if (!src) return null;
                return sp?.previewKind === 'video'
                  ? <video src={src} muted loop autoPlay playsInline className="mt-1 w-28 h-28 object-cover rounded-lg border border-container2-border" />
                  : <img src={src} alt="" className="mt-1 w-28 h-28 object-cover rounded-lg border border-container2-border" />;
              })()}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.durationLabel' })}</span>
              <Dropdown size="md" value={durationItems.find((i) => i.id === durationKey)} items={durationItems} onChange={(it) => { setDurationKey(String(it.id)); }} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.captionLabel' })}</span>
              <Dropdown size="md" value={captionItems.find((i) => i.id === captionKey)} items={captionItems} onChange={(it) => { setCaptionKey(String(it.id)); }} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.extraLabel' })}</span>
              <textarea value={extra} onChange={(e) => { setExtra(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.content.extraPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.referenceLabel' })}</span>
              <input value={referenceUrl} onChange={(e) => { setReferenceUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.referencePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
              {/* K1: upload your own reference instead of pasting a URL. */}
              <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.content.uploadReference" icon="up-right-from-square" onUploaded={(url) => { setReferenceUrl(url); }} />
            </label>
            <div className="flex items-start gap-2 text-xs text-muted mt-1">
              <Icon name="triangle-exclamation" className="text-warning mt-0.5" /> {translate({ key: 'workspaces.content.costWarning' })}
            </div>
          </section>

          {/* Generation actions — each fires its control-op behind a confirm. */}
          <section className="lg:col-span-2 rounded-2xl border border-container1-border bg-container1 p-5">
            <div className="mb-4">
              <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.generateTitle' })}</div>
              <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.content.generateDesc' })}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ACTIONS.map((a) => {
                const label = costLabel(a);
                return (
                  <button key={a.op} type="button" onClick={() => { fire(a); }} className="flex items-center gap-3 rounded-xl border border-container2-border bg-container2 hover:bg-container2-hover px-3 py-2.5 text-left cursor-pointer transition-colors motion-safe:active:scale-[0.98]">
                    <span className="w-8 h-8 rounded-lg bg-container1 text-primary flex items-center justify-center shrink-0"><Icon name={a.icon} /></span>
                    <span className="text-sm font-medium text-title">{translate({ key: a.labelKey })}</span>
                    {label ? <span className="ml-auto text-[11px] font-medium text-muted tabular-nums">{label}</span> : <Icon name="wand-magic-sparkles" className="ml-auto text-muted" />}
                  </button>
                );
              })}
            </div>

            {/* V5 — open the video timeline editor (scenes + trim/transition/split + range-refine + decompose). */}
            <button type="button" onClick={() => { setShowTimeline(true); }} className="mt-3 w-full flex items-center gap-3 rounded-xl border border-primary-border bg-primary/8 hover:bg-primary/12 px-3 py-2.5 text-left cursor-pointer transition-colors motion-safe:active:scale-[0.98]">
              <span className="w-8 h-8 rounded-lg bg-container1 text-primary flex items-center justify-center shrink-0"><Icon name="table-columns" /></span>
              <span className="text-sm font-medium text-title">{translate({ key: 'workspaces.timeline.open' })}</span>
              <span className="ml-auto text-[11px] font-medium text-muted tabular-nums">{piece.scenes.length} {translate({ key: 'workspaces.timeline.scenes' })}</span>
            </button>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-medium text-muted">{translate({ key: 'workspaces.content.assetsTitle' })}</div>
                {/* K1: bring your own image/video into the piece as a first-class asset. */}
                <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*,video/*" labelKey="workspaces.content.importOwn" onUploaded={(url, kind) => { runContentOp('content-import-asset', piece.id, { url, kind }); }} />
              </div>
              {piece.assets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-divider py-8 text-center text-sm text-disabled">
                  {translate({ key: 'workspaces.content.assetsEmpty' })}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {piece.assets.map((a) => <AssetCard key={a.id} asset={a} connectedPlatforms={connectedPlatforms} onPublish={requestPublish} onRegenerate={regenerate} onEditRegion={setEditRegionAsset} onEditImage={setEditImageAsset} onCritique={critique} onInstructEdit={instructEdit} onRestyle={restyle} onTrimAudio={trimAudio} translate={translate} />)}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      {editRegionAsset && <ImageRegionEditor pieceId={piece.id} asset={{ id: editRegionAsset.id, url: editRegionAsset.url }} onClose={() => { setEditRegionAsset(null); }} />}
      {editImageAsset && <ImageEditor pieceId={piece.id} asset={{ id: editImageAsset.id, url: editImageAsset.url }} onClose={() => { setEditImageAsset(null); }} />}
      {showTimeline && <VideoTimelineEditor pieceId={piece.id} scenes={piece.scenes} assetUrls={sceneAssetUrls} pickableAssets={pickableSceneAssets} voiceUrl={piece.voiceUrl} musicUrl={piece.musicUrl} voiceVolume={piece.voiceVolume} musicVolume={piece.musicVolume} onClose={() => { setShowTimeline(false); }} />}
    </div>
  );
}
