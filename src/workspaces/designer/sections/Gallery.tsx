//? L1 (AI_LIBRARIES_ACCOUNTS_PROGRAM.md) — the PREMADE-look gallery. Shows the curated looks (premades.ts)
//? as cards; selecting one renders live preview SURFACES — a nav menu, a landing hero, a card row, an
//? entrance animation (replayable), and a font showcase — all under the look's palette (themeVars) + component
//? style (styleVars) + fonts. "Use this look" applies its theme + style to the project (the existing persist
//? path). Tailwind colour classes inside the preview read the OVERRIDDEN `--color-*` vars, so the whole
//? subtree re-themes; `--ds-*` (radius/shadow) drive the shapes via inline style.

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { motion, useReducedMotion } from 'motion/react';

import { useTranslator, i18nNotify as notify, apiRequest, tryCatch } from '@luckystack/core/client';

import { useWorkspaces } from '../../_shell/WorkspacesContext';
import Icon from '../../_components/Icon';
import { WsButton } from '../../_components/primitives';
import { PREMADE_LOOKS, resolveLook, lookToArtifacts, type ResolvedLook } from '../premades';
import { validArtifactContent } from '../persisted';
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
function LookPreview({ resolved, mode, compact, replayKey, loop }: { resolved: ResolvedLook; mode: 'light' | 'dark'; compact?: boolean; replayKey?: number; loop?: boolean }) {
  const translate = useTranslator();
  const anim = SEED_ANIMS.find((a) => a.id === resolved.look.animId) ?? SEED_ANIMS[0];
  //? The animation style IS part of a look's identity, so the surfaces REPLAY it on a loop (every ~2.6s) —
  //? you see the motion feel without clicking, on every card. Honours prefers-reduced-motion (no loop then).
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!loop || reduce) return;
    const id = setInterval(() => { setTick((v) => v + 1); }, 2600);
    return () => { clearInterval(id); };
  }, [loop, reduce]);
  const animKey = (replayKey ?? 0) + tick;
  //? Reduced motion: suppress the entrance TRANSFORM too (not just the loop) — no slide/scale on mount.
  const from = reduce ? false : animFrom(anim);
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
            <motion.span key={`nav-${String(animKey)}`} initial={from} animate={ANIM_TO} transition={{ ...animTransition(anim), delay: 0.05 }} className="text-title-primary bg-primary px-2.5 py-1" style={btn}>{translate({ key: 'workspaces.gallery.navStart' })}</motion.span>
          </div>
        )}
      </div>
      {/* landing hero (looping entrance — demonstrates the look's motion feel) */}
      <motion.div key={animKey} initial={from} animate={ANIM_TO} transition={animTransition(anim)} className="px-4 py-5 flex flex-col items-start gap-2">
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
          {/* card row — staggered in, so the motion feel shows across multiple surfaces */}
          <div className="grid grid-cols-3 gap-2 px-4 pb-4">
            {[0, 1, 2].map((i) => (
              <motion.div key={`card-${String(i)}-${String(animKey)}`} initial={from} animate={ANIM_TO} transition={{ ...animTransition(anim), delay: 0.12 + i * 0.09 }} className="bg-container1 p-3 flex flex-col gap-1" style={card}>
                <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center text-primary"><Icon name="bolt" /></div>
                <div className="text-xs font-medium text-title" style={{ fontFamily: fontHeading }}>{translate({ key: 'workspaces.gallery.cardTitle' })}</div>
                <div className="text-[11px] text-muted">{translate({ key: 'workspaces.gallery.cardBody' })}</div>
              </motion.div>
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

//? L3 — persist one artifact via the designerLibrary save op. Returns ok.
async function saveArtifact(workspaceId: string, artifact: { kind: string; name: string; content: unknown }): Promise<boolean> {
  const [err, res] = await tryCatch(() => apiRequest({ name: 'workspaces/designerLibrary', version: 'v1', data: { workspaceId, op: 'save', artifact } }));
  return !err && res?.status === 'success';
}

export default function Gallery() {
  const translate = useTranslator();
  const d = useDesigner();
  const { activeWorkspace, refetch } = useWorkspaces();
  const [selectedId, setSelectedId] = useState(PREMADE_LOOKS[0]?.id ?? '');
  const [replay, setReplay] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const selected = resolveLook(selectedId);

  const useLook = (): void => {
    if (!selected || busy) return;
    setBusy(true);
    d.setActiveThemeId(selected.theme.id);
    d.setActiveStyleId(selected.style.id);
    void Promise.all([d.useInProject('theme'), d.useInProject('style')]).then((oks) => {
      notify[oks.every(Boolean) ? 'success' : 'error']({ key: oks.every(Boolean) ? 'workspaces.gallery.applied' : 'workspaces.gallery.applyFailed' });
      setBusy(false);
    });
  };

  //? L3 — save a COPY of the premade (its theme + style artifacts) into the workspace library (customizable).
  const copyLook = (): void => {
    if (!selected || busy) return;
    setBusy(true);
    void Promise.all(lookToArtifacts(selected).map((a) => saveArtifact(activeWorkspace.id, a)))
      .then((oks) => { notify[oks.every(Boolean) ? 'success' : 'error']({ key: oks.every(Boolean) ? 'workspaces.gallery.copied' : 'workspaces.gallery.copyFailed' }); refetch(); setBusy(false); });
  };

  //? L3 — import a theme/style/animation JSON ({ kind, name, content }) → validate → save. Bad JSON is refused.
  const onImportFile = (file: File): void => {
    void (async () => {
      const text = await file.text();
      const [err, raw] = await tryCatch(() => Promise.resolve(JSON.parse(text) as unknown));
      const parsed = (!err && raw !== null && typeof raw === 'object') ? raw as { kind?: unknown; name?: unknown; content?: unknown } : null;
      const kind = typeof parsed?.kind === 'string' ? parsed.kind : '';
      const name = typeof parsed?.name === 'string' ? parsed.name : '';
      if (!parsed || name.trim().length === 0 || !validArtifactContent(kind, parsed.content, name)) { notify.error({ key: 'workspaces.gallery.importFailed' }); return; }
      const ok = await saveArtifact(activeWorkspace.id, { kind, name, content: parsed.content });
      notify[ok ? 'success' : 'error']({ key: ok ? 'workspaces.gallery.imported' : 'workspaces.gallery.importFailed' });
      if (ok) refetch();
    })();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.gallery.title' })}</div>
          <p className="text-sm text-muted">{translate({ key: 'workspaces.gallery.subtitle' })}</p>
        </div>
        <WsButton variant="ghost" icon="up-right-from-square" onClick={() => { fileRef.current?.click(); }}>{translate({ key: 'workspaces.gallery.import' })}</WsButton>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
      </div>
      {/* catalog grid — compact thumbnails */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {PREMADE_LOOKS.map((look) => {
          const r = resolveLook(look.id);
          if (!r) return null;
          return (
            <button key={look.id} type="button" onClick={() => { setSelectedId(look.id); }} className={`text-left rounded-xl border transition-colors cursor-pointer overflow-hidden ${look.id === selectedId ? 'border-primary ring-2 ring-primary/30' : 'border-container1-border hover:border-container1-hover'}`}>
              <LookPreview resolved={r} mode={d.mode} compact loop />
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
              <WsButton variant="ghost" icon="copy" onClick={copyLook} disabled={busy}>{translate({ key: 'workspaces.gallery.copy' })}</WsButton>
              <WsButton icon={busy ? 'spinner' : 'check'} onClick={useLook}>{translate({ key: 'workspaces.gallery.use' })}</WsButton>
            </div>
          </div>
          <LookPreview resolved={selected} mode={d.mode} replayKey={replay} loop />
        </div>
      )}
    </div>
  );
}
