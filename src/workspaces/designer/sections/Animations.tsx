//? Designer › Animations — a motion playground. Preview a preset on a real sample element, tune it
//? with sliders (offset / scale / rotate / duration / bounce / easing), see the easing curve, and
//? (next phase) have the AI generate one. Presets are seeded to the app's real springs. The preview
//? re-plays automatically on any change (the motion element is keyed on the spec) + a Replay button.

import { useState } from 'react';

import { motion } from 'motion/react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { WsButton } from '../../_components/primitives';
import { useDesigner } from '../state';
import { ANIM_TO, EASING_BEZIER, animChips, animFrom, animTransition, type AnimEasing } from '../animations';
import { RenameField, SectionHead, Slider, SourceBadge } from '../ui';

const EASINGS: AnimEasing[] = ['spring', 'easeOut', 'easeInOut', 'easeIn', 'linear'];

export default function Animations() {
  const translate = useTranslator();
  const d = useDesigner();
  const a = d.activeAnim;
  const [replay, setReplay] = useState(0);
  //? Keying the element on the full spec (+ a manual replay counter) remounts it, which re-plays
  //? initial→animate — giving live feedback as you drag a slider, plus an explicit Replay.
  const playKey = `${a.id}:${String(a.fade)}:${String(a.x)}:${String(a.y)}:${String(a.scale)}:${String(a.rotate)}:${a.easing}:${String(a.duration)}:${String(a.bounce)}:${String(replay)}`;

  return (
    <div className="flex h-full min-h-0">
      {/* rail */}
      <div className="w-64 shrink-0 border-r border-divider flex flex-col min-h-0">
        <div className="px-4 pt-4 pb-2 shrink-0"><div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.animations' })}</div><div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.designer.animationsSub' })}</div></div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {d.anims.map((an) => (
            <div key={an.id} onClick={() => { d.setActiveAnimId(an.id); }} className={`group rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${an.id === d.activeAnimId ? 'bg-container1 ring-1 ring-primary/40' : 'hover:bg-container1/60'}`}>
              <div className="flex items-center gap-2">
                <RenameField value={an.name} onRename={(n) => { d.renameAnim(an.id, n); }} className="flex-1 min-w-0 text-sm text-title" />
                {an.source !== 'seed' && <button type="button" onClick={(e) => { e.stopPropagation(); d.removeAnim(an.id); }} className="text-muted hover:text-wrong opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"><Icon name="trash-can" className="text-xs" /></button>}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">{animChips(an).slice(0, 3).map((c) => <span key={c} className="text-[10px] rounded bg-container2 text-muted px-1.5 py-0.5">{c}</span>)}</div>
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-divider p-2">
          <button type="button" onClick={d.addAnim} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="plus" className="text-muted" /> {translate({ key: 'workspaces.designer.newAnim' })}</button>
        </div>
      </div>

      {/* playground + editor */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 flex flex-col gap-5 max-w-4xl">
        <SectionHead icon="wave-square" title={a.name} sub={a.description || translate({ key: 'workspaces.designer.animationsSub' })}
          right={<div className="flex items-center gap-2"><SourceBadge source={a.source} /><WsButton icon="rotate" onClick={() => { setReplay((r) => r + 1); }}>{translate({ key: 'workspaces.designer.replay' })}</WsButton></div>} />

        {/* stage */}
        <div className="rounded-2xl border border-container1-border bg-container1 p-8 flex items-center justify-center min-h-52 overflow-hidden">
          <motion.div key={playKey} initial={animFrom(a)} animate={ANIM_TO} transition={animTransition(a)}
            className="rounded-2xl bg-primary text-title-primary px-6 py-5 shadow-lg flex items-center gap-3">
            <Icon name="wand-magic-sparkles" className="text-xl" />
            <div><div className="text-sm font-semibold">{translate({ key: 'workspaces.designer.animSampleTitle' })}</div><div className="text-xs text-common-primary">{a.name}</div></div>
          </motion.div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* editor */}
          <div className="rounded-xl border border-container1-border bg-container1 p-4 flex flex-col gap-4">
            <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.animParams' })}</div>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={a.fade} onChange={(e) => { d.setAnim({ fade: e.target.checked }); }} className="accent-primary w-4 h-4" /><span className="text-sm text-common">{translate({ key: 'workspaces.designer.animFade' })}</span></label>
            <Slider label={translate({ key: 'workspaces.designer.animX' })} value={a.x} min={-160} max={160} unit="px" onChange={(v) => { d.setAnim({ x: v }); }} />
            <Slider label={translate({ key: 'workspaces.designer.animY' })} value={a.y} min={-160} max={160} unit="px" onChange={(v) => { d.setAnim({ y: v }); }} />
            <Slider label={translate({ key: 'workspaces.designer.animScale' })} value={a.scale} min={0.2} max={1.6} step={0.02} onChange={(v) => { d.setAnim({ scale: v }); }} />
            <Slider label={translate({ key: 'workspaces.designer.animRotate' })} value={a.rotate} min={-180} max={180} unit="°" onChange={(v) => { d.setAnim({ rotate: v }); }} />
            <Slider label={translate({ key: 'workspaces.designer.animDuration' })} value={a.duration} min={0.1} max={1.5} step={0.02} unit="s" onChange={(v) => { d.setAnim({ duration: v }); }} />
            {a.easing === 'spring' && <Slider label={translate({ key: 'workspaces.designer.animBounce' })} value={a.bounce} min={0} max={0.8} step={0.02} onChange={(v) => { d.setAnim({ bounce: v }); }} />}
          </div>

          {/* easing */}
          <div className="rounded-xl border border-container1-border bg-container1 p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.easing' })}</div>
            <div className="inline-flex flex-wrap gap-0.5 rounded-xl bg-container2 p-0.5 self-start">
              {EASINGS.map((e) => <button key={e} type="button" onClick={() => { d.setAnim({ easing: e }); }} className={`rounded-lg px-2.5 h-7 text-xs font-medium cursor-pointer transition-colors ${a.easing === e ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>{translate({ key: `workspaces.designer.easingOpt.${e}` })}</button>)}
            </div>
            <EasingCurve easing={a.easing} />
          </div>
        </div>

        <div className="rounded-xl border border-container1-border bg-container2/30 p-3 text-xs text-muted flex items-center gap-2"><Icon name="circle-info" className="text-primary" />{translate({ key: 'workspaces.designer.reducedMotionNote' })}</div>
      </div>
    </div>
  );
}

//? Draw the easing as a cubic-bezier curve (springs get a note — they aren't a single bezier).
function EasingCurve({ easing }: { easing: AnimEasing }) {
  const translate = useTranslator();
  if (easing === 'spring') return <div className="flex-1 flex items-center justify-center text-xs text-muted border border-dashed border-container1-border rounded-lg py-8">{translate({ key: 'workspaces.designer.springNote' })}</div>;
  const [x1, y1, x2, y2] = EASING_BEZIER[easing];
  return (
    <svg viewBox="0 0 100 100" className="w-full h-40 rounded-lg bg-container2/30" preserveAspectRatio="none">
      <line x1="0" y1="100" x2="100" y2="100" stroke="var(--color-divider)" strokeWidth="1" />
      <line x1="0" y1="0" x2="0" y2="100" stroke="var(--color-divider)" strokeWidth="1" />
      <path d={`M0,100 C${String(x1 * 100)},${String((1 - y1) * 100)} ${String(x2 * 100)},${String((1 - y2) * 100)} 100,0`} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
