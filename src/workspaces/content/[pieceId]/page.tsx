//? intent: a content piece's detail — ONE dominant "Generate full video" action (≈€ shown, always cost-
//? confirmed) above a slim creative-direction core (style + free-form direction, output settings collapsed),
//? the produced assets with per-card edit/publish actions behind an overflow menu, and the occasional tools
//? (demo recorder · reference analysis · SEO · thumbnail) grouped in one collapsed section.

import { useMemo, useState } from 'react';

import { tryCatch } from '@luckystack/core';
import { apiRequest, useTranslator, i18nNotify as notify } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon, { type IconName } from '../../_components/Icon';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { Disclosure, EmptyState, FOCUS_RING, IconButton, InfoTip, PopMenu, SectionCard, Segmented, Toggle, WsButton, type PopMenuItem } from '../../_components/primitives';
import { EmptyPicker, SetupNotice } from '../../_components/SetupNotice';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import ImageRegionEditor from '../../_components/ImageRegionEditor';
import ImageEditor from '../../_components/ImageEditor';
import VideoTimelineEditor from '../../_components/VideoTimelineEditor';
import type { ContentAssetSummary } from '../../_data/types';
import { AssetCard } from './AssetCard';
import { assetHref } from './assetHref';

export const template = 'workspaces';

//? GAP_SCAN F3 — what the SEO route hands back: a deterministic score (always) + AI alternatives (when a
//? provider is configured). `aiOk:false` means the score half still stands — that is the point of splitting them.
interface SeoResult { score: number; issues: string[]; lengthOk: boolean; titles: string[]; description: string; tags: string[]; aiOk: boolean }

//? A generation action: its content-op + label + icon + whether it needs the reference url / a prompt.
//? `costFeature` maps the action to the media feature whose € estimate we show BEFORE the user spends (Q1);
//? `perItem` = the cost is per produced unit (per-beat images), shown as "≈ €X / item".
interface GenAction { op: string; labelKey: string; icon: IconName; needsRef?: boolean; needsPrompt?: boolean; costFeature?: string; perItem?: boolean }

//? M1/M3 — the one-shot whole-video pipeline (script → voice → styled scenes → assemble): the page's ONE
//? primary action, rendered as the hero button. It is the only op that consumes styleKey + durationMs.
const PIPELINE_ACTION: GenAction = { op: 'content-run-pipeline', labelKey: 'workspaces.content.actPipeline', icon: 'wand-magic-sparkles', costFeature: 'video-gen' };
//? The single-step generations — relocated behind the "More generations" disclosure (same fire() path,
//? same per-action € labels, same confirms).
const MORE_ACTIONS: GenAction[] = [
  { op: 'content-gen-script', labelKey: 'workspaces.content.actScript', icon: 'file-lines' },
  { op: 'content-gen-voice', labelKey: 'workspaces.content.actVoice', icon: 'wave-square', costFeature: 'tts' },
  { op: 'content-gen-images', labelKey: 'workspaces.content.actImages', icon: 'table-cells-large', costFeature: 'image-gen', perItem: true },
  { op: 'content-gen-reference-image', labelKey: 'workspaces.content.actReferenceImage', icon: 'wand-magic-sparkles', needsRef: true, costFeature: 'reference-image' },
  { op: 'content-gen-shortform', labelKey: 'workspaces.content.actShortform', icon: 'wand-magic-sparkles', needsPrompt: true, costFeature: 'video-gen' },
  { op: 'content-gen-music', labelKey: 'workspaces.content.actMusic', icon: 'wave-square', costFeature: 'music' },
  { op: 'content-gen-sfx', labelKey: 'workspaces.content.actSfx', icon: 'wave-square', costFeature: 'sfx' },
  { op: 'content-gen-3d', labelKey: 'workspaces.content.act3d', icon: 'box-archive', costFeature: 'model-3d' },
  { op: 'content-gen-avatar', labelKey: 'workspaces.content.actAvatar', icon: 'user', costFeature: 'avatar' },
  { op: 'content-assemble', labelKey: 'workspaces.content.actAssemble', icon: 'diagram-project' },
];

//? Cents → a short € label (e.g. 40 → "€0.40"). Shared by the action chips + the confirm.
const euro = (cents: number): string => `€${(cents / 100).toFixed(2)}`;

