//? Designer › Themes — the colour layer. Preview first: the active theme renders live (with optional
//? A/B compare per rail row); the WCAG contrast check and the 30-token hand editor sit behind two
//? disclosures so the knobs appear on demand. Per-item actions (compare / delete on non-seeds) live in
//? a per-row menu; the rarer toolbar acts (export CSS, derive hover/border variants G-DSGN-4,
//? duplicate) sit in ONE overflow menu on the active-theme row. AI generation happens in the page-level
//? unified AI bar (the old rail-local form was a duplicate).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../../_components/Icon';
import { Disclosure, PopMenu, type PopMenuItem } from '../../../_components/primitives';
import { useDesigner } from '../state';
import {
  TOKEN_GROUPS, contrastGrade, contrastRatio, deriveAccent, themeToCss, themeVars,
  type ColorToken, type DesignTheme, type ThemeMode, type ThemeTokens,
} from '../themes';
import { LibraryRail, RenameField, SectionHead, SourceBadge, inputCls } from '../ui';

const AA_SAMPLE = 'Aa';

//? The text-on-surface pairs worth grading for readability.
const CONTRAST_PAIRS: { fg: ColorToken; bg: ColorToken; key: string }[] = [
  { fg: 'title', bg: 'background', key: 'titleBg' },
  { fg: 'common', bg: 'container1', key: 'commonC1' },
  { fg: 'muted', bg: 'container1', key: 'mutedC1' },
  { fg: 'title-primary', bg: 'primary', key: 'onPrimary' },
];

//? The rail-row colour swatches that identify a theme at a glance.
const RAIL_SWATCHES: ColorToken[] = ['background', 'container1', 'primary', 'title'];

