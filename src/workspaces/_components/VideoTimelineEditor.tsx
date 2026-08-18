//? V5 (IDEA_TO_OUTCOME) — the video timeline editor. Renders a piece's VideoScenes as proportional blocks and
//? drives the V1/V3/V4 ops: edit a scene's duration (trim) + transition, split/delete/reorder, save the whole
//? ordered list (content-save-scenes, upsert by id), select a time range → refine it (content-refine-range),
//? and (re)generate scenes from the script (content-decompose-video). All writes go through runContentOp → the
//? Conductor (B-23). Reorder/split/trim are buttons + inputs (reliable) rather than raw drag; drag is a
//? follow-up. Rendered as a modal from the content piece page. Browser-verify pending the dev server.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslator, i18nNotify as notify, tryCatch } from '@luckystack/core/client';

import Dropdown from 'src/_components/dropdown/Dropdown';

import type { VideoSceneSummary } from '../_data/types';
import { useEscapeKey } from '../_functions/useEscapeKey';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import Icon from './Icon';
import { WsButton } from './primitives';
import { EmptyPicker } from './SetupNotice';

type EditScene = VideoSceneSummary;
type Transition = 'cut' | 'fade' | 'xfade';
const TRANSITIONS: Transition[] = ['cut', 'fade', 'xfade'];
const clampDur = (ms: number): number => Math.max(500, Math.min(60_000, Math.round(ms)));
const WAVE_BARS = 60;

//? V5 — decode an audio asset into WAVE_BARS per-block peak amplitudes (0..1) via the Web Audio API. Throws
//? on no AudioContext / fetch / decode failure; the caller wraps it in tryCatch and falls back to a baseline.
async function decodePeaks(url: string): Promise<number[]> {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  const ac = new globalThis.AudioContext();
  const decoded = await ac.decodeAudioData(buf);
  void ac.close();
  const data = decoded.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / WAVE_BARS));
  const peaks: number[] = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    let max = 0;
    for (let j = 0; j < block; j++) { const v = Math.abs(data[i * block + j] ?? 0); if (v > max) max = v; }
    peaks.push(max);
  }
  return peaks;
}

//? V5 audio-track — a real waveform for an audio asset (peak bars). Theme-driven (fillStyle reads the
//? canvas's resolved `text-primary` colour, no hardcoded hex). Degrades to a flat baseline when the asset
//? can't be fetched/decoded (stub url, no network, no AudioContext).
function Waveform({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const color = getComputedStyle(canvas).color || 'gray';
    const draw = (peaks: number[]): void => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const bw = w / peaks.length;
      for (const [i, p] of peaks.entries()) { const bh = Math.max(1, p * h); ctx.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 1), bh); }
    };
    void (async () => {
      const [, peaks] = await tryCatch(() => decodePeaks(url));
      //? peaks is null when the decode failed (tryCatch's error path) → fall back to a flat baseline. The
      //? type-lint views tryCatch's result as non-null, but at runtime it genuinely can be null here.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime-null on decode failure feeds the baseline
      if (!cancelled) draw(peaks && peaks.length > 0 ? peaks : Array.from({ length: WAVE_BARS }, () => 0.12));
    })();
    return () => { cancelled = true; };
  }, [url]);
  return <canvas ref={ref} width={480} height={36} className="w-full h-9 rounded bg-container2 text-primary" />;
}

