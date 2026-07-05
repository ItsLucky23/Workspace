//? Designer › Themes — the colour layer. Manage multiple themes (built-in / AI / custom), edit the
//? 30 tokens by hand with live contrast grading, auto-derive the hover/border variants of an accent
//? (G-DSGN-4), export the theme as the app's real `@theme` CSS, A/B-compare two themes, and generate
//? a whole theme from a plain-language brief (AI).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import { Segmented, WsButton } from '../../_components/primitives';
import { useDesigner } from '../state';
import {
  TOKEN_GROUPS, contrastGrade, contrastRatio, deriveAccent, themeToCss, themeVars,
  type ColorToken, type DesignTheme, type ThemeMode, type ThemeTokens,
} from '../themes';
import { RenameField, SectionHead, SourceBadge, inputCls } from '../ui';

const AA_SAMPLE = 'Aa';

//? The text-on-surface pairs worth grading for readability.
const CONTRAST_PAIRS: { fg: ColorToken; bg: ColorToken; key: string }[] = [
  { fg: 'title', bg: 'background', key: 'titleBg' },
  { fg: 'common', bg: 'container1', key: 'commonC1' },
  { fg: 'muted', bg: 'container1', key: 'mutedC1' },
  { fg: 'title-primary', bg: 'primary', key: 'onPrimary' },
];

