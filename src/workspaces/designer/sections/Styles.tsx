//? Designer › Styles — the "design skills" layer (Apple, Material, Brutalist, …). A style is the
//? visual LANGUAGE around the colours: radius, elevation, borders, density, typography, motion. The
//? showcase on the right is built from `--ds-*` CSS variables, so switching or editing a style
//? re-shapes real sample components LIVE (under the active theme's colours). Manual editor for the
//? simple knobs; the AI-generate hook lands in the next phase.

import type { CSSProperties } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { WsButton } from '../../_components/primitives';
import { useDesigner } from '../state';
import { themeVars } from '../themes';
import { styleChips, styleVars, type BorderTreatment, type Density, type MotionFeel } from '../styles';
import { RenameField, SectionHead, Slider, SourceBadge, inputCls } from '../ui';

const BORDERS: BorderTreatment[] = ['none', 'hairline', 'solid', 'bold'];
const DENSITIES: Density[] = ['compact', 'cozy', 'comfortable'];
const MOTIONS: MotionFeel[] = ['none', 'snappy', 'smooth', 'bouncy'];

//? --ds-* driven inline styles for the showcase primitives.
const cardStyle: CSSProperties = { borderRadius: 'var(--ds-radius-lg)', boxShadow: 'var(--ds-shadow)', borderWidth: 'var(--ds-border-width)', borderStyle: 'solid', borderColor: 'var(--ds-border-color)', backdropFilter: 'var(--ds-blur)', padding: 'calc(var(--ds-pad-y) + 4px) var(--ds-pad-x)' };
const btnStyle: CSSProperties = { borderRadius: 'var(--ds-radius-pill)', boxShadow: 'var(--ds-shadow-sm)', padding: 'var(--ds-pad-y) var(--ds-pad-x)', fontFamily: 'var(--ds-font-body)' };
const inputStyle: CSSProperties = { borderRadius: 'var(--ds-radius)', borderWidth: 'var(--ds-border-width)', borderStyle: 'solid', borderColor: 'var(--ds-border-color)', padding: 'var(--ds-pad-y) var(--ds-pad-x)' };
const headingStyle: CSSProperties = { fontFamily: 'var(--ds-font-heading)', fontWeight: 'var(--ds-weight-heading)', letterSpacing: 'var(--ds-tracking)' };