//? G1/CP1 — the publish composer form: caption + hashtags + privacy + optional schedule for ONE platform.
//? Submits the fields to content-request-publish (G1 persists them as the per-platform publishVariant).
function PublishComposer({ platform, accounts, defaultSynthetic, defaultAccountId, onSubmit, translate }: { platform: string; accounts: { accountId: string | null }[]; defaultSynthetic: boolean; defaultAccountId: string | null; onSubmit: (fields: { caption?: string; hashtags?: string[]; privacy?: string; scheduledAt?: string; accountId?: string; syntheticMedia?: boolean }) => void; translate: ReturnType<typeof useTranslator> }) {
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [scheduledAt, setScheduledAt] = useState('');
  //? AI-disclosure checkbox — manual per post, prefilled from the channel's aiDisclosureDefault.
  const [synthetic, setSynthetic] = useState(defaultSynthetic);
  //? #140 — which connected account to post as (only shown when the platform has a named/multi account).
  //? F41 — the CHANNEL's default account wins over "whichever account happens to be first". Picking
  //? accounts[0] silently posted to the wrong account whenever a channel named a different default.
  const [accountId, setAccountId] = useState(
    defaultAccountId !== null && accounts.some((a) => a.accountId === defaultAccountId)
      ? defaultAccountId
      : (accounts[0]?.accountId ?? ''),
  );
  const inputCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary w-full';
  const privItems = (['public', 'unlisted', 'private'] as const).map((p) => ({ id: p, value: p, item: translate({ key: `workspaces.publish.priv_${p}` }) }));
  const showAccountPicker = accounts.length > 1 || accounts.some((a) => a.accountId !== null);
  const accountItems = accounts.map((a) => ({ id: a.accountId ?? '__default__', value: a.accountId ?? '', item: a.accountId ?? translate({ key: 'workspaces.content.publishDefaultAccount' }) }));
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title capitalize">{translate({ key: 'workspaces.publish.title', params: [{ key: 'platform', value: platform }] })}</div>
      {showAccountPicker && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-common">{translate({ key: 'workspaces.content.publishAccountLabel' })}</span>
          <Dropdown size="sm" items={accountItems} value={accountItems.find((it) => it.value === accountId)} onChange={(it) => { setAccountId(String(it.value)); }} />
        </div>
      )}
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
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-common" title={translate({ key: 'workspaces.publish.syntheticHint' })}>{translate({ key: 'workspaces.publish.synthetic' })}</span>
        <Toggle on={synthetic} onChange={setSynthetic} label={synthetic ? translate({ key: 'workspaces.publish.syntheticOn' }) : translate({ key: 'workspaces.publish.syntheticOff' })} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="paper-plane" onClick={() => {
          const tags = hashtags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter((t) => t.length > 0);
          onSubmit({ ...(caption.trim() ? { caption: caption.trim() } : {}), ...(tags.length > 0 ? { hashtags: tags } : {}), privacy, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}), ...(accountId ? { accountId } : {}), syntheticMedia: synthetic });
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
        <span className="text-muted">{translate({ key: 'workspaces.audioEditor.gainValue', params: [{ key: 'n', value: gain.toFixed(2) }] })}</span>
        <input type="range" min={0} max={2} step={0.05} value={gain} onChange={(e) => { setGain(Number(e.target.value)); }} className="accent-primary" />
      </label>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="scissors" disabled={dur <= 0 || end <= start} onClick={() => { onSubmit({ startMs: Math.round(start * 1000), endMs: Math.round(end * 1000), gain }); }}>{translate({ key: 'workspaces.audioEditor.apply' })}</WsButton>
      </div>
    </div>
  );
}

