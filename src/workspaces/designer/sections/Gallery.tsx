//? L1 (AI_LIBRARIES_ACCOUNTS_PROGRAM.md) — the PREMADE-look gallery. Shows the curated looks (premades.ts)
//? as cards; selecting one renders live preview SURFACES — a nav menu, a landing hero, a card row, an
//? entrance animation (replayable), and a font showcase — all under the look's palette (themeVars) + component
//? style (styleVars) + fonts. "Use this look" applies its theme + style to the project (the existing persist
//? path). Tailwind colour classes inside the preview read the OVERRIDDEN `--color-*` vars, so the whole
//? subtree re-themes; `--ds-*` (radius/shadow) drive the shapes via inline style.

import { useState, type CSSProperties } from 'react';

import { motion } from 'motion/react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { WsButton } from '../../_components/primitives';
import { PREMADE_LOOKS, resolveLook, type ResolvedLook } from '../premades';
import { SEED_ANIMS, animFrom, ANIM_TO, animTransition } from '../animations';
import { themeVars } from '../themes';
import { styleVars } from '../styles';
import { useDesigner } from '../state';

//? The combined CSS-variable style for a look at the active mode (palette + component style).
function lookVars(resolved: ResolvedLook, mode: 'light' | 'dark'): CSSProperties {
  return { ...themeVars(resolved.theme[mode]), ...styleVars(resolved.style) };
}
//? Type-specimen glyphs for the font showcase (a variable, not a JSX literal).
const FONT_SPECIMEN = 'Aa';

