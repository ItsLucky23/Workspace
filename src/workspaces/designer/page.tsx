//? intent: Designer — a broad visual editor for the whole product UI, not just a component list.
//? Sections (Components / Styles / Animations / Themes / Typography) all preview under one active
//? theme + style, so you can see, compare and edit every part of the visual language — by hand for
//? the simple knobs, and (theme) by AI. Built on the pluggable AI-provider layer + our real component
//? library, so anything the coding-agent ships shows up here automatically.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import BaseDropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon, { type IconName } from '../_components/Icon';
import { Segmented, WsButton } from '../_components/primitives';
import { DesignerProvider, useDesigner } from './state';
import type { ThemeMode } from './themes';
import Components from './sections/Components';
import Styles from './sections/Styles';
import Animations from './sections/Animations';
import Themes from './sections/Themes';
import Typography from './sections/Typography';
import Gallery from './sections/Gallery';

export const template = 'workspaces';

type SectionId = 'gallery' | 'components' | 'styles' | 'animations' | 'themes' | 'typography';
const SECTIONS: { id: SectionId; icon: IconName }[] = [
  { id: 'gallery', icon: 'table-cells-large' },
  { id: 'components', icon: 'grip' },
  { id: 'styles', icon: 'wand-magic-sparkles' },
  { id: 'animations', icon: 'wave-square' },
  { id: 'themes', icon: 'palette' },
  { id: 'typography', icon: 'font' },
];

export default function DesignerPage() {
  return (
    <DesignerProvider>
      <DesignerShell />
    </DesignerProvider>
  );
}

//? The sections the unified "AI generates it" bar can target (each has an AI generator).
const AI_SECTIONS = new Set<SectionId>(['themes', 'styles', 'animations']);

function DesignerShell() {
  const translate = useTranslator();
  const d = useDesigner();
  const [section, setSection] = useState<SectionId>('gallery');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);

  const themeItems: DropdownItem[] = d.themes.map((t) => ({ id: t.id, value: t.id, item: t.name }));
  const activeItem = themeItems.find((i) => i.id === d.activeThemeId);

  const [useBusy, setUseBusy] = useState(false);

  const runAi = () => {
    const p = aiPrompt.trim();
    if (!p || aiBusy) return;
    setAiBusy(true); setAiError(false);
    const gen = section === 'themes' ? d.generateTheme : (section === 'styles' ? d.generateStyle : d.generateAnimation);
    void gen(p).then((ok) => { setAiBusy(false); if (ok) setAiPrompt(''); else setAiError(true); });
  };

  //? Persist + activate the selected theme/style as the workspace's design system → injected into
  //? every pipeline stage so the coding agent builds on-brand (ADR 0034).
  const useInProjectNow = () => {
    if (useBusy) return;
    setUseBusy(true);
    void d.useInProject(section === 'themes' ? 'theme' : 'style').then(() => { setUseBusy(false); });
  };
  const activeName = section === 'themes' ? d.activeThemeName : d.activeStyleName;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* intro + global theme/mode picker */}
      <div className="px-5 md:px-6 pt-4 pb-3 border-b border-divider shrink-0 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-title min-w-0">
          <span className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0"><Icon name="palette" /></span>
          <div className="min-w-0">
            <div className="text-xl font-semibold leading-tight">{translate({ key: 'workspaces.designer.title' })}</div>
            <div className="text-xs text-muted truncate">{translate({ key: 'workspaces.designer.tagline' })}</div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted hidden sm:inline">{translate({ key: 'workspaces.designer.previewingWith' })}</span>
          <BaseDropdown items={themeItems} {...(activeItem ? { value: activeItem } : {})} onChange={(i) => { d.setActiveThemeId(String(i.id)); }} size="md" />
          <Segmented<ThemeMode> options={[{ id: 'light', label: <Icon name="sun" /> }, { id: 'dark', label: <Icon name="moon" /> }]} value={d.mode} onChange={d.setMode} />
        </div>
      </div>

      {/* section tabs */}
      <div className="px-3 md:px-4 shrink-0 border-b border-divider flex items-center gap-1 overflow-x-auto">
        {SECTIONS.map((s) => {
          const on = section === s.id;
          return (
            <button key={s.id} type="button" onClick={() => { setSection(s.id); }}
              className={`relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap cursor-pointer transition-colors ${on ? 'text-title' : 'text-muted hover:text-common'}`}>
              <Icon name={s.icon} className={on ? 'text-primary' : ''} /> {translate({ key: `workspaces.designer.section.${s.id}` })}
              {on && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      {/* unified "AI generates / adjusts" bar — one input, targets the active section (no duplicate AI boxes) */}
      {AI_SECTIONS.has(section) && (
        <div className="px-3 md:px-4 py-2 border-b border-divider flex items-center gap-2 bg-container1/40">
          <Icon name="wand-magic-sparkles" className="text-primary shrink-0" />
          <input value={aiPrompt} onChange={(e) => { setAiPrompt(e.target.value); }} disabled={aiBusy}
            onKeyDown={(e) => { if (e.key === 'Enter') runAi(); }}
            placeholder={translate({ key: `workspaces.designer.aiBar.${section}` })}
            className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
          {aiError && <span className="text-xs text-wrong shrink-0">{translate({ key: 'workspaces.designer.aiError' })}</span>}
          <WsButton icon={aiBusy ? 'spinner' : 'wand-magic-sparkles'} onClick={runAi} disabled={aiBusy || aiPrompt.trim().length === 0} className={aiBusy ? '[&_svg]:animate-spin' : ''}>{translate({ key: aiBusy ? 'workspaces.designer.aiGenerating' : 'workspaces.designer.aiBar.generate' })}</WsButton>
        </div>
      )}

      {/* pipeline coupling (ADR 0034): the active design-system the coding agent builds on */}
      {(section === 'themes' || section === 'styles') && (
        <div className="px-3 md:px-4 py-2 border-b border-divider flex items-center gap-2 flex-wrap bg-container1/30">
          <span className="text-xs text-muted inline-flex items-center gap-1.5 min-w-0">
            <Icon name="link" className={activeName ? 'text-correct' : 'text-muted'} />
            <span className="truncate">{activeName ? translate({ key: 'workspaces.designer.activeInProject', params: [{ key: 'name', value: activeName }] }) : translate({ key: 'workspaces.designer.noneActive' })}</span>
          </span>
          <div className="flex-1" />
          <WsButton variant="secondary" icon={useBusy ? 'spinner' : 'circle-check'} disabled={useBusy} className={useBusy ? '[&_svg]:animate-spin' : ''} onClick={useInProjectNow}>{translate({ key: 'workspaces.designer.useInProject' })}</WsButton>
        </div>
      )}

      {/* active section */}
      <div className="flex-1 min-h-0">
        {section === 'gallery' && <Gallery />}
        {section === 'components' && <Components />}
        {section === 'styles' && <Styles />}
        {section === 'animations' && <Animations />}
        {section === 'themes' && <Themes />}
        {section === 'typography' && <Typography />}
      </div>
    </div>
  );
}