export default function ContentPiece({ params }: { params: Record<string, string | undefined> }) {
  const id = params.pieceid ?? '';
  const { content, runContentOp, navigate, activeWorkspace, outputTemplates, readiness, focusSetup } = useWorkspaces();
  const translate = useTranslator();
  const [styleKey, setStyleKey] = useState('');
  const [durationKey, setDurationKey] = useState('auto');
  //? F2 — how captions are delivered on the rendered video (sidecar .srt only / burned-in / soft mov_text track).
  const [captionKey, setCaptionKey] = useState('sidecar');
  //? Gap-fix (render settings): the aspect ratio finally gets a UI control (the backend was ready —
  //? every render fell back to 16:9), plus the OutputTemplate picker that makes templates REAL.
  const [aspectKey, setAspectKey] = useState('16:9');
  const [templateKey, setTemplateKey] = useState('');
  //? H1 (ads) — an optional CTA / end-card line overlaid on the last seconds of the ad render.
  const [ctaText, setCtaText] = useState('');
  const [extra, setExtra] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  //? capture-run (I1/I2 demo recorder) — was built (container + scenario) but had no UI trigger.
  const [captureUrl, setCaptureUrl] = useState('');
  const [captureGoal, setCaptureGoal] = useState('');
  //? content-analyze-reference-video (ADR 0049) — a reference video + a new story → a script blueprint. Was UI-less.
  const [analyzeVideoUrl, setAnalyzeVideoUrl] = useState('');
  const [analyzeStory, setAnalyzeStory] = useState('');
  //? E1/E2 — the asset currently open in the region editor / image editor (null = closed).
  const [editRegionAsset, setEditRegionAsset] = useState<ContentAssetSummary | null>(null);
  const [editImageAsset, setEditImageAsset] = useState<ContentAssetSummary | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  //? Which occasional tool is showing inside the Tools panel — a single active panel (Segmented) instead
  //? of four more nested Disclosures, so "Tools" never goes three accordions deep.
  const [activeTool, setActiveTool] = useState<'capture' | 'analyze' | 'seo' | 'thumb'>('capture');
  //? GAP_SCAN F2 — the caption LOOK, sent with the pipeline run (burn-in only; sidecar/soft ignore it).
  const [ccSize, setCcSize] = useState('28');
  const [ccColor, setCcColor] = useState('ffffff');
  const [ccBoxed, setCcBoxed] = useState(false);
  const [ccWordByWord, setCcWordByWord] = useState(false);
  //? GAP_SCAN F3 — the SEO panel's fetched suggestions (null = not asked yet).
  const [seo, setSeo] = useState<SeoResult | null>(null);
  const [seoBusy, setSeoBusy] = useState(false);
  //? GAP_SCAN F1 — the thumbnail composer's inputs.
  const [thumbHeadline, setThumbHeadline] = useState('');
  const [thumbPrompt, setThumbPrompt] = useState('');

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
  //? The technical ratio labels ARE the values (16:9/9:16/1:1) — no translation needed.
  const aspectItems: DropdownItem[] = (['16:9', '9:16', '1:1'] as const).map((k) => ({ id: k, value: k, item: k }));
  const templateItems: DropdownItem[] = [{ id: '', value: '', item: translate({ key: 'workspaces.content.templateNone' }) }, ...outputTemplates.map((t) => ({ id: t.id, value: t.id, item: `${t.name} (${t.format}${t.watermarkPosition ? ' · wm' : ''})` }))];

  //? Q1: the € estimate for an action, from the snapshot's per-feature cost table. 0 (no chip) for
  //? non-metered actions (script/assemble).
  const costOf = (action: GenAction): number => (action.costFeature ? (content.mediaCosts.find((c) => c.feature === action.costFeature)?.cents ?? 0) : 0);
  const costLabel = (action: GenAction): string | null => {
    const cents = costOf(action);
    if (cents <= 0) return null;
    return action.perItem ? translate({ key: 'workspaces.content.costPerItem', params: [{ key: 'amount', value: euro(cents) }] }) : `≈ ${euro(cents)}`;
  };
  const pipelineCost = costLabel(PIPELINE_ACTION);

  //? GAP_SCAN F3 — ask for SEO suggestions for THIS piece's title. A read (it writes nothing); applying a
  //? suggestion is the user editing the title, which goes through the normal edit path.
  const loadSeo = (): void => {
    if (seoBusy) return;
    setSeoBusy(true);
    void tryCatch(() => apiRequest({ name: 'workspaces/seoSuggest', version: 'v1', data: { workspaceId: activeWorkspace.id, title: piece.title, platform: 'youtube' } })).then(([err, res]) => {
      setSeoBusy(false);
      if (!err && res?.status === 'success') setSeo(res.result);
    });
  };

  //? GAP_SCAN F1 — compose a thumbnail. The template path (headline only) is free; adding a background
  //? prompt spends an image-gen, so THAT variant gets the same cost-confirm as every other paid op.
  const composeThumbnail = (): void => {
    const headline = thumbHeadline.trim() || piece.title;
    const withAi = thumbPrompt.trim().length > 0;
    void (async () => {
      if (withAi && !(await confirmPaid('image-gen', 1))) return;
      runContentOp('content-gen-thumbnail', piece.id, { headline, ...(withAi ? { backgroundPrompt: thumbPrompt.trim() } : {}) });
      setThumbHeadline('');
      setThumbPrompt('');
    })();
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
        //? F2 — the caption LOOK only matters for a burn-in; sending it otherwise would be noise.
        if (captionKey === 'burn') {
          payload.captionStyle = {
            fontSize: Number(ccSize) || 28,
            color: ccColor,
            ...(ccBoxed ? { boxed: true } : {}),
            ...(ccWordByWord ? { wordByWord: true } : {}),
          };
        }
        if (ctaText.trim()) payload.ctaText = ctaText.trim();
        payload.aspectRatio = aspectKey;
      }
      //? Gap-fix: assemble carries the chosen aspect + (optional) output template — its format +
      //? watermark position now actually drive the render.
      if (action.op === 'content-assemble') {
        payload.aspectRatio = aspectKey;
        if (templateKey) payload.templateId = templateKey;
      }
      runContentOp(action.op, piece.id, payload);
    })();
  };

  //? Request publish of a finished render to a connected platform. Confirmed (it's public + hard to undo),
  //? then fired as content-request-publish — which only PROPOSES it; the post happens on accept (B-23).
  const connectedPlatforms = content.publishTargets.filter((t) => t.connected).map((t) => t.platform);
  //? G1/CP1 — open the publish COMPOSER: per-platform caption + hashtags + privacy + optional schedule, then
  //? fire content-request-publish (which persists the variant + proposes the post; B-23 gated on accept).
  //? S2 — content-unpublish: retract a published post (confirmed; the platform delete is best-effort server-side).
  const unpublish = (assetId: string, platform: string) => {
    void menuHandler.confirm({ title: translate({ key: 'workspaces.content.unpublish' }), content: translate({ key: 'workspaces.content.unpublishConfirm', params: [{ key: 'platform', value: platform }] }) }).then((ok) => { if (ok) runContentOp('content-unpublish', piece.id, { assetId, platform }); });
  };
  const requestPublish = (assetId: string, platform: string) => {
    //? #140 — hand the composer this platform's connected accounts so it can offer an account picker.
    const accounts = content.publishTargets.find((t) => t.platform === platform)?.accounts ?? [];
    //? AI-disclosure default: the piece's channel prefills the synthetic-media checkbox (props-injected —
    //? menuHandler renders above WorkspacesProvider, lesson 0011).
    const pieceChannel = content.channels.find((c) => c.id === piece.channelId);
    const defaultSynthetic = pieceChannel?.aiDisclosureDefault ?? false;
    //? F41 — carry the channel's chosen account into the composer (props-injected, lesson 0011).
    const defaultAccountId = pieceChannel?.defaultAccountId ?? null;
    void menuHandler.open(
      <PublishComposer platform={platform} accounts={accounts} defaultSynthetic={defaultSynthetic} defaultAccountId={defaultAccountId} translate={translate} onSubmit={(fields) => {
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
  //? KG2 — transcode a finished mp4 to webm/gif (free — a local ffmpeg pass, no provider spend).
  const transcode = (assetId: string, format: 'webm' | 'gif') => { runContentOp('content-transcode', piece.id, { assetId, format }); notify.success({ key: 'workspaces.content.transcodeStarted' }); };
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

  //? Lifecycle ops that were previously only reachable via the AI chat — surfaced as a UI button + menu so a user
  //? can drive them directly (mobile + desktop). All go through the existing runContentOp dispatch.
  const pieceMenu: PopMenuItem[] = piece.status === 'archived'
    ? [{ label: translate({ key: 'workspaces.content.restorePiece' }), icon: 'rotate-left', onClick: () => { runContentOp('content-unarchive', piece.id, {}); } }]
    : [{ label: translate({ key: 'workspaces.content.archivePiece' }), icon: 'box-archive', danger: true, onClick: () => { void menuHandler.confirm({ title: translate({ key: 'workspaces.content.archivePiece' }), content: piece.title }).then((ok) => { if (ok) runContentOp('content-archive', piece.id, {}); }); } }];

  //? A "More generations" chip — same markup for every single-step action (per-action € label preserved).
  const genChip = (a: GenAction) => {
    const label = costLabel(a);
    return (
      <button key={a.op} type="button" onClick={() => { fire(a); }} className={`flex items-center gap-3 rounded-xl border border-container2-border bg-container2 hover:bg-container2-hover px-3 py-2.5 text-left cursor-pointer transition-colors motion-safe:active:scale-[0.98] ${FOCUS_RING}`}>
        <span className={`w-8 h-8 rounded-lg bg-container1 text-primary flex items-center justify-center shrink-0`}><Icon name={a.icon} /></span>
        <span className={`text-sm font-medium text-title`}>{translate({ key: a.labelKey })}</span>
        {label ? <span className={`ml-auto text-[11px] font-medium text-muted tabular-nums`}>{label}</span> : <Icon name="wand-magic-sparkles" className={`ml-auto text-muted`} />}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
        <IconButton icon="arrow-left" size="sm" title={translate({ key: 'workspaces.content.backToBoard' })} onClick={() => { navigate('content'); }} />
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
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Phone-first: at very narrow widths the Advance button drops its label to icon-only (title stays). */}
          <WsButton variant="secondary" icon="arrow-right" title={translate({ key: 'workspaces.content.advanceStage' })} onClick={() => { runContentOp('content-advance', piece.id, {}); }}>
            <span className={`hidden sm:inline`}>{translate({ key: 'workspaces.content.advanceStage' })}</span>
          </WsButton>
          <PopMenu items={pieceMenu} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        {/* The most confusing silent gate: with no fal key, media generation SUCCEEDS but yields placeholder
            `stub://` assets — it looks like it worked. Say so up front, at the place generation happens. */}
        {!readiness.media.fal && (
          <div className="mb-4">
            <SetupNotice
              variant="card"
              icon="wand-magic-sparkles"
              title={translate({ key: 'workspaces.setup.media.title' })}
              body={translate({ key: 'workspaces.setup.media.why' })}
              fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'admin', cta: translate({ key: 'workspaces.setup.media.cta' }) }}
            />
          </div>
        )}
        {/* Something is ready to ship but there is no connected account → the publish control just wasn't there.
            Only shown once an asset exists, so it's contextual, not nagging. */}
        {!readiness.publishing && piece.assets.length > 0 && (
          <div className="mb-4">
            <SetupNotice
              variant="card"
              icon="paper-plane"
              title={translate({ key: 'workspaces.setup.publishing.title' })}
              body={translate({ key: 'workspaces.setup.publishing.why' })}
              fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'channels', cta: translate({ key: 'workspaces.setup.publishing.cta' }) }}
            />
          </div>
        )}
        <div className={`w-full flex flex-col items-center gap-4`}>
        <div className={`max-w-3xl mx-auto w-full flex flex-col gap-4`}>
          {/* THE primary action — the one-shot whole-video pipeline, dominant above everything else. */}
          <section className={`rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3`}>
            <button type="button" onClick={() => { fire(PIPELINE_ACTION); }} className={`w-full flex items-center justify-center gap-3 rounded-xl bg-primary text-title-primary px-5 py-4 text-base font-semibold hover:bg-primary-hover cursor-pointer transition-colors motion-safe:active:scale-[0.99]`}>
              <Icon name="wand-magic-sparkles" className={`text-lg`} />
              <span>{translate({ key: PIPELINE_ACTION.labelKey })}</span>
              {pipelineCost && <span className={`rounded-md bg-title-primary/15 px-2 py-0.5 text-xs font-medium tabular-nums`}>{pipelineCost}</span>}
            </button>
            {/* Q1/B4 — the always-visible spend-transparency line: every generation is confirmed first. */}
            <div className={`flex items-start justify-center gap-2 text-xs text-muted`}>
              <Icon name="triangle-exclamation" className={`text-warning mt-0.5`} /> {translate({ key: 'workspaces.content.costWarning' })}
              {/* ADR 0312 — what-else-affects-it: the chip is ONE video-gen unit (registry.ts:38-50), while a run
                  generates one clip per scene (sceneDecompose.ts:72-90) and the scene count comes from the
                  duration preset (script.ts:36-40). */}
              <InfoTip
                align="center"
                label={translate({ key: 'workspaces.tips.piece.costTitle' })}
                title={translate({ key: 'workspaces.tips.piece.costTitle' })}
                body={translate({ key: 'workspaces.tips.piece.costBody' })}
                points={[
                  { id: 'scenes', label: translate({ key: 'workspaces.tips.piece.costScenes' }), desc: translate({ key: 'workspaces.tips.piece.costScenesDesc' }) },
                  { id: 'extras', label: translate({ key: 'workspaces.tips.piece.costExtras' }), desc: translate({ key: 'workspaces.tips.piece.costExtrasDesc' }) },
                ]}
              />
            </div>
            {/* The single-step generations — relocated behind a disclosure; same fire() path + confirms. */}
            <Disclosure summary={translate({ key: 'workspaces.content.moreGenerations' })}>
              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2`}>
                {MORE_ACTIONS.map((action) => genChip(action))}
              </div>
            </Disclosure>
          </section>

          {/* Creative direction — the slim core: these two inputs feed nearly every op (extraInstructions for
              generations, the prompt for shortform/instruct-edit/restyle/critique, the tweak for regenerate),
              so they stay visible between the generate area and the assets. */}
          <SectionCard title={translate({ key: 'workspaces.content.directionTitle' })} desc={translate({ key: 'workspaces.content.directionDesc' })}>
            <div className={`flex flex-col gap-3`}>
              {/* A <div>, not a <label>: the empty-state carries its own "create a style" button, and a label
                  would forward a click on the word "Style" straight into it. */}
              <div className="flex flex-col gap-1 text-sm">
                <span className={`flex items-center gap-1.5 text-muted`}>
                  {translate({ key: 'workspaces.content.styleLabel' })}
                  {/* ADR 0312 — where-does-this-come-from: the list is deduped across features (page.tsx:207) but
                      each step resolves the key against ITS OWN feature only (styles.ts:83-88), so a script style
                      silently does nothing to the video scenes. */}
                  <InfoTip
                    align="start"
                    label={translate({ key: 'workspaces.tips.piece.styleTitle' })}
                    title={translate({ key: 'workspaces.tips.piece.styleTitle' })}
                    body={translate({ key: 'workspaces.tips.piece.styleBody' })}
                    points={[
                      { id: 'step', label: translate({ key: 'workspaces.tips.piece.styleStep' }), desc: translate({ key: 'workspaces.tips.piece.styleStepDesc' }) },
                      {
                        id: 'where', label: translate({ key: 'workspaces.tips.piece.styleWhere' }), desc: translate({ key: 'workspaces.tips.piece.styleWhereDesc' }),
                        onGo: () => { focusSetup({ view: 'content/settings', tab: 'brand' }); }, goLabel: translate({ key: 'workspaces.tips.piece.styleWhereGo' }),
                      },
                    ]}
                  />
                </span>
                {/* Q3: pick a known style by name (deduped across features) instead of guessing a magic string.
                    ADR 0312 — with no styles the picker held one dead "No style" row (the global seed never runs
                    in production, styles.ts:72-79), so say what a style is and where it is made instead. */}
                {styleItems.length > 1
                  ? <Dropdown size="md" width="full" value={styleItems.find((i) => i.id === styleKey)} items={styleItems} onChange={(it) => { setStyleKey(String(it.id)); }} />
                  : (
                    <EmptyPicker
                      icon="wand-magic-sparkles"
                      label={translate({ key: 'workspaces.tips.piece.styleEmpty' })}
                      fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'brand', cta: translate({ key: 'workspaces.tips.piece.styleEmptyCta' }) }}
                    />
                  )}
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
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className={`flex items-center gap-1.5 text-muted`}>
                  {translate({ key: 'workspaces.content.extraLabel' })}
                  {/* ADR 0312 — what-else-affects-it: the script prompt is composed brand → knowledge → best-
                      practices → inspiration → style → THIS text, in that order (script.ts:105-113). */}
                  <InfoTip
                    align="start"
                    label={translate({ key: 'workspaces.tips.piece.directionTitle' })}
                    title={translate({ key: 'workspaces.tips.piece.directionTitle' })}
                    body={translate({ key: 'workspaces.tips.piece.directionBody' })}
                    points={[
                      {
                        id: 'brand', label: translate({ key: 'workspaces.tips.piece.directionBrand' }), desc: translate({ key: 'workspaces.tips.piece.directionBrandDesc' }),
                        onGo: () => { focusSetup({ view: 'content/settings', tab: 'brand' }); }, goLabel: translate({ key: 'workspaces.tips.piece.directionBrandGo' }),
                      },
                      {
                        id: 'voice', label: translate({ key: 'workspaces.tips.piece.directionVoice' }), desc: translate({ key: 'workspaces.tips.piece.directionVoiceDesc' }),
                        onGo: () => { focusSetup({ view: 'content/settings', tab: 'channels' }); }, goLabel: translate({ key: 'workspaces.tips.piece.directionVoiceGo' }),
                      },
                      {
                        id: 'docs', label: translate({ key: 'workspaces.tips.piece.directionDocs' }), desc: translate({ key: 'workspaces.tips.piece.directionDocsDesc' }),
                        onGo: () => { navigate('sources'); }, goLabel: translate({ key: 'workspaces.tips.piece.directionDocsGo' }),
                      },
                    ]}
                  />
                </span>
                <textarea value={extra} onChange={(e) => { setExtra(e.target.value); }} rows={3} placeholder={translate({ key: 'workspaces.content.extraPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none" />
              </label>
              {/* Output/render settings — they only affect pipeline/assemble, so they live one tap away. */}
              <Disclosure summary={translate({ key: 'workspaces.content.outputSettings' })}>
                <div className={`flex flex-col gap-3`}>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">{translate({ key: 'workspaces.content.durationLabel' })}</span>
                    <Dropdown size="md" width="full" value={durationItems.find((i) => i.id === durationKey)} items={durationItems} onChange={(it) => { setDurationKey(String(it.id)); }} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">{translate({ key: 'workspaces.content.captionLabel' })}</span>
                    <Dropdown size="md" width="full" value={captionItems.find((i) => i.id === captionKey)} items={captionItems} onChange={(it) => { setCaptionKey(String(it.id)); }} />
                  </label>
                  {/* GAP_SCAN F2 — how burned-in captions LOOK. Only meaningful with caption delivery on 'burn';
                      a soft track is styled by the player, and sidecar files carry no styling at all. */}
                  {captionKey === 'burn' && (
                    <div className={`rounded-xl border border-container2-border bg-container2/50 p-3 flex flex-col gap-2`}>
                      <div>
                        <div className={`text-sm font-medium text-title`}>{translate({ key: 'workspaces.content.captionStyleTitle' })}</div>
                        <div className={`text-xs text-muted`}>{translate({ key: 'workspaces.content.captionStyleDesc' })}</div>
                      </div>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-muted">{translate({ key: 'workspaces.content.captionSize' })}</span>
                        <input type="number" min="12" max="80" value={ccSize} onChange={(e) => { setCcSize(e.target.value); }} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-muted">{translate({ key: 'workspaces.content.captionColor' })}</span>
                        <input value={ccColor} onChange={(e) => { setCcColor(e.target.value.replace('#', '')); }} placeholder="ffffff" className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                      </label>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted">{translate({ key: 'workspaces.content.captionBoxed' })}</span>
                        <Toggle on={ccBoxed} onChange={setCcBoxed} label="" />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted">{translate({ key: 'workspaces.content.captionWordByWord' })}</span>
                        <Toggle on={ccWordByWord} onChange={setCcWordByWord} label="" />
                      </div>
                    </div>
                  )}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">{translate({ key: 'workspaces.content.aspectLabel' })}</span>
                    <Dropdown size="md" width="full" value={aspectItems.find((i) => i.id === aspectKey)} items={aspectItems} onChange={(it) => { setAspectKey(String(it.id)); }} />
                  </label>
                  {/* A <div>, not a <label>: the empty-state carries its own "create a template" button. */}
                  <div className="flex flex-col gap-1 text-sm">
                    <span className={`flex items-center gap-1.5 text-muted`}>
                      {translate({ key: 'workspaces.content.templateLabel' })}
                      {/* ADR 0312 — what-happens-if-i-change-it: the pipeline never reads templateId
                          (conductor.ts:2855-2886); on assemble the template's format overwrites the chosen
                          aspect ratio (conductor.ts:3395-3409). */}
                      <InfoTip
                        align="start"
                        label={translate({ key: 'workspaces.tips.piece.templateTitle' })}
                        title={translate({ key: 'workspaces.tips.piece.templateTitle' })}
                        body={translate({ key: 'workspaces.tips.piece.templateBody' })}
                        points={[
                          { id: 'assemble', label: translate({ key: 'workspaces.tips.piece.templateUse' }), desc: translate({ key: 'workspaces.tips.piece.templateUseDesc' }) },
                          { id: 'aspect', label: translate({ key: 'workspaces.tips.piece.templateAspect' }), desc: translate({ key: 'workspaces.tips.piece.templateAspectDesc' }) },
                        ]}
                      />
                    </span>
                    {/* ADR 0312 — with no templates the whole field used to disappear, so the feature was
                        invisible; name it and point at where templates are made instead. */}
                    {templateItems.length > 1
                      ? <Dropdown size="md" width="full" value={templateItems.find((i) => i.id === templateKey) ?? templateItems[0]} items={templateItems} onChange={(it) => { setTemplateKey(String(it.id)); }} />
                      : (
                        <EmptyPicker
                          icon="diagram-project"
                          label={translate({ key: 'workspaces.tips.piece.templateEmpty' })}
                          fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'brand', cta: translate({ key: 'workspaces.tips.piece.templateEmptyCta' }) }}
                        />
                      )}
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">{translate({ key: 'workspaces.content.ctaLabel' })}</span>
                    <input value={ctaText} onChange={(e) => { setCtaText(e.target.value); }} placeholder={translate({ key: 'workspaces.content.ctaPlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">{translate({ key: 'workspaces.content.referenceLabel' })}</span>
                    <input value={referenceUrl} onChange={(e) => { setReferenceUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.referencePlaceholder' })} className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                    {/* K1: upload your own reference instead of pasting a URL. */}
                    <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.content.uploadReference" icon="up-right-from-square" onUploaded={(url) => { setReferenceUrl(url); }} />
                  </label>
                </div>
              </Disclosure>
            </div>
          </SectionCard>
        </div>

          {/* Assets — everything this piece has produced (or imported). The assets ARE the visual product of
              this page, so this container grows well past the narrow text column above instead of squeezing
              the grid into the same 768px as the creative-direction form. */}
          <div className={`max-w-6xl mx-auto w-full flex flex-col gap-4`}>
          <SectionCard
            title={translate({ key: 'workspaces.content.assetsTitle' })}
            right={
              <div className={`flex flex-wrap items-center justify-end gap-2`}>
                {/* V5 — the video timeline editor (scenes + trim/transition/split + range-refine + decompose). */}
                <WsButton variant="secondary" icon="table-columns" title={translate({ key: 'workspaces.timeline.open' })} onClick={() => { setShowTimeline(true); }}>
                  {translate({ key: 'workspaces.timeline.open' })}
                  <span className={`text-xs text-muted tabular-nums`}>{piece.scenes.length} {translate({ key: 'workspaces.timeline.scenes' })}</span>
                </WsButton>
                {/* K1: bring your own image/video into the piece as a first-class asset. */}
                {piece.assets.length > 0 && <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*,video/*" labelKey="workspaces.content.importOwn" onUploaded={(url, kind) => { runContentOp('content-import-asset', piece.id, { url, kind }); }} />}
              </div>
            }
          >
            {piece.assets.length === 0 ? (
              //? The teaching empty state: what this place is for + the primary action to start (and the
              //? import-your-own upload as the quiet secondary while the header slot is hidden).
              <EmptyState
                icon="wand-magic-sparkles"
                title={translate({ key: 'workspaces.content.assetsEmptyTitle' })}
                sub={translate({ key: 'workspaces.content.assetsEmptyTeach' })}
                action={
                  <div className={`flex flex-col items-center gap-2`}>
                    <WsButton icon="wand-magic-sparkles" onClick={() => { fire(PIPELINE_ACTION); }}>
                      {translate({ key: PIPELINE_ACTION.labelKey })}
                      {pipelineCost && <span className={`text-xs opacity-80 tabular-nums`}>{pipelineCost}</span>}
                    </WsButton>
                    <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*,video/*" labelKey="workspaces.content.importOwn" onUploaded={(url, kind) => { runContentOp('content-import-asset', piece.id, { url, kind }); }} />
                  </div>
                }
              />
            ) : (
              <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2`}>
                {piece.assets.map((a) => <AssetCard key={a.id} asset={a} connectedPlatforms={connectedPlatforms} onPublish={requestPublish} onUnpublish={unpublish} onRegenerate={regenerate} onEditRegion={setEditRegionAsset} onEditImage={setEditImageAsset} onCritique={critique} onInstructEdit={instructEdit} onRestyle={restyle} onTranscode={transcode} onTrimAudio={trimAudio} translate={translate} />)}
              </div>
            )}
          </SectionCard>
          </div>

          <div className={`max-w-3xl mx-auto w-full flex flex-col gap-4`}>
          {/* The occasional tools, grouped behind ONE disclosure so they never stack between the core inputs. */}
          <Disclosure summary={translate({ key: 'workspaces.content.toolsTitle' })}>
            <div className={`flex flex-col gap-3`}>
              <div className={`text-xs text-muted`}>{translate({ key: 'workspaces.content.toolsDesc' })}</div>
              {/* Single active tool panel (Segmented) instead of four more nested Disclosures — the audit's
                  "three layers of identical accordions" finding. Two levels now: this Disclosure, then the
                  panel below in a visibly lighter shell. */}
              <Segmented
                options={[
                  { id: 'capture', ariaLabel: translate({ key: 'workspaces.content.toolCapture' }), label: <><Icon name="display" /><span className="hidden sm:inline">{translate({ key: 'workspaces.content.toolCapture' })}</span></> },
                  { id: 'analyze', ariaLabel: translate({ key: 'workspaces.content.toolAnalyze' }), label: <><Icon name="eye" /><span className="hidden sm:inline">{translate({ key: 'workspaces.content.toolAnalyze' })}</span></> },
                  { id: 'seo', ariaLabel: translate({ key: 'workspaces.content.toolSeo' }), label: <><Icon name="magnifying-glass" /><span className="hidden sm:inline">{translate({ key: 'workspaces.content.toolSeo' })}</span></> },
                  { id: 'thumb', ariaLabel: translate({ key: 'workspaces.content.toolThumb' }), label: <><Icon name="image" /><span className="hidden sm:inline">{translate({ key: 'workspaces.content.toolThumb' })}</span></> },
                ]}
                value={activeTool}
                onChange={setActiveTool}
              />
              <div className={`rounded-xl border border-container2-border bg-container2/50 p-3 flex flex-col gap-2`}>
                {activeTool === 'capture' && (<>
                  {/* capture-run (I1/I2 demo recorder). */}
                  <div className="text-xs text-muted">{translate({ key: 'workspaces.content.captureDesc' })}</div>
                  <input value={captureUrl} onChange={(e) => { setCaptureUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.captureUrlPlaceholder' })} className="rounded-lg border border-container1-border bg-container1 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                  <input value={captureGoal} onChange={(e) => { setCaptureGoal(e.target.value); }} placeholder={translate({ key: 'workspaces.content.captureGoalPlaceholder' })} className="rounded-lg border border-container1-border bg-container1 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                  <button type="button" disabled={!/^https?:\/\//.test(captureUrl.trim())} onClick={() => { runContentOp('capture-run', piece.id, { url: captureUrl.trim(), ...(captureGoal.trim() ? { goal: captureGoal.trim() } : {}) }); setCaptureUrl(''); setCaptureGoal(''); }} className={`self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${FOCUS_RING}`}>{translate({ key: 'workspaces.content.captureBtn' })}</button>
                </>)}
                {activeTool === 'analyze' && (<>
                  {/* content-analyze-reference-video — seed a script from a reference video. */}
                  <div className="text-xs text-muted">{translate({ key: 'workspaces.content.analyzeVideoDesc' })}</div>
                  <input value={analyzeVideoUrl} onChange={(e) => { setAnalyzeVideoUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.content.analyzeVideoUrlPlaceholder' })} className="rounded-lg border border-container1-border bg-container1 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                  <textarea value={analyzeStory} onChange={(e) => { setAnalyzeStory(e.target.value); }} rows={2} placeholder={translate({ key: 'workspaces.content.analyzeStoryPlaceholder' })} className="rounded-lg border border-container1-border bg-container1 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none" />
                  <button type="button" disabled={!/^https?:\/\//.test(analyzeVideoUrl.trim()) || analyzeStory.trim().length === 0} onClick={() => { runContentOp('content-analyze-reference-video', piece.id, { referenceVideoUrl: analyzeVideoUrl.trim(), newStory: analyzeStory.trim() }); setAnalyzeVideoUrl(''); setAnalyzeStory(''); }} className={`self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${FOCUS_RING}`}>{translate({ key: 'workspaces.content.analyzeVideoBtn' })}</button>
                </>)}
                {activeTool === 'seo' && (<>
                  {/* GAP_SCAN F3 — title/description/tag suggestions, scored against THIS account's own view
                      counts. The deterministic score works with no key; the alternatives need a provider. */}
                  <div className="text-xs text-muted">{translate({ key: 'workspaces.content.seoDesc' })}</div>
                  <button type="button" disabled={seoBusy} onClick={loadSeo} className={`self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${FOCUS_RING}`}>
                    {translate({ key: seoBusy ? 'workspaces.content.seoBusy' : 'workspaces.content.seoAnalyze' })}
                  </button>
                  {seo && (
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${seo.score >= 80 ? 'text-correct' : (seo.score >= 50 ? 'text-warning' : 'text-wrong')}`}>{String(seo.score)}{translate({ key: 'workspaces.content.seoOutOf' })}</span>
                        {!seo.aiOk && <span className="text-[11px] text-muted">{translate({ key: 'workspaces.content.seoScoreOnly' })}</span>}
                      </div>
                      {seo.issues.length > 0 && (
                        <ul className="flex flex-col gap-0.5">
                          {seo.issues.map((issue) => <li key={issue} className="text-xs text-muted">{translate({ key: `workspaces.content.${issue}` })}</li>)}
                        </ul>
                      )}
                      {seo.titles.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-muted">{translate({ key: 'workspaces.content.seoAlternatives' })}</span>
                          {seo.titles.map((t) => <div key={t} className="text-sm text-title rounded-lg border border-container1-border bg-container1 px-2.5 py-1.5">{t}</div>)}
                        </div>
                      )}
                      {seo.tags.length > 0 && <div className="text-xs text-muted">{translate({ key: 'workspaces.content.seoTags' })}{': '}{seo.tags.join(', ')}</div>}
                    </div>
                  )}
                </>)}
                {activeTool === 'thumb' && (<>
                  {/* GAP_SCAN F1 — compose a thumbnail: headline over a background. The template path is FREE
                      (no key, no spend); adding a background prompt makes it a paid image-gen, cost-confirmed. */}
                  <div className="text-xs text-muted">{translate({ key: 'workspaces.content.thumbDesc' })}</div>
                  <input value={thumbHeadline} onChange={(e) => { setThumbHeadline(e.target.value); }} placeholder={piece.title} className="rounded-lg border border-container1-border bg-container1 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                  <input value={thumbPrompt} onChange={(e) => { setThumbPrompt(e.target.value); }} placeholder={translate({ key: 'workspaces.content.thumbBgPlaceholder' })} className="rounded-lg border border-container1-border bg-container1 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring" />
                  <button type="button" onClick={composeThumbnail} className={`self-start rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover cursor-pointer flex items-center gap-1.5 ${FOCUS_RING}`}>
                    <Icon name="image" /> {translate({ key: thumbPrompt.trim().length > 0 ? 'workspaces.content.thumbComposeAi' : 'workspaces.content.thumbCompose' })}
                  </button>
                </>)}
              </div>
            </div>
          </Disclosure>
          </div>
        </div>
      </div>
      {editRegionAsset && <ImageRegionEditor pieceId={piece.id} asset={{ id: editRegionAsset.id, url: editRegionAsset.url }} onClose={() => { setEditRegionAsset(null); }} />}
      {editImageAsset && <ImageEditor pieceId={piece.id} asset={{ id: editImageAsset.id, url: editImageAsset.url }} onClose={() => { setEditImageAsset(null); }} />}
      {showTimeline && <VideoTimelineEditor pieceId={piece.id} scenes={piece.scenes} assetUrls={sceneAssetUrls} pickableAssets={pickableSceneAssets} voiceUrl={piece.voiceUrl} musicUrl={piece.musicUrl} voiceVolume={piece.voiceVolume} musicVolume={piece.musicVolume} onClose={() => { setShowTimeline(false); }} />}
    </div>
  );
}
