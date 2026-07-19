//? Designer › Styles — the "design skills" layer (Apple, Material, Brutalist, …). A style is the
//? visual LANGUAGE around the colours: radius, elevation, borders, density, typography, motion. The
//? showcase is built from `--ds-*` CSS variables, so switching or editing a style re-shapes real
//? sample components LIVE (under the active theme's colours). Library rail (chips per style, delete
//? behind a per-row menu, Dropdown on phone) + the showcase-first editor; AI generation happens in
//? the page-level unified AI bar.

import type { CSSProperties } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../../_components/Icon';
import { WsButton, type PopMenuItem } from '../../../_components/primitives';
import { useDesigner } from '../state';
import { themeVars } from '../themes';
import { styleChips, styleVars, type BorderTreatment, type Density, type MotionFeel } from '../styles';
import { FontPicker, LibraryRail, RenameField, SectionHead, Slider, SourceBadge, inputCls } from '../ui';

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
    <div className={`flex flex-col md:flex-row h-full min-h-0`}>
      <LibraryRail
        title={translate({ key: 'workspaces.designer.styles' })}
        sub={translate({ key: 'workspaces.designer.stylesSub' })}
        addLabel={translate({ key: 'workspaces.designer.newStyle' })}
        menuLabel={translate({ key: 'workspaces.designer.moreActions' })}
        items={d.styles}
        activeId={d.activeStyleId}
        onSelect={(id) => { d.setActiveStyleId(id); }}
        onRename={(id, n) => { d.renameStyle(id, n); }}
        onAdd={d.addStyle}
        rowBelow={(st) => <div className={`flex flex-wrap gap-1 mt-1`}>{styleChips(st).slice(0, 3).map((c) => <span key={c} className={`text-[10px] rounded bg-container2 text-muted px-1.5 py-0.5`}>{c}</span>)}</div>}
        menuFor={(st) => {
          const menu: PopMenuItem[] = [];
          if (st.source !== 'seed') menu.push({ label: translate({ key: 'workspaces.designer.delete' }), icon: 'trash', danger: true, onClick: () => { d.removeStyle(st.id); } });
          return menu;
        }}
      />

      {/* showcase + editor */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-5 max-w-4xl`}>
        <SectionHead icon="wand-magic-sparkles"
          title={<RenameField value={s.name} onRename={(n) => { d.renameStyle(s.id, n); }} className={`min-w-0`} />}
          sub={s.description || translate({ key: 'workspaces.designer.stylesSub' })}
          right={<div className={`flex items-center gap-2`}><SourceBadge source={s.source} /><WsButton variant="secondary" icon="copy" onClick={() => { d.duplicateStyle(s.id); }}>{translate({ key: 'workspaces.designer.duplicate' })}</WsButton></div>} />

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
            <MediaShowcase />
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
          <FontPicker label={translate({ key: 'workspaces.designer.fontHeading' })} value={s.fontHeading} onChange={(v) => { d.setStyle({ fontHeading: v }); }} />
          <FontPicker label={translate({ key: 'workspaces.designer.fontBody' })} value={s.fontBody} onChange={(v) => { d.setStyle({ fontBody: v }); }} />
          <TextRow label={translate({ key: 'workspaces.designer.shadow' })} value={s.shadow} onChange={(v) => { d.setStyle({ shadow: v }); }} />
          <TextRow label={translate({ key: 'workspaces.designer.shadowSm' })} value={s.shadowSm} onChange={(v) => { d.setStyle({ shadowSm: v }); }} />
        </div>
      </div>
    </div>
  );
}

//? Image / media treatment — placeholders (CSS gradients, no external assets) that adopt the style's
//? radius + shadow, plus an avatar and a hero, so you see how imagery sits in the current style+theme.
function MediaShowcase() {
  const translate = useTranslator();
  const img: CSSProperties = { borderRadius: 'var(--ds-radius)', boxShadow: 'var(--ds-shadow-sm)' };
  return (
    <div className="bg-container1 text-common" style={cardStyle}>
      <div className="text-title" style={headingStyle}>{translate({ key: 'workspaces.designer.mediaTitle' })}</div>
      <div className="grid grid-cols-3 mt-2" style={{ gap: 'var(--ds-gap)' }}>
        <div className="aspect-square bg-gradient-to-br from-primary to-secondary" style={img} />
        <div className="aspect-video bg-gradient-to-br from-correct to-primary" style={img} />
        <div className="aspect-[4/3] bg-gradient-to-br from-warning to-wrong" style={img} />
      </div>
      <div className="flex items-center mt-3" style={{ gap: 'var(--ds-gap)' }}>
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-secondary to-warning shrink-0" style={{ boxShadow: 'var(--ds-shadow-sm)' }} />
        <div className="relative flex-1 aspect-[21/6] overflow-hidden" style={{ borderRadius: 'var(--ds-radius-lg)', boxShadow: 'var(--ds-shadow)' }}>
          <div className="absolute inset-0 bg-gradient-to-r from-primary to-secondary" />
          <div className="absolute inset-0 flex items-center px-4"><span className="text-title-primary font-semibold text-sm" style={headingStyle}>{translate({ key: 'workspaces.designer.mediaHero' })}</span></div>
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
