//? intent: Marketing — take your product to market, KISS-first: write a short product brief once,
//? then the dominant generate grid turns it into marketing assets (copy, strategy, emails, ads, a
//? social calendar, names, thumbnails, video scripts), each a live-previewed artifact card you can
//? refine, regenerate, send to Content or delete. Brand library + brief editing sit behind drill-ins;
//? rare per-card actions live in an overflow menu. Own layout forked from the shared Studio surface
//? (user-chosen split: marketer focus here, the designer kinds live on /studio, which keeps its own
//? rendering in ../studio/page.tsx).

import { useEffect, useState } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Icon from '../../_components/Icon';
import { Disclosure, EmptyState, InfoTip, PopMenu, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { isSectionEnabled } from '../../_data/modules';
import type { StudioArtifact, StudioArtifactKind, StudioBrief } from '../../_data/types';
import { BrandDiffList } from '../studio/BrandDiffList';
import { buildBrandDiff } from '../studio/brandDiff';
import { ContentPromptPreview } from '../studio/promptStack';
import { ArtifactCard } from './cards';
import { MARKETER_KINDS } from './kinds';
import { BrandPanel, BriefForm } from './panels';

export const template = 'workspaces';

//? Three in-page destinations, progressive-disclosure style: 'main' (brief switcher + generate grid +
//? artifact stack — the job), 'brand' (the brand library drill-in), 'form' (create/edit a brief).
type View = 'main' | 'brand' | 'form';

export default function Marketing() {
  const translate = useTranslator();
  const { studioBriefs, studioArtifacts, studioBrand, generateArtifact, deleteBrief, deleteArtifact, promoteBrand, runContentOp, activeWorkspace, focusSetup } = useWorkspaces();
  //? Send-to-Content: only offered when the content lane is enabled for this workspace.
  const contentOn = isSectionEnabled(activeWorkspace.enabledSections, 'content');

  const [selectedId, setSelectedId] = useState<string | null>(studioBriefs[0]?.id ?? null);
  const [view, setView] = useState<View>('main');
  //? The brief being edited (null = create). Explicit state — NOT derived from the selection — so the
  //? auto-select effect below can never flip a create form into an edit form mid-flight.
  const [formTarget, setFormTarget] = useState<StudioBrief | null>(null);
  const [busyKind, setBusyKind] = useState<StudioArtifactKind | null>(null);
  const [refine, setRefine] = useState('');   //? I4 — an optional refine instruction applied to (re)generation.

  //? Auto-selection: the first brief auto-selects, and a deleted selected brief falls back to
  //? studioBriefs[0] — the main area never goes blank.
  useEffect(() => {
    if (selectedId && !studioBriefs.some((b) => b.id === selectedId)) setSelectedId(studioBriefs[0]?.id ?? null);
    if (!selectedId && studioBriefs[0]) setSelectedId(studioBriefs[0].id);
  }, [studioBriefs, selectedId]);

  const selected = studioBriefs.find((b) => b.id === selectedId) ?? null;
  const artifacts = studioArtifacts.filter((a) => a.briefId === selectedId);

  const runGenerate = async (kind: StudioArtifactKind) => {
    if (!selected) return;
    setBusyKind(kind);
    const trimmedRefine = refine.trim();
    await generateArtifact(selected.id, kind, trimmedRefine || undefined);
    //? I4 bug fix — persist which refine text produced this artifact, so a later card can never
    //? silently be mistaken for having used a different (stale or since-cleared) refine.
    setBusyKind(null);
    //? Consume the refine text on use — otherwise it silently reapplies to Regenerate on a
    //? completely different, older card with no record of which text produced which result.
    setRefine('');
  };

  //? GAP_SCAN G3 — put a generated landing page live at /s/<slug>. Re-publishing keeps the same URL,
  //? so this doubles as "update the live page" once it exists.
  const publishLive = (artifactId: string) => {
    runContentOp('studio-publish-site', '', { artifactId });
    notify.success({ key: 'workspaces.studio.publishedLive' });
  };
  const sendToContent = (artifactId: string) => {
    runContentOp('studio-send-to-content', '', { artifactId });
    notify.success({ key: 'workspaces.studio.sentToContent' });
  };

  //? Owner decision 6 — promoting overwrites the central Brand Library (palette/typography/voice/
  //? taglines/logoIdeas); the confirm shows a real before/after field diff instead of generic copy,
  //? and a successful promote records provenance so the Brand panel can say where it was set from.
  const promote = (artifact: StudioArtifact) => {
    const rows = buildBrandDiff(studioBrand, artifact.content);
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.studio.promoteBrandTitle' }),
      content: (
        <div className={`flex flex-col gap-2`}>
          <p className={`text-sm text-common`}>{translate({ key: 'workspaces.studio.promoteBrandBody' })}</p>
          <BrandDiffList rows={rows} />
        </div>
      ),
    }).then((ok) => { if (ok) void promoteBrand(artifact.id); });
  };

  const removeBrief = (b: StudioBrief) => void menuHandler.confirm({
    title: translate({ key: 'workspaces.studio.deleteBriefTitle', params: [{ key: 'name', value: b.name }] }),
    content: translate({ key: 'workspaces.studio.deleteBriefBody' }),
  }).then((ok) => { if (ok) { deleteBrief(b.id); if (selectedId === b.id) setSelectedId(null); } });

  const openCreate = () => { setFormTarget(null); setView('form'); };
  const openEdit = (b: StudioBrief) => { setFormTarget(b); setView('form'); };
  const backToMain = () => { setView('main'); if (!selectedId) setSelectedId(studioBriefs[0]?.id ?? null); };

  return (
    <div className={`h-full min-h-0 overflow-y-auto`}>
      {/* page header: what this place is + the one piece of context (Brand) that isn't the job */}
      <div className={`px-5 md:px-6 pt-5 pb-3 border-b border-divider flex flex-wrap items-center gap-3`}>
        <div className={`flex items-center gap-2 text-title min-w-0 flex-1`}>
          <span className={`w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0`}><Icon name="bullhorn" /></span>
          <div className={`min-w-0`}>
            <div className={`text-xl font-semibold leading-tight`}>{translate({ key: 'workspaces.sections.marketing' })}</div>
            <div className={`text-xs text-muted truncate`}>{translate({ key: 'workspaces.studio.marketingIntro' })}</div>
          </div>
        </div>
        {view !== 'brand' && (
          <div className={`flex items-center gap-1.5`}>
            <WsButton variant="secondary" icon="swatchbook" onClick={() => { setView('brand'); }}>{translate({ key: 'workspaces.studio.brandLibrary' })}</WsButton>
            {/* The button reads like a reference shelf; what is behind it is folded into every generation here. */}
            <InfoTip
              align="end"
              label={translate({ key: 'workspaces.tips.studio.brandGateLabel' })}
              title={translate({ key: 'workspaces.tips.studio.brandGateTitle' })}
              body={translate({ key: 'workspaces.tips.studio.brandGateBody' })}
              points={[
                { id: 'sent', label: translate({ key: 'workspaces.tips.studio.brandGateSent' }), desc: translate({ key: 'workspaces.tips.studio.brandGateSentDesc' }) },
                { id: 'voice', label: translate({ key: 'workspaces.tips.studio.brandGateVoice' }), desc: translate({ key: 'workspaces.tips.studio.brandGateVoiceDesc' }) },
              ]}
            />
          </div>
        )}
      </div>

      {/* brand library drill-in */}
      {view === 'brand' && (
        <div className={`p-5 md:p-6 max-w-2xl flex flex-col gap-4`}>
          <div><WsButton variant="ghost" icon="arrow-left" onClick={backToMain}>{translate({ key: 'workspaces.wsShell.back' })}</WsButton></div>
          <BrandPanel />
        </div>
      )}

      {/* brief create/edit drill-in */}
      {view === 'form' && (
        <div className={`p-5 md:p-6 max-w-2xl`}>
          <BriefForm
            key={formTarget?.id ?? 'new'}
            brief={formTarget}
            onSaved={() => { if (!formTarget) setSelectedId(null); setView('main'); }}
            onCancel={studioBriefs.length > 0 ? backToMain : undefined}
          />
        </div>
      )}

      {view === 'main' && (
        studioBriefs.length === 0
          ? (
            //? Teaching empty state: explains WHAT a brief is for and hands over the primary action.
            <div className={`p-5 md:p-6`}>
              <EmptyState
                icon="bullhorn"
                title={translate({ key: 'workspaces.studio.marketingEmptyTitle' })}
                sub={translate({ key: 'workspaces.studio.marketingEmptyBody' })}
                action={<WsButton icon="plus" onClick={openCreate}>{translate({ key: 'workspaces.studio.createFirstBrief' })}</WsButton>}
              />
            </div>
          )
          : (
            <div className={`p-5 md:p-6 flex flex-col gap-5 max-w-5xl`}>
              {/* brief switcher: horizontal chips instead of a fixed left rail (phone-first) */}
              <div className={`flex flex-col gap-2`}>
                <div className={`text-xs font-medium text-muted uppercase tracking-wide`}>{translate({ key: 'workspaces.studio.briefs' })}</div>
                <div className={`flex items-center gap-2 overflow-x-auto ws-no-scrollbar`}>
                  {studioBriefs.map((b) => (
                    <button
                      key={b.id} type="button" onClick={() => { setSelectedId(b.id); }}
                      className={`shrink-0 max-w-56 truncate rounded-full border px-3 py-1.5 text-sm transition-colors cursor-pointer ${selectedId === b.id ? 'border-primary-border bg-primary/12 text-primary font-medium' : 'border-container1-border bg-container1 text-common hover:bg-container1-hover'}`}
                    >
                      {b.name}
                    </button>
                  ))}
                  <button type="button" onClick={openCreate} className={`shrink-0 rounded-full border border-dashed border-container1-border px-3 py-1.5 text-sm text-muted hover:text-primary hover:border-primary transition-colors cursor-pointer flex items-center gap-1.5`}>
                    <Icon name="plus" className={`text-xs`} />{translate({ key: 'workspaces.studio.newBrief' })}
                  </button>
                </div>
              </div>

              {selected && (
                <>
                  {/* selected brief: name/product/audience + Edit; Delete lives in the overflow menu */}
                  <div className={`flex items-start justify-between gap-3`}>
                    <div className={`min-w-0`}>
                      <div className={`text-lg font-semibold text-title truncate`}>{selected.productName}</div>
                      <div className={`text-sm text-muted truncate`}>{selected.name} · {selected.audience || translate({ key: 'workspaces.studio.noAudience' })}</div>
                    </div>
                    <div className={`flex items-center gap-1 shrink-0`}>
                      <WsButton variant="secondary" icon="pen" onClick={() => { openEdit(selected); }}>{translate({ key: 'workspaces.studio.editBrief' })}</WsButton>
                      <PopMenu ariaLabel={translate({ key: 'workspaces.studio.briefMenu' })} items={[{ label: translate({ key: 'workspaces.studio.deleteBrief' }), icon: 'trash-can', danger: true, onClick: () => { removeBrief(selected); } }]} />
                    </div>
                  </div>

                  {/* THE primary action: the marketer kind grid (8 clearly-labeled generate buttons) */}
                  <div className={`flex flex-col gap-2`}>
                    <div className={`text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-1.5`}>
                      <Icon name="wand-magic-sparkles" className={`text-disabled`} />
                      {translate({ key: 'workspaces.studio.generateHeading' })}
                    </div>
                    {/* duplicateConcepts #2 — the second AI prompt stack, visible before you generate */}
                    <div className={`flex items-start gap-1.5`}>
                      <div className={`min-w-0 flex-1`}><ContentPromptPreview briefTone={selected.tone} brandVoice={studioBrand?.voice ?? ''} refine={refine} /></div>
                      {/* The preview only lists what THIS page sets; the workspace AI settings add more at the provider. */}
                      <InfoTip
                        align="end"
                        className={`mt-1.5`}
                        label={translate({ key: 'workspaces.tips.studio.promptExtrasLabel' })}
                        title={translate({ key: 'workspaces.tips.studio.promptExtrasTitle' })}
                        body={translate({ key: 'workspaces.tips.studio.promptExtrasBody' })}
                        points={[
                          { id: 'language', label: translate({ key: 'workspaces.tips.studio.promptExtrasLanguage' }), desc: translate({ key: 'workspaces.tips.studio.promptExtrasLanguageDesc' }), onGo: () => { focusSetup({ view: 'workspace', tab: 'aibehavior' }); } },
                          { id: 'skills', label: translate({ key: 'workspaces.tips.studio.promptExtrasSkills' }), desc: translate({ key: 'workspaces.tips.studio.promptExtrasSkillsDesc' }), onGo: () => { focusSetup({ view: 'workspace', tab: 'aibehavior' }); } },
                          { id: 'knowledge', label: translate({ key: 'workspaces.tips.studio.promptExtrasKnowledge' }), desc: translate({ key: 'workspaces.tips.studio.promptExtrasKnowledgeDesc' }) },
                        ]}
                      />
                    </div>
                    <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2`}>
                      {MARKETER_KINDS.map(({ kind, icon }) => (
                        <button
                          key={kind} type="button" disabled={busyKind !== null} onClick={() => { void runGenerate(kind); }}
                          className={`flex items-center gap-2 rounded-xl border border-container1-border bg-container1 px-3 py-2.5 text-sm text-title hover:border-primary hover:bg-container1-hover transition-colors ${busyKind === null ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                        >
                          <Icon name={busyKind === kind ? 'spinner' : icon} className={busyKind === kind ? `animate-spin text-primary` : `text-primary`} />
                          <span className={`truncate`}>{translate({ key: `workspaces.studio.kind.${kind}` })}</span>
                        </button>
                      ))}
                    </div>
                    {busyKind && <div className={`text-xs text-muted flex items-center gap-1.5`}><Icon name="spinner" className={`animate-spin`} />{translate({ key: 'workspaces.studio.generating' })}</div>}
                    {/* I4 refine — progressive disclosure; a filled value badges the summary so users know it applies */}
                    <Disclosure summary={
                      <span className={`flex items-center gap-2`}>
                        {translate({ key: 'workspaces.studio.refineToggle' })}
                        {refine.trim().length > 0 && <span className={`rounded-full bg-primary/12 text-primary text-[11px] px-2 py-0.5 font-medium`}>{translate({ key: 'workspaces.studio.refineActive' })}</span>}
                      </span>
                    }>
                      <input value={refine} onChange={(e) => { setRefine(e.target.value); }} placeholder={translate({ key: 'workspaces.studio.refinePlaceholder' })} className={`w-full rounded-lg border border-container1-border bg-container2/40 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring`} />
                    </Disclosure>
                  </div>

                  {/* generated assets for the selected brief */}
                  <div className={`flex flex-col gap-2`}>
                    <div className={`flex items-center gap-1.5`}>
                      <div className={`text-xs font-medium text-muted uppercase tracking-wide`}>{translate({ key: 'workspaces.studio.assetsHeading' })}</div>
                      {/* Regenerate reads like "replace"; every run creates a NEW row, and this page also empties the refine box. */}
                      <InfoTip
                        align="start"
                        label={translate({ key: 'workspaces.tips.studio.regenerateLabel' })}
                        title={translate({ key: 'workspaces.tips.studio.regenerateTitle' })}
                        body={translate({ key: 'workspaces.tips.studio.regenerateBody' })}
                        points={[
                          { id: 'published', label: translate({ key: 'workspaces.tips.studio.regeneratePublished' }), desc: translate({ key: 'workspaces.tips.studio.regeneratePublishedDesc' }) },
                          { id: 'refine', label: translate({ key: 'workspaces.tips.studio.regenerateRefineCleared' }), desc: translate({ key: 'workspaces.tips.studio.regenerateRefineClearedDesc' }) },
                        ]}
                      />
                    </div>
                    {artifacts.length === 0 && !busyKind
                      ? (
                        //? Teaching empty state: the grid above is the way to fill this list.
                        <EmptyState
                          icon="wand-magic-sparkles"
                          title={translate({ key: 'workspaces.studio.noArtifactsTitle' })}
                          sub={translate({ key: 'workspaces.studio.noArtifactsBody' })}
                        />
                      )
                      : (
                        <div className={`flex flex-col gap-4`}>
                          {artifacts.map((a) => (
                            <ArtifactCard
                              key={a.id} artifact={a} busy={busyKind !== null} pendingRefine={refine}
                              onDelete={() => { deleteArtifact(a.id); }}
                              onRegenerate={() => { void runGenerate(a.kind); }}
                              {...(a.kind === 'brand' && a.status === 'ready' ? { onPromote: () => { promote(a); } } : {})}
                              {...(contentOn && a.status === 'ready' ? { onSendToContent: () => { sendToContent(a.id); } } : {})}
                              {...(a.kind === 'landing' && a.status === 'ready' ? { onPublishLive: () => { publishLive(a.id); } } : {})}
                            />
                          ))}
                        </div>
                      )}
                  </div>
                </>
              )}
            </div>
          )
      )}
    </div>
  );
}