export default function Themes() {
  const translate = useTranslator();
  const d = useDesigner();
  const [compareId, setCompareId] = useState<string | null>(null);

  const deriveVariants = () => {
    const t = d.activeTheme; const forDark = d.mode === 'dark';
    const src = t[d.mode];
    const p = deriveAccent(src.primary, forDark); const s = deriveAccent(src.secondary, forDark);
    const next: ThemeTokens = { ...src, 'primary-hover': p.hover, 'primary-border': p.border, 'secondary-hover': s.hover, 'secondary-border': s.border };
    if (d.mode === 'light') d.applyTokens(next, t.dark); else d.applyTokens(t.light, next);
  };

  const exportCss = () => {
    const css = themeToCss(d.activeTheme);
    void navigator.clipboard.writeText(css);
    void menuHandler.open(
      <div className="w-full flex flex-col gap-3 p-5">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.designer.exportTitle' })}</div>
        <div className="text-sm text-muted -mt-2">{translate({ key: 'workspaces.designer.exportBody' })}</div>
        <textarea readOnly value={css} rows={14} className="w-full rounded-lg border border-container1-border bg-container2/40 px-3 py-2 text-xs font-mono text-title focus:outline-none resize-none" />
      </div>,
      { dimBackground: true, background: 'bg-container1', size: 'lg' },
    );
  };

  const compare = compareId ? d.themes.find((t) => t.id === compareId) ?? null : null;

  return (
    <div className={`flex flex-col md:flex-row h-full min-h-0`}>
      <LibraryRail
        title={translate({ key: 'workspaces.designer.themes' })}
        sub={translate({ key: 'workspaces.designer.themesSub' })}
        addLabel={translate({ key: 'workspaces.designer.newTheme' })}
        menuLabel={translate({ key: 'workspaces.designer.moreActions' })}
        items={d.themes}
        activeId={d.activeThemeId}
        onSelect={(id) => { d.setActiveThemeId(id); }}
        onRename={(id, n) => { d.renameTheme(id, n); }}
        onAdd={d.addTheme}
        rowLeft={(t) => (
          <div className={`flex -space-x-1 shrink-0`}>
            {RAIL_SWATCHES.map((s) => <span key={s} className={`w-4 h-4 rounded-full border border-container1-border`} style={{ backgroundColor: t[d.mode][s] }} />)}
          </div>
        )}
        menuFor={(t) => {
          const menu: PopMenuItem[] = [
            { label: translate({ key: compareId === t.id ? 'workspaces.designer.stopCompare' : 'workspaces.designer.compare' }), icon: 'table-columns', onClick: () => { setCompareId((c) => (c === t.id ? null : t.id)); } },
          ];
          if (t.source !== 'seed') menu.push({ label: translate({ key: 'workspaces.designer.delete' }), icon: 'trash', danger: true, onClick: () => { d.removeTheme(t.id); } });
          return menu;
        }}
      />

      {/* editor + preview */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-5 max-w-4xl`}>
        <SectionHead icon="palette" title={translate({ key: 'workspaces.designer.themes' })} sub={translate({ key: 'workspaces.designer.themesEditSub' })} />

        {/* active theme row: rename + source inline; the rarer acts behind one overflow menu */}
        <div className={`flex items-center gap-2 flex-wrap`}>
          <RenameField value={d.activeTheme.name} onRename={(n) => { d.renameTheme(d.activeThemeId, n); }} className={`text-base font-semibold text-title`} />
          <SourceBadge source={d.activeTheme.source} />
          <div className={`flex-1`} />
          <PopMenu ariaLabel={translate({ key: 'workspaces.designer.moreActions' })} items={[
            { label: translate({ key: 'workspaces.designer.exportCss' }), icon: 'file-lines', onClick: exportCss },
            { label: translate({ key: 'workspaces.designer.derive' }), icon: 'wand-magic-sparkles', onClick: deriveVariants },
            { label: translate({ key: 'workspaces.designer.duplicate' }), icon: 'copy', onClick: () => { d.duplicateTheme(d.activeThemeId); } },
          ]} />
        </div>

        {/* live preview first (+ optional A/B compare) */}
        <div className={`grid gap-4 ${compare ? 'md:grid-cols-2' : ''}`}>
          <Preview theme={d.activeTheme} mode={d.mode} label={d.activeTheme.name} />
          {compare && <Preview theme={compare} mode={d.mode} label={compare.name} />}
        </div>

        {/* knobs on demand: contrast grading + the 30-token hand editor */}
        <Disclosure summary={translate({ key: 'workspaces.designer.contrast' })}>
          <div className={`grid grid-cols-2 md:grid-cols-4 gap-2`}>
            {CONTRAST_PAIRS.map((p) => <ContrastCell key={p.key} pair={p} tokens={d.tokens} label={translate({ key: `workspaces.designer.pair.${p.key}` })} />)}
          </div>
        </Disclosure>
        <Disclosure summary={translate({ key: 'workspaces.designer.editTokens' })}>
          <div className={`grid sm:grid-cols-2 gap-x-6 gap-y-4`}>
            {TOKEN_GROUPS.map((g) => (
              <div key={g.key}>
                <div className={`text-[11px] uppercase tracking-wide text-muted mb-1.5`}>{g.label}</div>
                <div className={`flex flex-col gap-1.5`}>
                  {g.tokens.map((tk) => <TokenRow key={tk} token={tk} value={d.tokens[tk]} onSet={(v) => { d.setToken(tk, v); }} />)}
                </div>
              </div>
            ))}
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

function Preview({ theme, mode, label }: { theme: DesignTheme; mode: ThemeMode; label: string }) {
  const translate = useTranslator();
  return (
    <div className="rounded-xl border border-container1-border overflow-hidden" style={themeVars(theme[mode])}>
      <div className="bg-background p-4 flex flex-col gap-3">
        <div className="text-[11px] text-muted flex items-center gap-1.5"><Icon name="eye" />{label}</div>
        <div className="rounded-xl bg-container1 border border-container1-border p-3 flex flex-col gap-2">
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.previewCardTitle' })}</div>
          <div className="text-xs text-common">{translate({ key: 'workspaces.designer.previewCardBody' })}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center rounded-lg bg-primary text-title-primary text-xs font-medium px-3 h-8">{translate({ key: 'workspaces.designer.previewPrimary' })}</span>
            <span className="inline-flex items-center rounded-lg bg-container2 text-title text-xs font-medium px-3 h-8">{translate({ key: 'workspaces.designer.previewSecondary' })}</span>
            <span className="inline-flex items-center rounded-full bg-correct/15 text-correct text-xs px-2 py-0.5">{translate({ key: 'workspaces.designer.previewOk' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContrastCell({ pair, tokens, label }: { pair: { fg: ColorToken; bg: ColorToken }; tokens: ThemeTokens; label: string }) {
  const translate = useTranslator();
  const ratio = contrastRatio(tokens[pair.fg], tokens[pair.bg]);
  const grade = ratio === null ? null : contrastGrade(ratio);
  const tint = grade === 'AAA' || grade === 'AA' ? 'text-correct' : (grade === 'AA-large' ? 'text-warning' : 'text-wrong');
  return (
    <div className="rounded-lg border border-container1-border p-2 flex items-center gap-2">
      <span className="w-9 h-9 rounded-md border border-container1-border flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: tokens[pair.bg], color: tokens[pair.fg] }}>{AA_SAMPLE}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-muted truncate">{label}</div>
        {ratio === null ? <div className="text-[11px] text-disabled">{translate({ key: 'workspaces.designer.notMeasurable' })}</div> : <div className={`text-xs font-medium ${tint}`}>{ratio.toFixed(2)} · {grade}</div>}
      </div>
    </div>
  );
}

function TokenRow({ token, value, onSet }: { token: ColorToken; value: string; onSet: (v: string) => void }) {
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={token} value={isHex ? value : '#000000'} onChange={(e) => { onSet(e.target.value); }} className="w-8 h-8 rounded-md border border-container1-border cursor-pointer bg-transparent p-0.5 shrink-0" />
      <span className="text-[11px] text-common flex-1 truncate">{token}</span>
      <input value={value} onChange={(e) => { onSet(e.target.value); }} className={`w-28 h-7 px-2 font-mono text-[11px] ${inputCls}`} />
    </div>
  );
}