export default function Themes() {
  const translate = useTranslator();
  const d = useDesigner();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);

  const runAi = () => {
    if (aiBusy || aiPrompt.trim().length === 0) return;
    setAiBusy(true); setAiError(false);
    void d.generateTheme(aiPrompt).then((ok) => { setAiBusy(false); if (ok) { setAiPrompt(''); setAiOpen(false); } else setAiError(true); });
  };

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
    <div className="flex h-full min-h-0">
      {/* rail */}
      <div className="w-64 shrink-0 border-r border-divider flex flex-col min-h-0">
        <div className="px-4 pt-4 pb-2 shrink-0"><div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.designer.themes' })}</div><div className="text-xs text-muted mt-0.5">{translate({ key: 'workspaces.designer.themesSub' })}</div></div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {d.themes.map((t) => (
            <ThemeRow key={t.id} theme={t} mode={d.mode} active={t.id === d.activeThemeId} compare={t.id === compareId}
              onSelect={() => { d.setActiveThemeId(t.id); }}
              onRename={(n) => { d.renameTheme(t.id, n); }}
              onCompare={() => { setCompareId((c) => (c === t.id ? null : t.id)); }}
              onRemove={t.source === 'seed' ? undefined : () => { d.removeTheme(t.id); }} />
          ))}
        </div>
        <div className="shrink-0 border-t border-divider p-2 flex flex-col gap-1.5">
          <button type="button" onClick={d.addTheme} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="plus" className="text-muted" /> {translate({ key: 'workspaces.designer.newTheme' })}</button>
          <button type="button" onClick={() => { setAiOpen((v) => !v); setAiError(false); }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${aiOpen ? 'bg-primary/10 text-primary' : 'text-common hover:bg-container2'}`}><Icon name="wand-magic-sparkles" className="text-primary" /> {translate({ key: 'workspaces.designer.generateAi' })}</button>
          {aiOpen && (
            <div className="flex flex-col gap-2 rounded-xl border border-container1-border bg-container1 p-2">
              <textarea value={aiPrompt} onChange={(e) => { setAiPrompt(e.target.value); }} rows={3} disabled={aiBusy} placeholder={translate({ key: 'workspaces.designer.aiPlaceholder' })} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runAi(); } }} className="w-full resize-none rounded-lg border border-container1-border bg-container2/40 px-2.5 py-2 text-xs text-title focus:outline-none focus:border-primary" />
              {aiError && <div className="text-[11px] text-wrong">{translate({ key: 'workspaces.designer.aiError' })}</div>}
              <WsButton icon={aiBusy ? 'spinner' : 'wand-magic-sparkles'} onClick={runAi} disabled={aiBusy || aiPrompt.trim().length === 0} className={aiBusy ? '[&_svg]:animate-spin' : ''}>{translate({ key: aiBusy ? 'workspaces.designer.aiGenerating' : 'workspaces.designer.aiGenerate' })}</WsButton>
            </div>
          )}
        </div>
      </div>

      {/* editor + preview */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 flex flex-col gap-5 max-w-4xl">
        <SectionHead icon="palette" title={translate({ key: 'workspaces.designer.themes' })} sub={translate({ key: 'workspaces.designer.themesEditSub' })}
          right={<div className="flex items-center gap-2">
            <Segmented<ThemeMode> options={[{ id: 'light', label: <span className="flex items-center gap-1.5"><Icon name="sun" />{translate({ key: 'workspaces.designer.light' })}</span> }, { id: 'dark', label: <span className="flex items-center gap-1.5"><Icon name="moon" />{translate({ key: 'workspaces.designer.dark' })}</span> }]} value={d.mode} onChange={d.setMode} />
          </div>} />

        <div className="flex items-center gap-2 flex-wrap">
          <RenameField value={d.activeTheme.name} onRename={(n) => { d.renameTheme(d.activeThemeId, n); }} className="text-base font-semibold text-title" />
          <SourceBadge source={d.activeTheme.source} />
          <div className="flex-1" />
          <WsButton variant="secondary" icon="code" onClick={exportCss}>{translate({ key: 'workspaces.designer.exportCss' })}</WsButton>
          <WsButton variant="secondary" icon="wand-magic-sparkles" onClick={deriveVariants} title={translate({ key: 'workspaces.designer.deriveHint' })}>{translate({ key: 'workspaces.designer.derive' })}</WsButton>
          <WsButton variant="secondary" icon="copy" onClick={() => { d.duplicateTheme(d.activeThemeId); }}>{translate({ key: 'workspaces.designer.duplicate' })}</WsButton>
        </div>

        {/* live preview (+ optional A/B compare) */}
        <div className={`grid gap-4 ${compare ? 'md:grid-cols-2' : ''}`}>
          <Preview theme={d.activeTheme} mode={d.mode} label={d.activeTheme.name} />
          {compare && <Preview theme={compare} mode={d.mode} label={compare.name} />}
        </div>

        {/* contrast */}
        <div className="rounded-xl border border-container1-border bg-container1 p-4">
          <div className="text-sm font-semibold text-title mb-2">{translate({ key: 'workspaces.designer.contrast' })}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {CONTRAST_PAIRS.map((p) => <ContrastCell key={p.key} pair={p} tokens={d.tokens} label={translate({ key: `workspaces.designer.pair.${p.key}` })} />)}
          </div>
        </div>

        {/* token editor */}
        <div className="rounded-xl border border-container1-border bg-container1 p-4">
          <div className="text-sm font-semibold text-title mb-3">{translate({ key: 'workspaces.designer.editorTitle' })}</div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
            {TOKEN_GROUPS.map((g) => (
              <div key={g.key}>
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1.5">{g.label}</div>
                <div className="flex flex-col gap-1.5">
                  {g.tokens.map((tk) => <TokenRow key={tk} token={tk} value={d.tokens[tk]} onSet={(v) => { d.setToken(tk, v); }} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeRow({ theme, mode, active, compare, onSelect, onRename, onCompare, onRemove }: { theme: DesignTheme; mode: ThemeMode; active: boolean; compare: boolean; onSelect: () => void; onRename: (n: string) => void; onCompare: () => void; onRemove?: () => void }) {
  const translate = useTranslator();
  const t = theme[mode];
  const swatches: ColorToken[] = ['background', 'container1', 'primary', 'title'];
  return (
    <div onClick={onSelect} className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${active ? 'bg-container1 ring-1 ring-primary/40' : 'hover:bg-container1/60'}`}>
      <div className="flex -space-x-1 shrink-0">{swatches.map((s) => <span key={s} className="w-4 h-4 rounded-full border border-container1-border" style={{ backgroundColor: t[s] }} />)}</div>
      <RenameField value={theme.name} onRename={onRename} className="flex-1 min-w-0 text-sm text-title" />
      <button type="button" onClick={(e) => { e.stopPropagation(); onCompare(); }} title={translate({ key: 'workspaces.designer.compare' })} className={`shrink-0 cursor-pointer ${compare ? 'text-primary' : 'text-muted opacity-0 group-hover:opacity-100 hover:text-primary'}`}><Icon name="table-columns" className="text-xs" /></button>
      {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-muted hover:text-wrong opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"><Icon name="trash-can" className="text-xs" /></button>}
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
      <input type="color" value={isHex ? value : '#000000'} onChange={(e) => { onSet(e.target.value); }} className="w-8 h-8 rounded-md border border-container1-border cursor-pointer bg-transparent p-0.5 shrink-0" />
      <span className="text-[11px] text-common flex-1 truncate">{token}</span>
      <input value={value} onChange={(e) => { onSet(e.target.value); }} className={`w-28 h-7 px-2 font-mono text-[11px] ${inputCls}`} />
    </div>
  );
}