//? The live preview surfaces for a look. `compact` renders a small thumbnail (hero only); full renders every
//? surface + a replayable entrance animation.
function LookPreview({ resolved, mode, compact, replayKey }: { resolved: ResolvedLook; mode: 'light' | 'dark'; compact?: boolean; replayKey?: number }) {
  const translate = useTranslator();
  const anim = SEED_ANIMS.find((a) => a.id === resolved.look.animId) ?? SEED_ANIMS[0];
  const { fontHeading, fontBody } = resolved;
  const card: CSSProperties = { borderRadius: 'var(--ds-radius-lg)', boxShadow: 'var(--ds-shadow)', borderWidth: 'var(--ds-border-width)', borderColor: 'var(--ds-border-color)', borderStyle: 'solid' };
  const btn: CSSProperties = { borderRadius: 'var(--ds-radius-pill)', boxShadow: 'var(--ds-shadow-sm)', paddingLeft: 'var(--ds-pad-x)', paddingRight: 'var(--ds-pad-x)', paddingTop: 'var(--ds-pad-y)', paddingBottom: 'var(--ds-pad-y)' };
  return (
    <div style={{ ...lookVars(resolved, mode), fontFamily: fontBody }} className="overflow-hidden rounded-xl bg-background text-common">
      {/* nav menu */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-container1-border">
        <span className="text-sm font-semibold text-title" style={{ fontFamily: fontHeading }}>{resolved.look.name}</span>
        {!compact && (
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>{translate({ key: 'workspaces.gallery.navHome' })}</span>
            <span>{translate({ key: 'workspaces.gallery.navPricing' })}</span>
            <span>{translate({ key: 'workspaces.gallery.navDocs' })}</span>
            <span className="text-title-primary bg-primary px-2.5 py-1" style={btn}>{translate({ key: 'workspaces.gallery.navStart' })}</span>
          </div>
        )}
      </div>
      {/* landing hero (replayable entrance) */}
      <motion.div key={replayKey ?? 0} initial={animFrom(anim)} animate={ANIM_TO} transition={animTransition(anim)} className="px-4 py-5 flex flex-col items-start gap-2">
        <span className="text-[10px] uppercase tracking-widest text-primary">{translate({ key: 'workspaces.gallery.eyebrow' })}</span>
        <div className="text-2xl font-bold text-title leading-tight" style={{ fontFamily: fontHeading, fontWeight: resolved.style.weightHeading, letterSpacing: resolved.style.tracking }}>{translate({ key: 'workspaces.gallery.heroTitle' })}</div>
        {!compact && <p className="text-sm text-common max-w-md">{translate({ key: 'workspaces.gallery.heroBody' })}</p>}
        <div className="flex items-center gap-2 mt-1">
          <span className="bg-primary text-title-primary text-sm" style={btn}>{translate({ key: 'workspaces.gallery.ctaPrimary' })}</span>
          <span className="text-title text-sm bg-container1" style={{ ...btn, borderWidth: 'var(--ds-border-width)', borderColor: 'var(--ds-border-color)', borderStyle: 'solid' }}>{translate({ key: 'workspaces.gallery.ctaSecondary' })}</span>
        </div>
      </motion.div>
      {!compact && (
        <>
          {/* card row */}
          <div className="grid grid-cols-3 gap-2 px-4 pb-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-container1 p-3 flex flex-col gap-1" style={card}>
                <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center text-primary"><Icon name="bolt" /></div>
                <div className="text-xs font-medium text-title" style={{ fontFamily: fontHeading }}>{translate({ key: 'workspaces.gallery.cardTitle' })}</div>
                <div className="text-[11px] text-muted">{translate({ key: 'workspaces.gallery.cardBody' })}</div>
              </div>
            ))}
          </div>
          {/* font showcase */}
          <div className="px-4 pb-4 flex items-end gap-4 border-t border-container1-border pt-3">
            <span className="text-4xl text-title" style={{ fontFamily: fontHeading, fontWeight: resolved.style.weightHeading }}>{FONT_SPECIMEN}</span>
            <div className="text-xs text-muted flex flex-col">
              <span className="text-title" style={{ fontFamily: fontHeading }}>{translate({ key: 'workspaces.gallery.headingFont' })}</span>
              <span style={{ fontFamily: fontBody }}>{translate({ key: 'workspaces.gallery.bodyFont' })}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Gallery() {
  const translate = useTranslator();
  const d = useDesigner();
  const [selectedId, setSelectedId] = useState(PREMADE_LOOKS[0]?.id ?? '');
  const [replay, setReplay] = useState(0);
  const [busy, setBusy] = useState(false);
  const selected = resolveLook(selectedId);

  const useLook = (): void => {
    if (!selected || busy) return;
    setBusy(true);
    d.setActiveThemeId(selected.theme.id);
    d.setActiveStyleId(selected.style.id);
    void Promise.all([d.useInProject('theme'), d.useInProject('style')]).then(() => { setBusy(false); });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.gallery.title' })}</div>
        <p className="text-sm text-muted">{translate({ key: 'workspaces.gallery.subtitle' })}</p>
      </div>
      {/* catalog grid — compact thumbnails */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {PREMADE_LOOKS.map((look) => {
          const r = resolveLook(look.id);
          if (!r) return null;
          return (
            <button key={look.id} type="button" onClick={() => { setSelectedId(look.id); }} className={`text-left rounded-xl border transition-colors cursor-pointer overflow-hidden ${look.id === selectedId ? 'border-primary ring-2 ring-primary/30' : 'border-container1-border hover:border-container1-hover'}`}>
              <LookPreview resolved={r} mode={d.mode} compact />
              <div className="px-3 py-2">
                <div className="text-sm font-medium text-title">{look.name}</div>
                <div className="text-xs text-muted line-clamp-1">{look.description}</div>
              </div>
            </button>
          );
        })}
      </div>
      {/* selected look — full preview + apply */}
      {selected && (
        <div className="flex flex-col gap-2 rounded-2xl border border-container1-border bg-container1/40 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-title">{selected.look.name}</div>
            <div className="flex items-center gap-2">
              <WsButton variant="ghost" icon="bolt" onClick={() => { setReplay((v) => v + 1); }}>{translate({ key: 'workspaces.gallery.replay' })}</WsButton>
              <WsButton icon={busy ? 'spinner' : 'check'} onClick={useLook}>{translate({ key: 'workspaces.gallery.use' })}</WsButton>
            </div>
          </div>
          <LookPreview resolved={selected} mode={d.mode} replayKey={replay} />
        </div>
      )}
    </div>
  );
}