export default function Styles() {
  const translate = useTranslator();
  const d = useDesigner();
  const s = d.activeStyle;

  return (
    <div className="flex h-full min-h-0">
      {/* rail */}
      <div className="w-64 shrink-0 border-r border-divider flex flex-col min-h-0">
        <div className="px-4 pt-4 pb-2 shrink-0"><div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.styles' })}</div><div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.designer.stylesSub' })}</div></div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {d.styles.map((st) => (
            <div key={st.id} onClick={() => { d.setActiveStyleId(st.id); }} className={`group rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${st.id === d.activeStyleId ? 'bg-container1 ring-1 ring-primary/40' : 'hover:bg-container1/60'}`}>
              <div className="flex items-center gap-2">
                <RenameField value={st.name} onRename={(n) => { d.renameStyle(st.id, n); }} className="flex-1 min-w-0 text-sm text-title" />
                {st.source !== 'seed' && <button type="button" onClick={(e) => { e.stopPropagation(); d.removeStyle(st.id); }} className="text-muted hover:text-wrong opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"><Icon name="trash-can" className="text-xs" /></button>}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">{styleChips(st).slice(0, 3).map((c) => <span key={c} className="text-[10px] rounded bg-container2 text-muted px-1.5 py-0.5">{c}</span>)}</div>
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-divider p-2">
          <button type="button" onClick={d.addStyle} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="plus" className="text-muted" /> {translate({ key: 'workspaces.designer.newStyle' })}</button>
        </div>
      </div>

      {/* showcase + editor */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 flex flex-col gap-5 max-w-4xl">
        <SectionHead icon="wand-magic-sparkles" title={s.name} sub={s.description || translate({ key: 'workspaces.designer.stylesSub' })}
          right={<div className="flex items-center gap-2"><SourceBadge source={s.source} /><WsButton variant="secondary" icon="copy" onClick={() => { d.duplicateStyle(s.id); }}>{translate({ key: 'workspaces.designer.duplicate' })}</WsButton></div>} />

        {/* live style-aware showcase (theme colours + style shape) */}
        <div className="rounded-2xl border border-container1-border overflow-hidden" style={{ ...themeVars(d.tokens), ...styleVars(s) }}>
          <div className="bg-background p-5 md:p-6 flex flex-col" style={{ gap: 'var(--ds-gap)' }}>
            <div className="text-[11px] text-muted flex items-center gap-1.5"><Icon name="eye" />{translate({ key: 'workspaces.designer.styleShowcase' })}</div>
            <div className="grid md:grid-cols-2" style={{ gap: 'var(--ds-gap)' }}>
              {/* product card */}
              <div className="bg-container1 text-common" style={cardStyle}>
                <div className="text-title text-lg" style={headingStyle}>{translate({ key: 'workspaces.designer.styleCardTitle' })}</div>
                <div className="text-sm text-common mt-1">{translate({ key: 'workspaces.designer.styleCardBody' })}</div>
                <div className="flex items-center flex-wrap mt-3" style={{ gap: 'var(--ds-gap)' }}>
                  <button type="button" className="inline-flex items-center gap-2 bg-primary text-title-primary text-sm font-medium cursor-pointer" style={btnStyle}><Icon name="bolt" />{translate({ key: 'workspaces.designer.styleCta' })}</button>
                  <button type="button" className="inline-flex items-center gap-2 bg-container2 text-title text-sm font-medium cursor-pointer" style={btnStyle}>{translate({ key: 'workspaces.designer.styleSecondary' })}</button>
                </div>
              </div>
              {/* form + badges */}
              <div className="bg-container1 text-common" style={cardStyle}>
                <div className="text-title" style={headingStyle}>{translate({ key: 'workspaces.designer.styleFormTitle' })}</div>
                <div className="flex flex-col mt-2" style={{ gap: 'var(--ds-gap)' }}>
                  <input placeholder={translate({ key: 'workspaces.designer.styleInput' })} className="bg-container2/40 text-sm text-title focus:outline-none" style={inputStyle} />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center bg-primary/12 text-primary text-xs px-2 py-1" style={{ borderRadius: 'var(--ds-radius-pill)' }}>{translate({ key: 'workspaces.designer.styleTag1' })}</span>
                    <span className="inline-flex items-center bg-correct/15 text-correct text-xs px-2 py-1" style={{ borderRadius: 'var(--ds-radius-pill)' }}>{translate({ key: 'workspaces.designer.styleTag2' })}</span>
                    <span className="inline-flex items-center bg-warning/15 text-warning text-xs px-2 py-1" style={{ borderRadius: 'var(--ds-radius-pill)' }}>{translate({ key: 'workspaces.designer.styleTag3' })}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* manual editor */}
        <div className="rounded-xl border border-container1-border bg-container1 p-4 grid sm:grid-cols-2 gap-x-6 gap-y-4">
          <Slider label={translate({ key: 'workspaces.designer.radius' })} value={s.radius} min={0} max={28} unit="px" onChange={(v) => { d.setStyle({ radius: v }); }} />
          <Slider label={translate({ key: 'workspaces.designer.radiusLg' })} value={s.radiusLg} min={0} max={40} unit="px" onChange={(v) => { d.setStyle({ radiusLg: v }); }} />
          <Slider label={translate({ key: 'workspaces.designer.weight' })} value={s.weightHeading} min={400} max={900} step={100} onChange={(v) => { d.setStyle({ weightHeading: v }); }} />
          <Slider label={translate({ key: 'workspaces.designer.blur' })} value={s.blur} min={0} max={24} unit="px" onChange={(v) => { d.setStyle({ blur: v }); }} />
          <Choice label={translate({ key: 'workspaces.designer.border' })} value={s.border} options={BORDERS} onChange={(v) => { d.setStyle({ border: v }); }} tkey="borderOpt" />
          <Choice label={translate({ key: 'workspaces.designer.density' })} value={s.density} options={DENSITIES} onChange={(v) => { d.setStyle({ density: v }); }} tkey="densityOpt" />
          <Choice label={translate({ key: 'workspaces.designer.motion' })} value={s.motion} options={MOTIONS} onChange={(v) => { d.setStyle({ motion: v }); }} tkey="motionOpt" />
          <label className="flex items-center gap-2 self-end pb-1 cursor-pointer"><input type="checkbox" checked={s.pill} onChange={(e) => { d.setStyle({ pill: e.target.checked }); }} className="accent-primary w-4 h-4" /><span className="text-sm text-common">{translate({ key: 'workspaces.designer.pill' })}</span></label>
          <TextRow label={translate({ key: 'workspaces.designer.fontHeading' })} value={s.fontHeading} onChange={(v) => { d.setStyle({ fontHeading: v }); }} />
          <TextRow label={translate({ key: 'workspaces.designer.fontBody' })} value={s.fontBody} onChange={(v) => { d.setStyle({ fontBody: v }); }} />
          <TextRow label={translate({ key: 'workspaces.designer.shadow' })} value={s.shadow} onChange={(v) => { d.setStyle({ shadow: v }); }} />
          <TextRow label={translate({ key: 'workspaces.designer.shadowSm' })} value={s.shadowSm} onChange={(v) => { d.setStyle({ shadowSm: v }); }} />
        </div>
      </div>
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange, tkey }: { label: string; value: T; options: T[]; onChange: (v: T) => void; tkey: string }) {
  const translate = useTranslator();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      <div className="inline-flex flex-wrap gap-0.5 rounded-xl bg-container2 p-0.5">
        {options.map((o) => <button key={o} type="button" onClick={() => { onChange(o); }} className={`rounded-lg px-2.5 h-7 text-xs font-medium cursor-pointer transition-colors ${value === o ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>{translate({ key: `workspaces.designer.${tkey}.${o}` })}</button>)}
      </div>
    </div>
  );
}

function TextRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span><input value={value} onChange={(e) => { onChange(e.target.value); }} className={`text-xs font-mono ${inputCls}`} /></label>;
}
