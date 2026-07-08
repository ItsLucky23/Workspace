//? intent: a content piece's detail — its stage/status, the generation controls (write · voice · images ·
//? video · music · 3D · assemble) with a style + free-form direction, and an asset area — the place a
//? non-technical user turns a brief into finished media, each generation confirmed (it may cost money).

import { useEffect, useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon, { type IconName } from '../../_components/Icon';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { EmptyState } from '../../_components/primitives';
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
function AssetCard({ asset, connectedPlatforms, onPublish, onRegenerate, onEditRegion, onEditImage, translate }: { asset: ContentAssetSummary; connectedPlatforms: string[]; onPublish: (assetId: string, platform: string) => void; onRegenerate: (assetId: string, count: number) => void; onEditRegion: (asset: ContentAssetSummary) => void; onEditImage: (asset: ContentAssetSummary) => void; translate: ReturnType<typeof useTranslator> }) {
  const href = assetHref(asset.url);
  const isImage = (asset.kind === 'image' || asset.kind === 'render') && href !== null && asset.status === 'ready';
  const canPublish = isPublishable(asset) && !asset.stub && connectedPlatforms.length > 0;
  return (
    <div className="rounded-xl border border-container2-border bg-container2 overflow-hidden flex flex-col">
      <div className="aspect-square bg-container1 flex items-center justify-center relative">
        {asset.status === 'queued' || asset.status === 'processing' ? (
          <GenProgress asset={asset} translate={translate} />
        ) : (isImage && href ? (
          <img src={href} alt={asset.kind} className="w-full h-full object-cover" />
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
        </div>
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
  const [extra, setExtra] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  //? E1/E2 — the asset currently open in the region editor / image editor (null = closed).
  const [editRegionAsset, setEditRegionAsset] = useState<ContentAssetSummary | null>(null);
  const [editImageAsset, setEditImageAsset] = useState<ContentAssetSummary | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);

  const piece = useMemo(() => content.pieces.find((p) => p.id === id), [content.pieces, id]);

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
      const payload: Record<string, string> = {};
      if (styleKey.trim()) payload.styleKey = styleKey.trim();
      if (extra.trim()) payload.extraInstructions = extra.trim();
      if (action.needsPrompt) payload.prompt = extra.trim() || piece.title;
      if (action.needsRef && referenceUrl.trim()) payload.referenceUrl = referenceUrl.trim();
      runContentOp(action.op, piece.id, payload);
    })();
  };

  //? Request publish of a finished render to a connected platform. Confirmed (it's public + hard to undo),
  //? then fired as content-request-publish — which only PROPOSES it; the post happens on accept (B-23).
  const connectedPlatforms = content.publishTargets.filter((t) => t.connected).map((t) => t.platform);
  const requestPublish = (assetId: string, platform: string) => {
    void (async () => {
      const ok = await menuHandler.confirm({ title: translate({ key: 'workspaces.content.publishConfirmTitle' }), content: translate({ key: 'workspaces.content.publishConfirmBody' }) });
      if (!ok) return;
      runContentOp('content-request-publish', piece.id, { assetId, platform });
    })();
  };

  //? I1 — regenerate an asset (N variations), using the current free-form direction as the tweak. Costs money.
  const regenerate = (assetId: string, count: number) => {
    void (async () => {
      const ok = await menuHandler.confirm({ title: translate({ key: 'workspaces.content.confirmTitle' }), content: translate({ key: 'workspaces.content.costWarning' }) });
      if (!ok) return;
      runContentOp('content-regenerate', piece.id, { assetId, count: String(count), ...(extra.trim() ? { tweak: extra.trim() } : {}) });
    })();
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
              {/* M1 — a thumbnail preview of the chosen style's look, when the style carries a preview asset. */}
              {(() => {
                const sp = content.styles.find((s) => s.key === styleKey && (s.previewAssetUrl ?? '').length > 0);
                if (!sp?.previewAssetUrl) return null;
                return sp.previewKind === 'video'
                  ? <video src={sp.previewAssetUrl} muted loop autoPlay playsInline className="mt-1 w-28 h-28 object-cover rounded-lg border border-container2-border" />
                  : <img src={sp.previewAssetUrl} alt="" className="mt-1 w-28 h-28 object-cover rounded-lg border border-container2-border" />;
              })()}
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
                  {piece.assets.map((a) => <AssetCard key={a.id} asset={a} connectedPlatforms={connectedPlatforms} onPublish={requestPublish} onRegenerate={regenerate} onEditRegion={setEditRegionAsset} onEditImage={setEditImageAsset} translate={translate} />)}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      {editRegionAsset && <ImageRegionEditor pieceId={piece.id} asset={{ id: editRegionAsset.id, url: editRegionAsset.url }} onClose={() => { setEditRegionAsset(null); }} />}
      {editImageAsset && <ImageEditor pieceId={piece.id} asset={{ id: editImageAsset.id, url: editImageAsset.url }} onClose={() => { setEditImageAsset(null); }} />}
      {showTimeline && <VideoTimelineEditor pieceId={piece.id} scenes={piece.scenes} voiceUrl={piece.voiceUrl} musicUrl={piece.musicUrl} voiceVolume={piece.voiceVolume} musicVolume={piece.musicVolume} onClose={() => { setShowTimeline(false); }} />}
    </div>
  );
}
