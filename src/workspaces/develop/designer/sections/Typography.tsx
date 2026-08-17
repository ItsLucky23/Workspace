//? Designer › Typography — the type layer of the active style. See the heading/body pairing across a
//? full type scale on real copy, and edit the two font stacks inline. Rendered under the active theme
//? colours so contrast reads true.

import type { CSSProperties } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { Disclosure } from '../../../_components/primitives';
import { useDesigner } from '../state';
import { themeVars } from '../themes';
import { FontPicker, SectionHead, inputCls } from '../ui';

//? The scale steps (label key + px size + which font + weight).
const SCALE: { key: string; size: number; font: 'heading' | 'body'; weight: number }[] = [
  { key: 'display', size: 44, font: 'heading', weight: 700 },
  { key: 'h1', size: 32, font: 'heading', weight: 700 },
  { key: 'h2', size: 24, font: 'heading', weight: 600 },
  { key: 'h3', size: 19, font: 'heading', weight: 600 },
  { key: 'body', size: 16, font: 'body', weight: 400 },
  { key: 'small', size: 13, font: 'body', weight: 400 },
];

export default function Typography() {
  const translate = useTranslator();
  const d = useDesigner();
  const s = d.activeStyle;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 flex flex-col gap-5 max-w-4xl">
      <SectionHead icon="font" title={translate({ key: 'workspaces.designer.typography' })} sub={translate({ key: 'workspaces.designer.typographySub' })} />

      <div className="grid sm:grid-cols-2 gap-4">
        <FontPicker label={translate({ key: 'workspaces.designer.fontHeading' })} value={s.fontHeading} onChange={(v) => { d.setStyle({ fontHeading: v }); }} />
        <FontPicker label={translate({ key: 'workspaces.designer.fontBody' })} value={s.fontBody} onChange={(v) => { d.setStyle({ fontBody: v }); }} />
      </div>
      <Disclosure summary={translate({ key: 'workspaces.designer.customStack' })}>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{translate({ key: 'workspaces.designer.fontHeading' })}</span><input value={s.fontHeading} onChange={(e) => { d.setStyle({ fontHeading: e.target.value }); }} className={`text-xs font-mono ${inputCls}`} /></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{translate({ key: 'workspaces.designer.fontBody' })}</span><input value={s.fontBody} onChange={(e) => { d.setStyle({ fontBody: e.target.value }); }} className={`text-xs font-mono ${inputCls}`} /></label>
        </div>
      </Disclosure>

      <div className="rounded-2xl border border-container1-border overflow-hidden" style={themeVars(d.tokens)}>
        <div className="bg-background p-6 md:p-8 flex flex-col gap-5">
          {SCALE.map((step) => {
            const style: CSSProperties = { fontFamily: step.font === 'heading' ? s.fontHeading : s.fontBody, fontSize: step.size, fontWeight: step.font === 'heading' ? s.weightHeading : step.weight, letterSpacing: step.font === 'heading' ? s.tracking : '0' };
            return (
              <div key={step.key} className="flex items-baseline gap-4 border-b border-divider pb-4 last:border-0">
                <span className="w-16 shrink-0 text-[11px] text-muted uppercase tracking-wide">{translate({ key: `workspaces.designer.scale.${step.key}` })}</span>
                <span className="text-title leading-tight" style={style}>{translate({ key: 'workspaces.designer.typeSample' })}</span>
              </div>
            );
          })}
          <div className="max-w-prose text-common leading-relaxed" style={{ fontFamily: s.fontBody, fontSize: 15 }}>{translate({ key: 'workspaces.designer.typeParagraph' })}</div>
        </div>
      </div>
    </div>
  );
}
