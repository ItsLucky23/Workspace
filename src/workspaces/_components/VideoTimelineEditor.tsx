//? V5 (IDEA_TO_OUTCOME) — the video timeline editor. Renders a piece's VideoScenes as proportional blocks and
//? drives the V1/V3/V4 ops: edit a scene's duration (trim) + transition, split/delete/reorder, save the whole
//? ordered list (content-save-scenes, upsert by id), select a time range → refine it (content-refine-range),
//? and (re)generate scenes from the script (content-decompose-video). All writes go through runContentOp → the
//? Conductor (B-23). Reorder/split/trim are buttons + inputs (reliable) rather than raw drag; drag is a
//? follow-up. Rendered as a modal from the content piece page. Browser-verify pending the dev server.

import { useMemo, useState } from 'react';

import { useTranslator, i18nNotify as notify } from '@luckystack/core/client';

import Dropdown from 'src/_components/dropdown/Dropdown';

import type { VideoSceneSummary } from '../_data/types';
import { useEscapeKey } from '../_functions/useEscapeKey';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import Icon from './Icon';
import { WsButton } from './primitives';

type EditScene = VideoSceneSummary;
type Transition = 'cut' | 'fade' | 'xfade';
const TRANSITIONS: Transition[] = ['cut', 'fade', 'xfade'];
const clampDur = (ms: number): number => Math.max(500, Math.min(60_000, Math.round(ms)));

export default function VideoTimelineEditor({ pieceId, scenes, onClose }: { pieceId: string; scenes: VideoSceneSummary[]; onClose: () => void }) {
  const translate = useTranslator();
  const { runContentOp } = useWorkspaces();
  useEscapeKey(onClose);

  const [local, setLocal] = useState<EditScene[]>(() => scenes.toSorted((a, b) => a.order - b.order));
  const [selected, setSelected] = useState(0);
  const [refineStart, setRefineStart] = useState(0);
  const [refineEnd, setRefineEnd] = useState(5);
  const [instruction, setInstruction] = useState('');

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

        <div className="flex items-center justify-between gap-2 pt-1">
          <WsButton variant="ghost" onClick={() => { runContentOp('content-decompose-video', pieceId, {}); notify.success({ key: 'workspaces.timeline.decomposeQueued' }); }}><Icon name="bolt" /> {translate({ key: 'workspaces.timeline.decompose' })}</WsButton>
          <WsButton variant="primary" onClick={save}><Icon name="check" /> {translate({ key: 'workspaces.timeline.save' })}</WsButton>
        </div>
      </div>
    </div>
  );
}