//? F8 — client-side timeline preview: play the scenes in sequence (a clip seeked to its trim-in + played, a
//? still shown for its duration), so the user can eyeball the cut BEFORE paying for a render. Muted + local +
//? free; transitions are approximated with a short CSS opacity fade. `urlOf` resolves a scene's asset id → a
//? playable url (built by the piece page from its assets). Advance is timer-driven off each scene's durationMs.
function PreviewPlayer({ scenes, urlOf, translate }: { scenes: EditScene[]; urlOf: (id: string | null) => string | null; translate: ReturnType<typeof useTranslator> }) {
  const [idx, setIdx] = useState(-1);
  const [fade, setFade] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = (): void => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (fadeRef.current) { clearTimeout(fadeRef.current); fadeRef.current = null; }
  };
  const stop = (): void => { clearTimers(); setIdx(-1); setFade(false); };
  const playFrom = (i: number): void => {
    if (i >= scenes.length) { stop(); return; }
    //? Approximate a fade/xfade transition with a brief opacity dip on the incoming scene (cuts don't dip).
    if (i > 0 && scenes[i]?.transitionIn !== 'cut') { setFade(true); fadeRef.current = setTimeout(() => { setFade(false); }, 250); }
    setIdx(i);
    timerRef.current = setTimeout(() => { playFrom(i + 1); }, Math.max(300, scenes[i]?.durationMs ?? 1000));
  };
  useEffect(() => () => { clearTimers(); }, []);

  const cur = idx >= 0 ? scenes[idx] : null;
  const curVideo = cur ? urlOf(cur.videoAssetId) : null;
  const curImage = cur ? urlOf(cur.imageAssetId) : null;
  useEffect(() => {
    const v = videoRef.current;
    if (v && curVideo && cur) { v.currentTime = cur.startTrimMs / 1000; void v.play().catch(() => { /* autoplay may be blocked; the frame still shows */ }); }
  }, [idx, curVideo, cur]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <WsButton icon={idx >= 0 ? 'stop' : 'play'} variant="secondary" onClick={() => { if (idx >= 0) stop(); else playFrom(0); }}>{translate({ key: idx >= 0 ? 'workspaces.timeline.stopPreview' : 'workspaces.timeline.preview' })}</WsButton>
        {idx >= 0 && <span className="text-xs text-muted">{translate({ key: 'workspaces.timeline.scene' })} {idx + 1}/{scenes.length}</span>}
      </div>
      {idx >= 0 && (
        <div className={`w-full aspect-video rounded-lg overflow-hidden bg-black flex items-center justify-center transition-opacity duration-200 ${fade ? 'opacity-0' : 'opacity-100'}`}>
          {curVideo
            // eslint-disable-next-line jsx-a11y/media-has-caption -- muted local preview of the user's own clip; captions n/a
            ? <video ref={videoRef} src={curVideo} muted autoPlay playsInline className="w-full h-full object-contain" />
            : (curImage ? <img src={curImage} alt="" className="w-full h-full object-contain" /> : <Icon name="film" className="text-2xl text-muted" />)}
        </div>
      )}
    </div>
  );
}

