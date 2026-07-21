//? intent: Designer — shape the product's whole visual language and make it the design system the
//? coding agent builds with. The Gallery of premade looks is the front door ("Use this look" is the
//? one write, ADR 0034); Themes / Styles / Animations / Typography are the deeper authoring layers,
//? each driven by the global preview controls (theme + light/dark) and the unified AI-generate bar.
//? UI feedback (review requests + inbox) and inspiration import live one tap away in the secondary
//? Feedback tab and the Gallery header.

import { useEffect, useRef, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import BaseDropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon, { type IconName } from '../../_components/Icon';
import { Disclosure, EmptyState, PopMenu, Segmented, WsButton } from '../../_components/primitives';
import { SetupNotice } from '../../_components/SetupNotice';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { UI_PROBLEMS, uiProblemI18nKey } from '../../_data/uiReviewTaxonomy';
import { DesignerProvider, useDesigner } from './state';
import type { ThemeMode } from './themes';
import { SectionHead } from './ui';
import Styles from './sections/Styles';
import Animations from './sections/Animations';
import Themes from './sections/Themes';
import Typography from './sections/Typography';
import Gallery from './sections/Gallery';

export const template = 'workspaces';

type SectionId = 'gallery' | 'styles' | 'animations' | 'themes' | 'typography';
//? The tab strip = the five design sections + the secondary Feedback tab (UI-review form + inbox).
//? (Components — the dev component-library reference — moved to its own destination, develop/components.)
type TabId = SectionId | 'feedback';
const SECTIONS: { id: SectionId; icon: IconName }[] = [
  { id: 'gallery', icon: 'table-cells-large' },
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
const AI_SECTIONS = new Set<TabId>(['themes', 'styles', 'animations']);

//? U1 — "unfuck the UI" review request: the CANONICAL problem taxonomy (shared with the server-side
//? validator via _data/uiReviewTaxonomy — a diverging local list here previously nulled every tick).

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
          <button key={p} type="button" onClick={() => { setProblems((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]); setSent(false); }} className={`rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${problems.includes(p) ? 'bg-primary/15 text-primary' : 'bg-container2 text-muted hover:text-common'}`}>{translate({ key: `workspaces.uiReview.${uiProblemI18nKey(p)}` })}</button>
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

//? INS — inspiration import: screenshot-upload → theme proposal, and the side-by-side screenshot
//? compare that lands in the review inbox as a redesign candidate. Inline (inside WorkspacesProvider —
//? no menuHandler-portal gotcha, lesson 0011). Rendered inside the Gallery (its conceptual home) via
//? the `inspiration` slot — but defined HERE so the C8 live-URL coupling stays in page.tsx.
function InspirationForm() {
  const translate = useTranslator();
  const { activeWorkspace, activeProjectId, environments, refetch } = useWorkspaces();
  const [ownImage, setOwnImage] = useState('');
  const [inspirationImage, setInspirationImage] = useState('');
  const [busy, setBusy] = useState<'image' | 'compare' | null>(null);
  const [result, setResult] = useState<'ok' | 'error' | null>(null);
  //? The route's data type is a discriminated union per op, so each caller builds its own
  //? payload and this helper only owns the busy/result lifecycle.
  const call = (kind: 'image' | 'compare', fire: () => Promise<{ status: string }>) => {
    if (busy) return;
    setBusy(kind); setResult(null);
    void tryCatch(fire).then(([err, r]) => {
      setBusy(null);
      setResult(!err && r?.status === 'success' ? 'ok' : 'error');
      if (!err && r?.status === 'success') {
        if (kind === 'compare') { setOwnImage(''); setInspirationImage(''); }
        refetch();
      }
    });
  };
  const inputCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
  //? GAP_SCAN C8 — "our page" had to be uploaded by hand even when this project is already DEPLOYED.
  //? Offer the live environment's URL (prod > staging > dev) as a one-tap fill; compare captures URLs itself.
  const liveEnv = ['prod', 'staging', 'dev']
    .map((kind) => environments.find((e) => e.projectId === activeProjectId && e.status === 'live' && e.kind === kind))
    .find((e) => e?.url !== undefined && e.url.length > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted">{translate({ key: 'workspaces.inspire.desc' })}</div>
      <div className="flex flex-wrap items-center gap-2">
        <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.inspire.uploadShot" icon="up-right-from-square" onUploaded={(uploaded) => { call('image', () => apiRequest({ name: 'workspaces/designerInspiration', version: 'v1', data: { workspaceId: activeWorkspace.id, op: 'inspire-image', imageUrl: uploaded } })); }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className={`${inputCls} flex items-center gap-2 min-w-44`}>
          <span className="text-muted">{ownImage.startsWith('http') ? ownImage.replace(/^https?:\/\//, '').slice(0, 28) : translate({ key: 'workspaces.inspire.ownPlaceholder' })}</span>
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.inspire.uploadShot" icon="up-right-from-square" onUploaded={(uploaded) => { setOwnImage(uploaded); setResult(null); }} />
          {/* C8 — one tap fills our DEPLOYED page; the compare op screenshots the URL server-side. */}
          {liveEnv?.url !== undefined && <button type="button" onClick={() => { setOwnImage(liveEnv.url ?? ''); setResult(null); }} className="text-xs text-primary hover:underline cursor-pointer shrink-0">{translate({ key: 'workspaces.inspire.useLive' })}</button>}
        </div>
        <div className={`${inputCls} flex items-center gap-2 min-w-44`}>
          <span className="text-muted">{translate({ key: 'workspaces.inspire.inspPlaceholder' })}</span>
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*" labelKey="workspaces.inspire.uploadShot" icon="up-right-from-square" onUploaded={(uploaded) => { setInspirationImage(uploaded); setResult(null); }} />
        </div>
        <WsButton variant="secondary" icon={busy === 'compare' ? 'spinner' : 'table-columns'} disabled={busy !== null || !activeProjectId || ownImage.length === 0 || inspirationImage.length === 0} className={busy === 'compare' ? '[&_svg]:animate-spin' : ''} onClick={() => { if (!activeProjectId) return; call('compare', () => apiRequest({ name: 'workspaces/designerInspiration', version: 'v1', data: { workspaceId: activeWorkspace.id, op: 'compare', projectId: activeProjectId, ownUrl: ownImage, inspirationUrl: inspirationImage, clientRequestId: globalThis.crypto.randomUUID() } })); }}>{translate({ key: 'workspaces.inspire.compare' })}</WsButton>
      </div>
      {result === 'ok' && <span className="text-xs text-correct inline-flex items-center gap-1"><Icon name="circle-check" /> {translate({ key: 'workspaces.inspire.done' })}</span>}
      {result === 'error' && <span className="text-xs text-wrong">{translate({ key: 'workspaces.inspire.failed' })}</span>}
    </div>
  );
}

//? The secondary Feedback tab: ONE entry point for U1 (request a UI review) + U2 (the review inbox with
//? "Make ticket" / "Dismiss" per request), instead of three stacked disclosures above the section tabs.
//? Empty state teaches what this place is for and offers the request form as the way in.
function FeedbackSection() {
  const translate = useTranslator();
  const { activeProjectId, uiReviews, uiReviewAction } = useWorkspaces();
  const [formOpen, setFormOpen] = useState(false);
  return (
    <div className={`h-full min-h-0 overflow-y-auto p-4 md:p-6`}>
      <div className={`max-w-3xl flex flex-col gap-4`}>
        <SectionHead icon="comment" title={translate({ key: 'workspaces.designer.section.feedback' })} sub={translate({ key: 'workspaces.designer.feedbackSub' })} />
        {uiReviews.length === 0 && !formOpen ? (
          <div className={`rounded-xl border border-container1-border bg-container1`}>
            <EmptyState icon="comment" title={translate({ key: 'workspaces.uiReview.emptyTitle' })} sub={translate({ key: 'workspaces.uiReview.emptySub' })}
              action={<WsButton icon="paper-plane" onClick={() => { setFormOpen(true); }}>{translate({ key: 'workspaces.uiReview.title' })}</WsButton>} />
          </div>
        ) : (
          <>
            {uiReviews.length > 0 && (
              <div className={`flex flex-col gap-2`}>
                <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.uiReview.inboxTitle', params: [{ key: 'n', value: String(uiReviews.length) }] })}</div>
                {uiReviews.map((r) => (
                  <div key={r.id} className={`flex items-start gap-3 rounded-lg border border-container2-border bg-container2/50 px-3 py-2`}>
                    <div className={`min-w-0 flex-1`}>
                      <div className={`text-sm font-medium text-title truncate`}>{r.page ?? translate({ key: 'workspaces.uiReview.noPage' })}</div>
                      {r.problems.length > 0 && (
                        <div className={`flex flex-wrap gap-1 mt-1`}>
                          {r.problems.map((p) => {
                            //? Stored problems are taxonomy ids (server-validated) → show the translated label; an
                            //? unknown id (older data) falls back to the raw id rather than a broken key.
                            const known = UI_PROBLEMS.find((x) => x === p);
                            return <span key={p} className={`rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px]`}>{known ? translate({ key: `workspaces.uiReview.${uiProblemI18nKey(known)}` }) : p}</span>;
                          })}
                        </div>
                      )}
                      {r.notes && <div className={`text-xs text-muted mt-1 truncate`}>{r.notes}</div>}
                      {r.screenshots.length > 0 && <div className={`text-[11px] text-disabled mt-0.5`}>{translate({ key: 'workspaces.uiReview.shotCount', params: [{ key: 'n', value: String(r.screenshots.length) }] })}</div>}
                    </div>
                    <div className={`flex items-center gap-2 shrink-0`}>
                      <WsButton variant="secondary" icon="ticket" onClick={() => { uiReviewAction('ui-review-to-ticket', r.id, r.projectId ?? activeProjectId ?? undefined); }}>{translate({ key: 'workspaces.uiReview.makeTicket' })}</WsButton>
                      <button type="button" onClick={() => { uiReviewAction('ui-review-dismiss', r.id); }} className={`text-xs text-muted hover:text-wrong cursor-pointer`}>{translate({ key: 'workspaces.uiReview.dismiss' })}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {uiReviews.length > 0 ? (
              <Disclosure summary={translate({ key: 'workspaces.uiReview.title' })}>
                <UiReviewForm />
              </Disclosure>
            ) : (
              <div className={`rounded-xl border border-container1-border bg-container1 p-4 flex flex-col gap-3`}>
                <div className={`text-sm font-medium text-title`}>{translate({ key: 'workspaces.uiReview.title' })}</div>
                <UiReviewForm />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DesignerShell() {
  const translate = useTranslator();
  const d = useDesigner();
  const { activeProjectId, uiReviews, applyDesignTokens, copilotPrefill, consumeCopilotPrefill, readiness } = useWorkspaces();
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyResult, setApplyResult] = useState<'ok' | 'error' | null>(null);
  const [section, setSection] = useState<TabId>('gallery');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);
  const aiInputRef = useRef<HTMLInputElement | null>(null);
  const [focusAiBar, setFocusAiBar] = useState(false);
  //? #109 — an AI-drives-UI copilot directive that navigated here with a prompt pre-fill lands it in the
  //? unified AI-generate bar (switching to a matching AI section first) and focuses the field, then consumes
  //? the pre-fill so it fires exactly once. NEVER auto-submits — the user presses Generate (B-23).
  useEffect(() => {
    const p = copilotPrefill?.prompt ?? copilotPrefill?.brief ?? copilotPrefill?.description;
    if (p === undefined) return;
    const target = copilotPrefill?.section;
    if (target === 'themes' || target === 'styles' || target === 'animations') setSection(target);
    else if (!AI_SECTIONS.has(section)) setSection('themes');
    setAiPrompt(p);
    setFocusAiBar(true);
    consumeCopilotPrefill();
  }, [copilotPrefill, consumeCopilotPrefill, section]);
  //? Focus once the (possibly just-switched) section's AI bar has rendered.
  useEffect(() => {
    if (!focusAiBar) return;
    if (aiInputRef.current) { aiInputRef.current.focus(); setFocusAiBar(false); }
  }, [focusAiBar, section]);

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
  const applyTokensNow = () => {
    if (applyBusy || !activeProjectId) return;
    setApplyBusy(true); setApplyResult(null);
    void applyDesignTokens(activeProjectId).then((error) => {
      setApplyBusy(false);
      setApplyResult(error === null ? 'ok' : 'error');
    });
  };

  //? The tab strip: design sections + the secondary Feedback tab (unread-count badge keeps open requests
  //? discoverable without a permanently-expanded inbox).
  const tabs: { id: TabId; icon: IconName; count?: number }[] = [
    ...SECTIONS,
    { id: 'feedback', icon: 'comment', ...(uiReviews.length > 0 ? { count: uiReviews.length } : {}) },
  ];

  //? ADR 0034 pipeline coupling: ONE visible write ("Use in project") + the rarer variants of the same act
  //? (#166 save-without-activating, A09 apply-tokens) behind an overflow menu.
  const pipelineActions = (usePrimary: boolean) => (
    <div className={`flex items-center gap-2 flex-wrap`}>
      {applyResult === 'ok' && <span className={`text-xs text-correct inline-flex items-center gap-1`}><Icon name="circle-check" /> {translate({ key: 'workspaces.designer.applied' })}</span>}
      {applyResult === 'error' && <span className={`text-xs text-wrong`}>{translate({ key: 'workspaces.designer.applyFailed' })}</span>}
      {(saveBusy || applyBusy) && <Icon name="spinner" className={`animate-spin text-muted`} />}
      <WsButton variant={usePrimary ? 'primary' : 'secondary'} icon={useBusy ? 'spinner' : 'circle-check'} disabled={useBusy} className={useBusy ? '[&_svg]:animate-spin' : ''} onClick={useInProjectNow}>{translate({ key: 'workspaces.designer.useInProject' })}</WsButton>
      <PopMenu ariaLabel={translate({ key: 'workspaces.designer.moreActions' })} items={[
        { label: translate({ key: 'workspaces.designer.saveToLibrary' }), icon: 'box-archive', onClick: saveToLibNow },
        { label: translate({ key: 'workspaces.designer.applyTokens' }), icon: 'bolt', onClick: applyTokensNow },
      ]} />
    </div>
  );

  //? True empty state for the pipeline coupling: nothing is active yet → teach what "active" means and
  //? point at the Gallery (the primary path) while keeping the writes reachable.
  const noSystem = d.activeThemeName === null && d.activeStyleName === null;

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      {/* header: page identity + the GLOBAL preview controls (theme + light/dark drive EVERY section) */}
      <div className={`px-5 md:px-6 pt-4 pb-3 border-b border-divider shrink-0 flex flex-wrap items-center gap-3`}>
        <div className={`flex items-center gap-2 text-title min-w-0`}>
          <span className={`w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0`}><Icon name="palette" /></span>
          <div className={`min-w-0`}>
            <div className={`text-xl font-semibold leading-tight`}>{translate({ key: 'workspaces.designer.title' })}</div>
            <div className={`text-xs text-muted truncate`}>{translate({ key: 'workspaces.designer.tagline' })}</div>
          </div>
        </div>
        <div className={`flex-1`} />
        <div className={`flex items-center gap-2`}>
          <span className={`text-xs text-muted hidden sm:inline`}>{translate({ key: 'workspaces.designer.previewingWith' })}</span>
          <BaseDropdown items={themeItems} {...(activeItem ? { value: activeItem } : {})} onChange={(i) => { d.setActiveThemeId(String(i.id)); }} size="md" />
          <Segmented<ThemeMode> options={[{ id: 'light', label: <Icon name="sun" /> }, { id: 'dark', label: <Icon name="moon" /> }]} value={d.mode} onChange={d.setMode} />
        </div>
      </div>

      {/* Designer renders reference imagery via the media provider (fal) — with no key, generation silently
          returns placeholder assets. Flag it once at the top so a designer isn't fooled by stub previews. */}
      {!readiness.media.fal && (
        <div className={`px-4 md:px-6 pt-3 shrink-0`}>
          <SetupNotice
            variant="card"
            icon="wand-magic-sparkles"
            title={translate({ key: 'workspaces.setup.media.title' })}
            body={translate({ key: 'workspaces.setup.media.why' })}
            fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'admin', cta: translate({ key: 'workspaces.setup.media.cta' }) }}
          />
        </div>
      )}

      {/* section tabs (+ the secondary Feedback tab with its unread badge) */}
      <div className={`px-3 md:px-4 shrink-0 border-b border-divider flex items-center gap-1 overflow-x-auto ws-no-scrollbar`}>
        {tabs.map((t) => {
          const on = section === t.id;
          return (
            <button key={t.id} type="button" onClick={() => { setSection(t.id); }}
              className={`relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap cursor-pointer transition-colors ${on ? 'text-title' : 'text-muted hover:text-common'}`}>
              <Icon name={t.icon} className={on ? 'text-primary' : ''} /> {translate({ key: `workspaces.designer.section.${t.id}` })}
              {t.count != null && <span className={`rounded-full bg-primary/12 text-primary px-1.5 text-xs font-semibold`}>{t.count}</span>}
              {on && <span className={`absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-primary`} />}
            </button>
          );
        })}
      </div>

      {/* unified "AI generates / adjusts" bar — one input, targets the active section (no duplicate AI boxes) */}
      {AI_SECTIONS.has(section) && (
        <div className={`px-3 md:px-4 py-2 border-b border-divider flex items-center gap-2 bg-container1/40`}>
          <Icon name="wand-magic-sparkles" className={`text-primary shrink-0`} />
          <input ref={aiInputRef} value={aiPrompt} onChange={(e) => { setAiPrompt(e.target.value); }} disabled={aiBusy}
            onKeyDown={(e) => { if (e.key === 'Enter') runAi(); }}
            placeholder={translate({ key: `workspaces.designer.aiBar.${section}` })}
            className={`flex-1 min-w-0 h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30`} />
          {aiError && <span className={`text-xs text-wrong shrink-0`}>{translate({ key: 'workspaces.designer.aiError' })}</span>}
          <WsButton icon={aiBusy ? 'spinner' : 'wand-magic-sparkles'} onClick={runAi} disabled={aiBusy || aiPrompt.trim().length === 0} className={aiBusy ? '[&_svg]:animate-spin' : ''}>{translate({ key: aiBusy ? 'workspaces.designer.aiGenerating' : 'workspaces.designer.aiBar.generate' })}</WsButton>
        </div>
      )}

      {/* pipeline coupling (ADR 0034): the active design-system the coding agent builds on */}
      {(section === 'themes' || section === 'styles') && (noSystem ? (
        <div className={`px-3 md:px-4 py-2 border-b border-divider shrink-0`}>
          <div className={`rounded-xl border border-container1-border bg-container1`}>
            <EmptyState icon="link" title={translate({ key: 'workspaces.designer.noSystemTitle' })} sub={translate({ key: 'workspaces.designer.noSystemSub' })}
              action={<div className={`flex items-center justify-center gap-2 flex-wrap`}>
                <WsButton icon="table-cells-large" onClick={() => { setSection('gallery'); }}>{translate({ key: 'workspaces.designer.browseLooks' })}</WsButton>
                {pipelineActions(false)}
              </div>} />
          </div>
        </div>
      ) : (
        <div className={`px-3 md:px-4 py-2 border-b border-divider flex items-center gap-2 flex-wrap bg-container1/30 shrink-0`}>
          <span className={`text-xs text-muted inline-flex items-center gap-1.5 min-w-0`}>
            <Icon name="link" className={activeName ? 'text-correct' : 'text-muted'} />
            <span className={`truncate`}>{activeName ? translate({ key: 'workspaces.designer.activeInProject', params: [{ key: 'name', value: activeName }] }) : translate({ key: 'workspaces.designer.noneActive' })}</span>
          </span>
          <div className={`flex-1`} />
          {pipelineActions(true)}
        </div>
      ))}

      {/* active section */}
      <div className={`flex-1 min-h-0`}>
        {section === 'gallery' && <Gallery inspiration={<InspirationForm />} />}
        {section === 'styles' && <Styles />}
        {section === 'animations' && <Animations />}
        {section === 'themes' && <Themes />}
        {section === 'typography' && <Typography />}
        {section === 'feedback' && <FeedbackSection />}
      </div>
    </div>
  );
}
