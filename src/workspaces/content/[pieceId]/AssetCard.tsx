//? The produced-asset card for the piece page (extracted from page.tsx in the KISS redesign). The card keeps
//? the strongest surfaces inline — preview/queue progress, badges, open link, region/image edit for images,
//? publish + published-on + per-job status chips, the audio preview — and moves every secondary action
//? (critique, AI edit, restyle, transcode webm/gif, trim audio, regenerate ×1/×3) into a per-card overflow
//? menu. The visibility rules are SEMANTIC, not cosmetic (ready/stub/kind guards mirror the ops' own guards).

import { useEffect, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from '../../_components/Icon';
import { PopMenu, type PopMenuItem } from '../../_components/primitives';
import type { ContentAssetSummary } from '../../_data/types';
import { assetHref } from './assetHref';

//? Asset kind → icon (unknown kinds fall back to the generic file icon).
const ASSET_ICON: Record<string, IconName> = {
  image: 'table-cells-large', render: 'display', video: 'display', voice: 'wave-square',
  music: 'wave-square', sfx: 'wave-square', avatar: 'user', 'model-3d': 'box-archive', script: 'file-lines',
};

//? A publishable asset is a finished, reachable video/render (the thing you post to a platform).
const isPublishable = (asset: ContentAssetSummary): boolean => (asset.kind === 'render' || asset.kind === 'video') && asset.status === 'ready';
//? #143 — per-job publish-status tint (done=correct · scheduled=warning · error=wrong · queued=muted).
const PUBLISH_STATUS_TINT: Record<string, string> = { done: 'bg-correct/10 text-correct', scheduled: 'bg-warning/15 text-warning', error: 'bg-wrong/10 text-wrong' };

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
      <div className={`flex flex-col items-center gap-1.5 text-muted`}>
        <Icon name="clock" className={`text-xl animate-pulse`} />
        <span className={`text-[11px] font-medium text-center px-1`}>
          {asset.queuePosition == null
            ? translate({ key: 'workspaces.content.queued' })
            : translate({ key: 'workspaces.content.queuePos', params: [{ key: 'n', value: asset.queuePosition }] })}
        </span>
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center gap-1.5 text-primary`}>
      <span className={`w-5 h-5 rounded-full border-2 border-container2-border border-t-primary animate-spin`} />
      <span className={`text-[11px] font-medium tabular-nums`}>
        {asset.startedAt ? elapsedLabel(asset.startedAt, now) : translate({ key: 'workspaces.content.generating' })}
      </span>
    </div>
  );
}

//? One produced asset. Inline: thumbnail/poster (or the kind icon), queued/processing progress, stub/error/
//? variant badges, the open link, region + image edit for a ready image, publish chips per connected platform
//? (fires content-request-publish behind the composer; B-23-gated on accept), published-on + unpublish chips
//? (S2), per-job publish-status chips (#143), the audio preview, and a stored critique. Everything else sits
//? in the overflow menu.
export function AssetCard({ asset, connectedPlatforms, onPublish, onUnpublish, onRegenerate, onEditRegion, onEditImage, onCritique, onInstructEdit, onRestyle, onTranscode, onTrimAudio, translate }: { asset: ContentAssetSummary; connectedPlatforms: string[]; onPublish: (assetId: string, platform: string) => void; onUnpublish: (assetId: string, platform: string) => void; onRegenerate: (assetId: string, count: number) => void; onEditRegion: (asset: ContentAssetSummary) => void; onEditImage: (asset: ContentAssetSummary) => void; onCritique: (assetId: string) => void; onInstructEdit: (assetId: string) => void; onRestyle: (assetId: string) => void; onTranscode: (assetId: string, format: 'webm' | 'gif') => void; onTrimAudio: (asset: ContentAssetSummary) => void; translate: ReturnType<typeof useTranslator> }) {
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
  const isReadyImage = asset.kind === 'image' && asset.status === 'ready' && asset.url.length > 0;

  //? The per-card overflow menu — every secondary action, with the SAME semantic guards the inline buttons
  //? had before the redesign (relocated, not weakened).
  const menu: PopMenuItem[] = [];
  if (isReadyImage) {
    //? F5 — AI critique (advisory + cheap → deliberately NO cost-confirm) + F6 — AI instruct-edit
    //? ("change the sky to sunset"): whole-image, uses the direction field as the prompt.
    menu.push(
      { label: translate({ key: 'workspaces.content.critique' }), icon: 'comment-dots', onClick: () => { onCritique(asset.id); } },
      { label: translate({ key: 'workspaces.content.instructEdit' }), icon: 'wand-magic-sparkles', onClick: () => { onInstructEdit(asset.id); } },
    );
  }
  //? F7 — video-to-video restyle ("make it cinematic") on a ready, real video asset.
  if (asset.kind === 'video' && asset.status === 'ready' && !asset.stub && asset.url.length > 0) {
    menu.push({ label: translate({ key: 'workspaces.content.restyle' }), icon: 'film', onClick: () => { onRestyle(asset.id); } });
  }
  //? KG2 — transcode a finished mp4 (render/video) to webm/gif as a new sibling asset (free, local ffmpeg).
  if ((asset.kind === 'render' || asset.kind === 'video') && asset.status === 'ready' && !asset.stub && asset.url.endsWith('.mp4')) {
    menu.push(
      { label: translate({ key: 'workspaces.content.transcodeWebm' }), icon: 'film', onClick: () => { onTranscode(asset.id, 'webm'); } },
      { label: translate({ key: 'workspaces.content.transcodeGif' }), icon: 'film', onClick: () => { onTranscode(asset.id, 'gif'); } },
    );
  }
  //? F9 — trim/gain for a standalone audio asset (the inline <audio> preview stays on the card).
  if ((asset.kind === 'voice' || asset.kind === 'music' || asset.kind === 'sfx') && asset.status === 'ready' && href) {
    menu.push({ label: translate({ key: 'workspaces.audioEditor.edit' }), icon: 'scissors', onClick: () => { onTrimAudio(asset); } });
  }
  //? I1 — regenerate + variations for a ready AI-generated asset (uses the current direction as a tweak).
  if (asset.regenerable) {
    menu.push(
      { label: translate({ key: 'workspaces.content.regenerate' }), icon: 'wave-square', onClick: () => { onRegenerate(asset.id, 1); } },
      { label: translate({ key: 'workspaces.content.variations' }), icon: 'wave-square', onClick: () => { onRegenerate(asset.id, 3); } },
    );
  }

  return (
    <div className={`rounded-xl border border-container2-border bg-container2 flex flex-col`}>
      <div className={`aspect-square bg-container1 flex items-center justify-center relative overflow-hidden rounded-t-xl`}>
        {asset.status === 'queued' || asset.status === 'processing' ? (
          <GenProgress asset={asset} translate={translate} />
        ) : (previewSrc ? (
          <img src={previewSrc} alt={asset.kind} className={`w-full h-full object-cover`} />
        ) : (
          <Icon name={ASSET_ICON[asset.kind] ?? 'file-lines'} className={`text-2xl text-muted`} />
        ))}
        {/* P-C — surface the honest states (ADR 0144): an error render (no keys/Docker) shows a failure badge;
            a not-real stub shows the preview badge. Error takes precedence (a stub render is also an error). */}
        {asset.status === 'error' ? (
          <span className={`absolute top-1.5 left-1.5 rounded-md bg-wrong/90 px-1.5 py-0.5 text-[10px] font-semibold text-title-primary`} title={translate({ key: 'workspaces.content.assetErrorTip' })}>
            {translate({ key: 'workspaces.content.assetError' })}
          </span>
        ) : (asset.stub && (
          <span className={`absolute top-1.5 left-1.5 rounded-md bg-warning/90 px-1.5 py-0.5 text-[10px] font-semibold text-title-primary`} title={translate({ key: 'workspaces.content.assetStubTip' })}>
            {translate({ key: 'workspaces.content.assetStub' })}
          </span>
        ))}
        {asset.variant && (
          <span className={`absolute top-1.5 right-1.5 rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold text-title-primary`} title={translate({ key: 'workspaces.content.variantTip' })}>
            {translate({ key: 'workspaces.content.variant' })}
          </span>
        )}
      </div>
      <div className={`flex items-center justify-between gap-1 px-2 py-1.5`}>
        <span className={`text-[11px] font-medium text-common capitalize truncate`}>{asset.kind}</span>
        <div className={`flex items-center gap-1 shrink-0`}>
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" title={translate({ key: 'workspaces.content.assetOpen' })} className={`text-muted hover:text-primary cursor-pointer`}>
              <Icon name="up-right-from-square" />
            </a>
          ) : (
            <span className={`text-[10px] text-disabled capitalize`}>{asset.status}</span>
          )}
          {menu.length > 0 && <PopMenu items={menu} ariaLabel={translate({ key: 'workspaces.content.assetActions' })} />}
        </div>
      </div>
      {/* E1/E2 — the two strongest image actions stay inline: region edit (mask → inpaint) + the adjust editor. */}
      {isReadyImage && (
        <div className={`flex items-center gap-1 px-2 pb-2`}>
          <button type="button" onClick={() => { onEditRegion(asset); }} title={translate({ key: 'workspaces.editor.edit' })} className={`rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95`}><Icon name="wand-magic-sparkles" /> {translate({ key: 'workspaces.editor.edit' })}</button>
          <button type="button" onClick={() => { onEditImage(asset); }} title={translate({ key: 'workspaces.imageEditor.edit' })} className={`rounded-md bg-container1 text-common px-1.5 py-1 text-[10px] font-semibold hover:bg-container2-hover cursor-pointer flex items-center gap-1 motion-safe:active:scale-95`}><Icon name="sliders" /> {translate({ key: 'workspaces.imageEditor.edit' })}</button>
        </div>
      )}
      {canPublish && (
        <div className={`flex flex-wrap gap-1 px-2 pb-2`}>
          {connectedPlatforms.map((platform) => (
            <button key={platform} type="button" onClick={() => { onPublish(asset.id, platform); }} className={`rounded-md bg-primary/10 text-primary px-1.5 py-1 text-[10px] font-semibold capitalize hover:bg-primary/20 cursor-pointer flex items-center gap-1`}>
              <Icon name="paper-plane" /> {platform}
            </button>
          ))}
        </div>
      )}
      {/* S2 — content-unpublish: retract a published post. Only shown for platforms this asset is live on. */}
      {asset.publishedOn && asset.publishedOn.length > 0 && (
        <div className={`flex flex-wrap items-center gap-1 px-2 pb-2`}>
          <span className={`text-[10px] text-muted inline-flex items-center gap-1`}><Icon name="circle-check" className={`text-correct`} /> {translate({ key: 'workspaces.content.publishedOn' })}</span>
          {asset.publishedOn.map((platform) => (
            <button key={platform} type="button" onClick={() => { onUnpublish(asset.id, platform); }} title={translate({ key: 'workspaces.content.unpublish' })} className={`rounded-md bg-wrong/10 text-wrong px-1.5 py-1 text-[10px] font-semibold capitalize hover:bg-wrong/20 cursor-pointer flex items-center gap-1`}>
              <Icon name="xmark" /> {platform}
            </button>
          ))}
        </div>
      )}
      {/* #143 — honest per-job publish status (done/scheduled/error/queued) + external link per platform. */}
      {asset.publishJobs && asset.publishJobs.length > 0 && (
        <div className={`flex flex-wrap items-center gap-1 px-2 pb-2`}>
          <span className={`text-[10px] text-muted`}>{translate({ key: 'workspaces.content.publishStatus' })}</span>
          {asset.publishJobs.map((j, i) => {
            const tint = PUBLISH_STATUS_TINT[j.status] ?? 'bg-container2 text-muted';
            const chipCls = `rounded-md px-1.5 py-1 text-[10px] font-semibold capitalize inline-flex items-center gap-1 ${tint}`;
            const label = `${j.platform} · ${translate({ key: `workspaces.content.pubStatus_${j.status}` })}`;
            return j.externalUrl !== undefined && j.externalUrl.length > 0
              ? <a key={`${j.platform}-${String(i)}`} href={j.externalUrl} target="_blank" rel="noreferrer" className={`${chipCls} hover:underline`}>{label} <Icon name="up-right-from-square" /></a>
              : <span key={`${j.platform}-${String(i)}`} className={chipCls}>{label}</span>;
          })}
        </div>
      )}
      {/* F9 — a standalone audio asset (voice/music/sfx): the inline preview stays; trimming sits in the menu. */}
      {(asset.kind === 'voice' || asset.kind === 'music' || asset.kind === 'sfx') && asset.status === 'ready' && href && (
        <div className={`px-2 pb-2`}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a user's own audio asset has no caption track to add; this is a preview */}
          <audio controls src={href} className={`w-full h-8`} />
        </div>
      )}
      {/* F5 — surface a stored critique under the image so the user sees the feedback. */}
      {asset.critique && asset.critique.length > 0 && (
        <div className={`px-2 pb-2 text-[10px] text-muted whitespace-pre-line border-t border-container2-border pt-1.5`}>{asset.critique}</div>
      )}
    </div>
  );
}
