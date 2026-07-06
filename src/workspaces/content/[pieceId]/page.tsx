//? intent: a content piece's detail — its stage/status, the generation controls (write · voice · images ·
//? video · music · 3D · assemble) with a style + free-form direction, and an asset area — the place a
//? non-technical user turns a brief into finished media, each generation confirmed (it may cost money).

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon, { type IconName } from '../../_components/Icon';
import { EmptyState } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
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
interface GenAction { op: string; labelKey: string; icon: IconName; needsRef?: boolean; needsPrompt?: boolean }
const ACTIONS: GenAction[] = [
  { op: 'content-gen-script', labelKey: 'workspaces.content.actScript', icon: 'file-lines' },
  { op: 'content-gen-voice', labelKey: 'workspaces.content.actVoice', icon: 'wave-square' },
  { op: 'content-gen-images', labelKey: 'workspaces.content.actImages', icon: 'table-cells-large' },
  { op: 'content-gen-reference-image', labelKey: 'workspaces.content.actReferenceImage', icon: 'wand-magic-sparkles', needsRef: true },
  { op: 'content-gen-shortform', labelKey: 'workspaces.content.actShortform', icon: 'wand-magic-sparkles', needsPrompt: true },
  { op: 'content-gen-music', labelKey: 'workspaces.content.actMusic', icon: 'wave-square' },
  { op: 'content-gen-sfx', labelKey: 'workspaces.content.actSfx', icon: 'wave-square' },
  { op: 'content-gen-3d', labelKey: 'workspaces.content.act3d', icon: 'box-archive' },
  { op: 'content-assemble', labelKey: 'workspaces.content.actAssemble', icon: 'diagram-project' },
];

//? A publishable asset is a finished, reachable video/render (the thing you post to a platform).
const isPublishable = (asset: ContentAssetSummary): boolean => (asset.kind === 'render' || asset.kind === 'video') && asset.status === 'ready';

//? One produced asset: a thumbnail for openable images, else an icon, with its kind + a stub/status badge,
//? an open/download link when reachable, and — for a finished render — a publish button per connected
//? platform (fires content-request-publish behind a confirm; the actual post is B-23-gated on accept).
function AssetCard({ asset, connectedPlatforms, onPublish, translate }: { asset: ContentAssetSummary; connectedPlatforms: string[]; onPublish: (assetId: string, platform: string) => void; translate: ReturnType<typeof useTranslator> }) {
  const href = assetHref(asset.url);
  const isImage = (asset.kind === 'image' || asset.kind === 'render') && href !== null && asset.status === 'ready';
  const canPublish = isPublishable(asset) && !asset.stub && connectedPlatforms.length > 0;
  return (
    <div className="rounded-xl border border-container2-border bg-container2 overflow-hidden flex flex-col">
      <div className="aspect-square bg-container1 flex items-center justify-center relative">
        {isImage && href ? (
          <img src={href} alt={asset.kind} className="w-full h-full object-cover" />
        ) : (
          <Icon name={ASSET_ICON[asset.kind] ?? 'file-lines'} className="text-2xl text-muted" />
        )}
        {asset.stub && (
          <span className="absolute top-1.5 left-1.5 rounded-md bg-warning/90 px-1.5 py-0.5 text-[10px] font-semibold text-title-primary">
            {translate({ key: 'workspaces.content.assetStub' })}
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
    </div>
  );
}

export default function ContentPiece({ params }: { params: Record<string, string | undefined> }) {
  const id = params.pieceid ?? '';
  const { content, runContentOp, navigate } = useWorkspaces();
  const translate = useTranslator();
  const [styleKey, setStyleKey] = useState('');
  const [extra, setExtra] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');

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

  const fire = (action: GenAction) => {
    void (async () => {
      const ok = await menuHandler.confirm({ title: translate({ key: 'workspaces.content.confirmTitle' }), content: translate({ key: 'workspaces.content.costWarning' }) });
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
              <input value={styleKey} onChange={(e) => { setStyleKey(e.target.value); }} placeholder={translate({ key: 'workspaces.content.stylePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.extraLabel' })}</span>
              <textarea value={extra} onChange={(e) => { setExtra(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.content.extraPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{translate({ key: 'workspaces.content.referenceLabel' })}</span>
              <input value={referenceUrl} onChange={(e) => { setReferenceUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.referencePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
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
              {ACTIONS.map((a) => (
                <button key={a.op} type="button" onClick={() => { fire(a); }} className="flex items-center gap-3 rounded-xl border border-container2-border bg-container2 hover:bg-container2-hover px-3 py-2.5 text-left cursor-pointer transition-colors">
                  <span className="w-8 h-8 rounded-lg bg-container1 text-primary flex items-center justify-center shrink-0"><Icon name={a.icon} /></span>
                  <span className="text-sm font-medium text-title">{translate({ key: a.labelKey })}</span>
                  <Icon name="wand-magic-sparkles" className="ml-auto text-muted" />
                </button>
              ))}
            </div>

            <div className="mt-5">
              <div className="text-sm font-medium text-muted mb-2">{translate({ key: 'workspaces.content.assetsTitle' })}</div>
              {piece.assets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-divider py-8 text-center text-sm text-disabled">
                  {translate({ key: 'workspaces.content.assetsEmpty' })}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {piece.assets.map((a) => <AssetCard key={a.id} asset={a} connectedPlatforms={connectedPlatforms} onPublish={requestPublish} translate={translate} />)}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