export default function VideoTimelineEditor({ pieceId, scenes, assetUrls, pickableAssets, voiceUrl, musicUrl, voiceVolume, musicVolume, onClose }: { pieceId: string; scenes: VideoSceneSummary[]; assetUrls: Record<string, string>; pickableAssets: { id: string; kind: string }[]; voiceUrl: string | null; musicUrl: string | null; voiceVolume: number; musicVolume: number; onClose: () => void }) {
  const translate = useTranslator();
  const { runContentOp } = useWorkspaces();
  useEscapeKey(onClose);
  const urlOf = useMemo(() => (id: string | null): string | null => (id ? (assetUrls[id] ?? null) : null), [assetUrls]);

  const [local, setLocal] = useState<EditScene[]>(() => scenes.toSorted((a, b) => a.order - b.order));
  const [selected, setSelected] = useState(0);
  const [refineStart, setRefineStart] = useState(0);
  const [refineEnd, setRefineEnd] = useState(5);
  const [instruction, setInstruction] = useState('');
  const [voiceVol, setVoiceVol] = useState(voiceVolume);
  const [musicVol, setMusicVol] = useState(musicVolume);
  //? V-upload — the asset chosen in the "add scene from an asset" picker (an uploaded/generated video or image).
  const [pickAssetId, setPickAssetId] = useState('');

  const totalMs = useMemo(() => local.reduce((sum, s) => sum + s.durationMs, 0), [local]);
  const transitionItems = TRANSITIONS.map((t) => ({ id: t, value: t, item: translate({ key: `workspaces.timeline.t_${t}` }) }));
  const totalLabel = `${translate({ key: 'workspaces.timeline.total' })}: ${(totalMs / 1000).toFixed(1)}s · ${String(local.length)} ${translate({ key: 'workspaces.timeline.scenes' })}`;

  //? Reorder helpers keep `order` in sync with the array index (the server re-sequences on save too).
  const resequence = (list: EditScene[]): EditScene[] => list.map((s, i) => ({ ...s, order: i }));
  const update = (idx: number, patch: Partial<EditScene>): void => { setLocal((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))); };
  const move = (idx: number, dir: -1 | 1): void => {
    const j = idx + dir;
    if (j < 0 || j >= local.length) return;
    setLocal((prev) => { const next = [...prev]; const a = next[idx]; const b = next[j]; if (a && b) { next[idx] = b; next[j] = a; } return resequence(next); });
    setSelected(j);
  };
  const del = (idx: number): void => { setLocal((prev) => resequence(prev.filter((_, i) => i !== idx))); setSelected((s) => Math.max(0, s > idx ? s - 1 : s)); };
  //? Add a NEW scene from an existing asset (an uploaded/generated video or image) — appended at the end, id=''
  //? so the server creates it on save (content-save-scenes, which already accepts videoAssetId/imageAssetId).
  const addSceneFromAsset = (assetId: string): void => {
    const kind = pickableAssets.find((a) => a.id === assetId)?.kind;
    if (!assetId || kind === undefined) return;
    const isVideo = kind === 'video';
    setLocal((prev) => resequence([...prev, {
      id: '', order: prev.length,
      videoAssetId: isVideo ? assetId : null, imageAssetId: isVideo ? null : assetId,
      startTrimMs: 0, endTrimMs: null, durationMs: 5000, transitionIn: prev.length === 0 ? 'cut' : 'xfade', prompt: null,
    }]));
    setSelected(local.length);
  };
  const split = (idx: number): void => {
    setLocal((prev) => {
      const s = prev[idx];
      if (!s) return prev;
      const half = clampDur(s.durationMs / 2);
      const left: EditScene = { ...s, durationMs: half };
      //? The right half is a NEW scene (no id → created on save); it starts where the left half ended.
      const right: EditScene = { ...s, id: '', durationMs: clampDur(s.durationMs - half), startTrimMs: s.startTrimMs + half, transitionIn: 'cut', order: s.order + 1 };
      return resequence([...prev.slice(0, idx), left, right, ...prev.slice(idx + 1)]);
    });
  };

  const save = (): void => {
    const payload = local.map((s) => ({
      ...(s.id ? { id: s.id } : {}), ...(s.videoAssetId ? { videoAssetId: s.videoAssetId } : {}), ...(s.imageAssetId ? { imageAssetId: s.imageAssetId } : {}),
      startTrimMs: s.startTrimMs, ...(s.endTrimMs === null ? {} : { endTrimMs: s.endTrimMs }), durationMs: s.durationMs, transitionIn: s.transitionIn, ...(s.prompt ? { prompt: s.prompt } : {}),
    }));
    runContentOp('content-save-scenes', pieceId, { scenes: payload });
    notify.success({ key: 'workspaces.timeline.saved' });
    onClose();
  };

  const refine = (): void => {
    if (instruction.trim().length === 0) return;
    runContentOp('content-refine-range', pieceId, { startMs: Math.round(refineStart * 1000), endMs: Math.round(refineEnd * 1000), instruction: instruction.trim() });
    notify.success({ key: 'workspaces.timeline.refineQueued' });
    setInstruction('');
  };

  //? V5 — persist the audio mix (voice gain + ducked music gain) for the next render.
  const saveAudioMix = (): void => {
    runContentOp('content-save-audio-mix', pieceId, { voiceVolume: voiceVol, musicVolume: musicVol });
    notify.success({ key: 'workspaces.timeline.audioSaved' });
  };

  const sel = local[selected];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div className="rounded-2xl border border-container1-border bg-background p-4 max-w-3xl w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={(e) => { e.stopPropagation(); }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.timeline.title' })}</div>
          <button type="button" onClick={onClose} className="text-muted hover:text-title cursor-pointer"><Icon name="xmark" /></button>
        </div>

        {local.length === 0
          ? <div className="text-sm text-muted py-6 text-center">{translate({ key: 'workspaces.timeline.empty' })}</div>
          : (
            <div className="flex gap-1 w-full h-16 rounded-lg overflow-hidden border border-divider">
              {local.map((s, i) => (
                <button
                  key={s.id.length > 0 ? s.id : `new-${String(i)}`} type="button" onClick={() => { setSelected(i); }}
                  style={{ flexGrow: Math.max(1, s.durationMs) }}
                  className={`relative min-w-8 flex flex-col items-center justify-center text-[10px] gap-0.5 transition-colors cursor-pointer ${i === selected ? 'bg-primary/20 text-title' : 'bg-container2 text-muted hover:bg-container2-hover'}`}
                  title={`${(s.durationMs / 1000).toFixed(1)}s · ${s.transitionIn}`}
                >
                  <Icon name={s.videoAssetId ? 'play' : 'eye'} />
                  <span>{(s.durationMs / 1000).toFixed(1)}s</span>
                </button>
              ))}
            </div>
          )}
        <div className="text-xs text-muted">{totalLabel}</div>

        {/* V-upload — add a scene from an existing asset (an uploaded or generated video/image).
            ADR 0312 — with nothing pickable the control used to vanish without a word; say what would fill it
            (a ready video/image on this piece — the piece page's generate or import actions). */}
        {pickableAssets.length === 0 && <EmptyPicker icon="film" label={translate({ key: 'workspaces.tips.piece.timelineAssetsEmpty' })} />}
        {pickableAssets.length > 0 && (
          <div className="flex items-center gap-2">
            <Dropdown size="sm" items={pickableAssets.map((a, i) => ({ id: a.id, value: a.id, item: `${a.kind} ${String(i + 1)}` }))} value={pickableAssets.map((a, i) => ({ id: a.id, value: a.id, item: `${a.kind} ${String(i + 1)}` })).find((it) => it.id === pickAssetId)} onChange={(it) => { setPickAssetId(String(it.value)); }} />
            <WsButton variant="secondary" icon="plus" disabled={!pickAssetId} onClick={() => { addSceneFromAsset(pickAssetId); setPickAssetId(''); }}>{translate({ key: 'workspaces.timeline.addScene' })}</WsButton>
          </div>
        )}

        {/* F8 — free client-side preview of the cut before rendering. */}
        {local.length > 0 && <PreviewPlayer scenes={local} urlOf={urlOf} translate={translate} />}

        {sel && (
          <div className="rounded-xl border border-container1-border bg-container1 p-3 flex flex-col gap-2">
            <div className="text-sm font-medium text-title">{translate({ key: 'workspaces.timeline.scene' })} {selected + 1}</div>
            <label className="flex items-center gap-2 text-sm text-common">
              <span className="w-24 shrink-0 text-muted">{translate({ key: 'workspaces.timeline.duration' })}</span>
              <input type="number" min={0.5} max={60} step={0.5} value={(sel.durationMs / 1000).toFixed(1)} onChange={(e) => { update(selected, { durationMs: clampDur(Number(e.target.value) * 1000) }); }} className="w-24 rounded-lg border border-container1-border bg-background px-2 py-1 text-sm text-common" />
            </label>
            <div className="flex items-center gap-2 text-sm text-common">
              <span className="w-24 shrink-0 text-muted">{translate({ key: 'workspaces.timeline.transition' })}</span>
              <Dropdown size="sm" items={transitionItems} value={transitionItems.find((i) => i.id === sel.transitionIn)} onChange={(it) => { update(selected, { transitionIn: String(it.value) }); }} />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <WsButton variant="ghost" onClick={() => { move(selected, -1); }}><Icon name="angle-left" /> {translate({ key: 'workspaces.timeline.moveLeft' })}</WsButton>
              <WsButton variant="ghost" onClick={() => { move(selected, 1); }}>{translate({ key: 'workspaces.timeline.moveRight' })} <Icon name="angle-right" /></WsButton>
              <WsButton variant="ghost" onClick={() => { split(selected); }}><Icon name="code-branch" /> {translate({ key: 'workspaces.timeline.split' })}</WsButton>
              <WsButton variant="ghost" onClick={() => { del(selected); }}><Icon name="trash" /> {translate({ key: 'workspaces.timeline.delete' })}</WsButton>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-container1-border bg-container1 p-3 flex flex-col gap-2">
          <div className="text-sm font-medium text-title">{translate({ key: 'workspaces.timeline.refineTitle' })}</div>
          <div className="flex items-center gap-2 text-sm text-common">
            <input type="number" min={0} step={0.5} value={refineStart} onChange={(e) => { setRefineStart(Number(e.target.value)); }} className="w-20 rounded-lg border border-container1-border bg-background px-2 py-1" />
            <span className="text-muted">–</span>
            <input type="number" min={0} step={0.5} value={refineEnd} onChange={(e) => { setRefineEnd(Number(e.target.value)); }} className="w-20 rounded-lg border border-container1-border bg-background px-2 py-1" />
            <span className="text-muted text-xs">{translate({ key: 'workspaces.timeline.seconds' })}</span>
          </div>
          <input type="text" value={instruction} onChange={(e) => { setInstruction(e.target.value); }} placeholder={translate({ key: 'workspaces.timeline.instructionPlaceholder' })} className="rounded-lg border border-container1-border bg-background px-2 py-1 text-sm text-common" />
          <WsButton variant="secondary" onClick={refine} disabled={instruction.trim().length === 0}><Icon name="wand-magic-sparkles" /> {translate({ key: 'workspaces.timeline.refine' })}</WsButton>
        </div>

        {/* V5 — the audio track: waveform per audio asset + voice/duck sliders that feed the render mix. */}
        <div className="rounded-xl border border-container1-border bg-container1 p-3 flex flex-col gap-3">
          <div className="text-sm font-medium text-title">{translate({ key: 'workspaces.timeline.audioTitle' })}</div>
          {voiceUrl === null && musicUrl === null && <div className="text-xs text-muted">{translate({ key: 'workspaces.timeline.audioEmpty' })}</div>}
          {voiceUrl !== null && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.timeline.voice' })}</span>
              <Waveform url={voiceUrl} />
              <input type="range" min={0} max={2} step={0.05} value={voiceVol} onChange={(e) => { setVoiceVol(Number(e.target.value)); }} className="accent-primary" />
            </div>
          )}
          {musicUrl !== null && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.timeline.music' })}</span>
              <Waveform url={musicUrl} />
              <input type="range" min={0} max={1} step={0.05} value={musicVol} onChange={(e) => { setMusicVol(Number(e.target.value)); }} className="accent-primary" />
            </div>
          )}
          {(voiceUrl !== null || musicUrl !== null) && (
            <WsButton variant="secondary" onClick={saveAudioMix}><Icon name="wave-square" /> {translate({ key: 'workspaces.timeline.audioSave' })}</WsButton>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <WsButton variant="ghost" onClick={() => { runContentOp('content-decompose-video', pieceId, {}); notify.success({ key: 'workspaces.timeline.decomposeQueued' }); }}><Icon name="bolt" /> {translate({ key: 'workspaces.timeline.decompose' })}</WsButton>
          <WsButton variant="primary" onClick={save}><Icon name="check" /> {translate({ key: 'workspaces.timeline.save' })}</WsButton>
        </div>
      </div>
    </div>
  );
}
