//? intent: Designer — a broad visual editor for the whole product UI, not just a component list.
//? Sections (Components / Styles / Animations / Themes / Typography) all preview under one active
//? theme + style, so you can see, compare and edit every part of the visual language — by hand for
//? the simple knobs, and (theme) by AI. Built on the pluggable AI-provider layer + our real component
//? library, so anything the coding-agent ships shows up here automatically.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import BaseDropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon, { type IconName } from '../_components/Icon';
import { Disclosure, Segmented, WsButton } from '../_components/primitives';
import { MediaUploadButton } from '../_components/MediaUploadButton';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import { isModuleEnabled } from '../_data/modules';
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
  //? Key the provider by workspace so switching workspace while in the designer REMOUNTS it — otherwise the
  //? seed+persisted `themes`/`styles`/`anims` state (merged from the snapshot) would carry workspace A's
  //? custom library into workspace B (row-isolation must hold client-side too).
  const { activeWorkspace } = useWorkspaces();
  return (
    <DesignerProvider key={activeWorkspace.id}>
      <DesignerShell />
    </DesignerProvider>
  );
}

//? The sections the unified "AI generates it" bar can target (each has an AI generator).
const AI_SECTIONS = new Set<SectionId>(['themes', 'styles', 'animations']);

//? U1 — "unfuck the UI" review request: the fixed problem taxonomy the user ticks (kept small + concrete).
const UI_PROBLEMS = ['clutter', 'confusing', 'spacing', 'alignment', 'contrast', 'inconsistent'] as const;

//? U1 — a self-contained UI-review form (ui-review-create). Inline (rendered inside WorkspacesProvider), so it
//? may use useWorkspaces directly (no menuHandler-portal gotcha, lesson 0011). Screenshots upload to media; the
//? ticked problems + notes + page describe what's wrong. Submitting files the request → a redesign ticket.
function UiReviewForm() {
  const translate = useTranslator();
  const { activeWorkspace, createUiReview } = useWorkspaces();
  const [shots, setShots] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [page, setPage] = useState('');
  const [notes, setNotes] = useState('');
  const [sent, setSent] = useState(false);
  const canSend = shots.length > 0 || problems.length > 0 || notes.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    createUiReview({ screenshots: shots, problems, ...(page.trim() ? { page: page.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
    setShots([]); setProblems([]); setPage(''); setNotes(''); setSent(true);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted">{translate({ key: 'workspaces.uiReview.desc' })}</div>
      <div className="flex flex-wrap items-center gap-2">
        <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.uiReview.addShot" icon="up-right-from-square" onUploaded={(url) => { setShots((cur) => [...cur, url]); setSent(false); }} />
        {shots.map((url, i) => (
          <span key={url} className="inline-flex items-center gap-1 rounded-md bg-container2 px-2 py-1 text-xs text-common">
            {translate({ key: 'workspaces.uiReview.shotN', params: [{ key: 'n', value: String(i + 1) }] })}
            <button type="button" onClick={() => { setShots((cur) => cur.filter((u) => u !== url)); }} className="text-muted hover:text-wrong cursor-pointer"><Icon name="xmark" className="text-[10px]" /></button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {UI_PROBLEMS.map((p) => (
          <button key={p} type="button" onClick={() => { setProblems((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]); setSent(false); }} className={`rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${problems.includes(p) ? 'bg-primary/15 text-primary' : 'bg-container2 text-muted hover:text-common'}`}>{translate({ key: `workspaces.uiReview.problem_${p}` })}</button>
        ))}
      </div>
      <input value={page} onChange={(e) => { setPage(e.target.value); setSent(false); }} placeholder={translate({ key: 'workspaces.uiReview.pagePlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setSent(false); }} rows={2} placeholder={translate({ key: 'workspaces.uiReview.notesPlaceholder' })} className="px-3 py-2 rounded-lg border border-container1-border bg-container2/40 text-sm text-title resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <div className="flex items-center gap-2">
        <WsButton icon="paper-plane" disabled={!canSend} onClick={submit}>{translate({ key: 'workspaces.uiReview.submit' })}</WsButton>
        {sent && <span className="text-xs text-correct inline-flex items-center gap-1"><Icon name="circle-check" /> {translate({ key: 'workspaces.uiReview.sent' })}</span>}
      </div>
    </div>
  );
}

function DesignerShell() {
  const translate = useTranslator();
  const d = useDesigner();
  const { activeWorkspace } = useWorkspaces();
  //? Components is a DEV component-library reference, not a design-authoring surface → only show it when the
  //? development module is on, so a design-focused workspace gets a cleaner section strip (the visual-authoring
  //? sections only). The other five sections are always available.
  const sections = SECTIONS.filter((s) => s.id !== 'components' || isModuleEnabled(activeWorkspace.enabledSections, 'development'));
  const [section, setSection] = useState<SectionId>('gallery');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);

  const themeItems: DropdownItem[] = d.themes.map((t) => ({ id: t.id, value: t.id, item: t.name }));
  const activeItem = themeItems.find((i) => i.id === d.activeThemeId);

  const [useBusy, setUseBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

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
  //? #166 — save to the library WITHOUT activating (keep several generated themes/styles).
  const saveToLibNow = () => {
    if (saveBusy) return;
    setSaveBusy(true);
    void d.saveToLibrary(section === 'themes' ? 'theme' : 'style').then(() => { setSaveBusy(false); });
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

      {/* U1 — request a UI review ("unfuck the UI"): collapsed so it never clutters the design surface. */}
      <div className="px-3 md:px-4 pt-2 shrink-0">
        <Disclosure summary={translate({ key: 'workspaces.uiReview.title' })}>
          <UiReviewForm />
        </Disclosure>
      </div>

      {/* section tabs */}
      <div className="px-3 md:px-4 shrink-0 border-b border-divider flex items-center gap-1 overflow-x-auto">
        {sections.map((s) => {
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
          {/* #166 — save to library (no activation), separate from Use-in-project. */}
          <WsButton variant="ghost" icon={saveBusy ? 'spinner' : 'floppy-disk'} disabled={saveBusy} className={saveBusy ? '[&_svg]:animate-spin' : ''} onClick={saveToLibNow}>{translate({ key: 'workspaces.designer.saveToLibrary' })}</WsButton>
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
