//? intent: Studio — describe your product once in a short BRIEF and let the AI designer + marketer
//? generate ready-to-use assets from it: a landing page, brand kit, marketing copy, emails, ads, a
//? social calendar, names, ad creatives and video scripts — each a live-previewed card you can
//? regenerate, publish live or send onward. The brand library sits behind a secondary tab; rare
//? per-card actions live in overflow menus. Built on the pluggable AI-provider layer (ADR 0007).

import { useEffect, useState } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { menuHandler } from 'src/_functions/menuHandler';
import Icon, { type IconName } from '../../_components/Icon';
import { Disclosure, EmptyState, InfoTip, InteractiveRow, PopMenu, SectionCard, Segmented, WsButton, type InfoTipPoint, type PopMenuItem } from '../../_components/primitives';
import { SetupNotice } from '../../_components/SetupNotice';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { isSectionEnabled } from '../../_data/modules';
import type { StudioArtifact, StudioArtifactKind, StudioBrief } from '../../_data/types';
import { BrandDiffList } from './BrandDiffList';
import { buildBrandDiff } from './brandDiff';
import { BrandPanel } from './BrandPanel';
import { ContentPromptPreview } from './promptStack';
import { ArtifactBody } from './previews';
import { asRecord, asStr, downloadHtmlAsPng, inputCls } from './content';

export const template = 'workspaces';

const KINDS: { kind: StudioArtifactKind; icon: IconName; role: 'designer' | 'marketer' }[] = [
  { kind: 'landing', icon: 'display', role: 'designer' },
  { kind: 'component', icon: 'table-columns', role: 'designer' },
  { kind: 'brand', icon: 'wand-magic-sparkles', role: 'designer' },
  { kind: 'copy', icon: 'file-lines', role: 'marketer' },
  { kind: 'strategy', icon: 'diagram-project', role: 'marketer' },
  { kind: 'email', icon: 'paper-plane', role: 'marketer' },
  { kind: 'ads', icon: 'bolt', role: 'marketer' },
  { kind: 'social', icon: 'calendar-day', role: 'marketer' },
  { kind: 'names', icon: 'list-check', role: 'marketer' },
  { kind: 'thumbnail', icon: 'crop', role: 'marketer' },
  { kind: 'videoScript', icon: 'play', role: 'marketer' },
];

export default function Studio() { return <StudioSurface variant="studio" />; }

//? #109 — AI-drives-UI: map a copilot prefill (free-form field→value hints) onto the brief-form fields.
//? Returns null when the prefill carries nothing brief-shaped, so a directive aimed at another page's form
//? is never swallowed here. Aliases cover the likely model spellings ("product", "brief", "description").
interface BriefDraft { name: string; productName: string; audience: string; tone: string; goals: string; notes: string }
function briefDraftFromPrefill(prefill: Record<string, string>): BriefDraft | null {
  const pick = (...keys: string[]) => { for (const k of keys) { const v = prefill[k]; if (v !== undefined && v.trim().length > 0) return v.trim(); } return ''; };
  const draft: BriefDraft = {
    name: pick('name'),
    productName: pick('productName', 'product', 'title'),
    audience: pick('audience'),
    tone: pick('tone'),
    goals: pick('goals', 'goal'),
    notes: pick('notes', 'brief', 'description'),
  };
  if ([draft.name, draft.productName, draft.audience, draft.tone, draft.goals, draft.notes].every((v) => v.length === 0)) return null;
  //? A save needs both name + productName; derive the missing one so the user only has to confirm.
  if (draft.productName.length === 0) draft.productName = draft.name;
  if (draft.name.length === 0) draft.name = draft.productName;
  return draft;
}

//? The shared Studio surface. `variant` gives /studio (design + marketing kinds) and /marketing (marketing kinds
//? only) their own page + focus while sharing the brief workspace + generator — the user chose a split marketing
//? page over one shared Studio. `/marketing` re-uses this with variant="marketing" (marketer kinds, no Brand tab).
export function StudioSurface({ variant = 'studio' }: { variant?: 'studio' | 'marketing' }) {
  const translate = useTranslator();
  const { studioBriefs, studioArtifacts, studioBrand, generateArtifact, deleteBrief, deleteArtifact, promoteBrand, runContentOp, activeWorkspace, copilotPrefill, consumeCopilotPrefill, readiness, focusSetup } = useWorkspaces();
  //? Send-to-Content (gap-fix): only offered when the content lane is enabled for this workspace.
  const contentOn = isSectionEnabled(activeWorkspace.enabledSections, 'content');
  //? GAP_SCAN G3 — put a generated landing page live at /s/<slug>. Re-publishing keeps the same URL, so
  //? this doubles as "update the live page" once it exists.
  const publishLive = (artifactId: string) => {
    runContentOp('studio-publish-site', '', { artifactId });
    notify.success({ key: 'workspaces.studio.publishedLive' });
  };

  const sendToContent = (artifactId: string) => {
    runContentOp('studio-send-to-content', '', { artifactId });
    notify.success({ key: 'workspaces.studio.sentToContent' });
  };
  //? Marketing focuses on the marketer kinds; Studio shows both designer + marketer groups.
  const roles: readonly ('designer' | 'marketer')[] = variant === 'marketing' ? ['marketer'] : ['designer', 'marketer'];
  const [selectedId, setSelectedId] = useState<string | null>(studioBriefs[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [busyKind, setBusyKind] = useState<StudioArtifactKind | null>(null);
  const [tab, setTab] = useState<'assets' | 'brand'>('assets');
  const [refine, setRefine] = useState('');   //? I4 — an optional refine instruction applied to (re)generation.
  //? #109 — a consumed copilot prefill, held as a keyed draft so the (possibly already-mounted) new-brief
  //? form remounts with the values. `seq` keeps repeated directives distinct.
  const [prefillDraft, setPrefillDraft] = useState<{ seq: number; values: BriefDraft } | null>(null);

  //? #109 — AI-drives-UI: a copilot directive that navigated here (or to the marketing variant, which embeds
  //? this same surface) with brief-shaped hints opens the NEW-brief form prefilled, then consumes the prefill
  //? so it fires exactly once. Non-brief-shaped prefills are left alone (guard: briefDraftFromPrefill → null),
  //? and the user still submits the form themselves — nothing is auto-saved.
  useEffect(() => {
    if (!copilotPrefill) return;
    const values = briefDraftFromPrefill(copilotPrefill);
    if (!values) return;
    setPrefillDraft((p) => ({ seq: (p?.seq ?? 0) + 1, values }));
    setEditing(true);
    setSelectedId(null);
    setTab('assets');
    consumeCopilotPrefill();
  }, [copilotPrefill, consumeCopilotPrefill]);

  useEffect(() => {
    if (selectedId && !studioBriefs.some((b) => b.id === selectedId)) setSelectedId(studioBriefs[0]?.id ?? null);
    //? don't auto-select while a NEW brief is being drafted (selectedId is deliberately null then) —
    //? re-selecting would flip the form into edit-mode of the first brief.
    if (!selectedId && studioBriefs[0] && !editing) setSelectedId(studioBriefs[0].id);
  }, [studioBriefs, selectedId, editing]);

  const selected = studioBriefs.find((b) => b.id === selectedId) ?? null;
  const artifacts = studioArtifacts.filter((a) => a.briefId === selectedId);

  const runGenerate = async (kind: StudioArtifactKind) => {
    if (!selected || busyKind !== null) return;
    setBusyKind(kind);
    const trimmedRefine = refine.trim();
    await generateArtifact(selected.id, kind, trimmedRefine || undefined);
    //? I4 bug fix — record which refine text produced this artifact (Generate AND Regenerate both
    //? land here, sharing the one refine box), so a later card never silently inherits a stale value.
    setBusyKind(null);
  };

  //? Owner decision 6 — gate promote behind a confirm showing a real before/after field diff, and
  //? record provenance so the Brand panel can say where the library was last set from.
  const promoteWithConfirm = (artifact: StudioArtifact) => {
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

  const startNewBrief = () => { setEditing(true); setSelectedId(null); setTab('assets'); setPrefillDraft(null); };
  const openBrief = (id: string) => { setSelectedId(id); setEditing(false); setPrefillDraft(null); };

  //? The brand tab keeps the old rail-subtitle signal ("N colours" / set / not set) so brand state
  //? stays visible without opening the panel.
  const brandSignal = studioBrand
    ? (studioBrand.palette.length > 0
      ? translate({ key: 'workspaces.studio.brandColours', params: [{ key: 'count', value: String(studioBrand.palette.length) }] })
      : translate({ key: 'workspaces.studio.brandSet' }))
    : translate({ key: 'workspaces.studio.brandUnset' });
  const brandOpen = variant === 'studio' && tab === 'brand';

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      {/* Studio artifacts are AI-generated (copy/strategy via text, thumbnails via media) — with no provider
          every "Generate" fails or returns nothing. Surface it once at the top instead of a silent failure. */}
      {!readiness.aiText && (
        <div className={`px-4 md:px-6 pt-4 shrink-0`}>
          <SetupNotice
            variant="card"
            icon="robot"
            title={translate({ key: 'workspaces.setup.ai.title' })}
            body={translate({ key: 'workspaces.setup.ai.why' })}
            fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'admin', cta: translate({ key: 'workspaces.setup.ai.cta' }) }}
            hint={translate({ key: 'workspaces.setup.ai.hint' })}
          />
        </div>
      )}
      {/* ---- Assets | Brand — the brand library is a secondary tab, only on the studio variant ---- */}
      {variant === 'studio' && (
        <div className={`px-4 md:px-6 pt-4 shrink-0 overflow-x-auto ws-no-scrollbar flex items-center gap-2`}>
          <Segmented
            options={[
              { id: 'assets', label: <span className={`inline-flex items-center gap-1.5`}><Icon name="table-cells-large" />{translate({ key: 'workspaces.studio.tabAssets' })}</span> },
              { id: 'brand', label: <span className={`inline-flex items-center gap-1.5`}><Icon name="book-open" />{translate({ key: 'workspaces.studio.tabBrand' })}<span className={`text-xs text-muted font-normal whitespace-nowrap`}>· {brandSignal}</span></span> },
            ]}
            value={tab} onChange={setTab}
          />
          {/* The Brand tab looks like a place to store colours; it is actually a switch on every generation. */}
          <InfoTip
            align="start"
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

      {brandOpen
        ? <div className={`flex-1 min-h-0 overflow-y-auto`}><BrandPanel /></div>
        : (
          <div className={`flex flex-1 min-h-0`}>
            {/* ---- Brief rail (md+): pick a brief; creating one is a labelled action ---- */}
            {studioBriefs.length > 0 && (
              <div className={`hidden md:flex w-64 shrink-0 border-r border-divider flex-col min-h-0`}>
                <div className={`flex items-center justify-between gap-2 px-4 py-3 shrink-0`}>
                  <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.studio.briefs' })}</div>
                  <button type="button" onClick={startNewBrief} className={`inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover cursor-pointer`}><Icon name="plus" className={`text-xs`} />{translate({ key: 'workspaces.studio.newBrief' })}</button>
                </div>
                <div className={`flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-1`}>
                  {studioBriefs.map((b) => (
                    <InteractiveRow key={b.id} onClick={() => { openBrief(b.id); }} selected={selectedId === b.id && !editing}>
                      <div className={`text-sm text-title truncate`}>{b.name}</div>
                      <div className={`text-xs text-muted truncate`}>{b.productName}</div>
                    </InteractiveRow>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Main ---- */}
            <div className={`flex-1 min-h-0 overflow-y-auto`}>
              {studioBriefs.length === 0 && !editing
                ? (
                  //? Teaching empty state — explains what Studio is FOR and offers the one primary action.
                  <div className={`h-full flex items-center justify-center p-6`}>
                    <EmptyState
                      icon="wand-magic-sparkles"
                      title={translate({ key: 'workspaces.studio.emptyTitle' })}
                      sub={translate({ key: 'workspaces.studio.emptyBody' })}
                      action={<WsButton icon="plus" onClick={() => { setEditing(true); }}>{translate({ key: 'workspaces.studio.createFirstBrief' })}</WsButton>}
                    />
                  </div>
                )
                : (selected && !editing
                  ? (
                    <div className={`p-4 md:p-6 flex flex-col gap-6 max-w-5xl`}>
                      {/* phone brief switcher — the rail is md+; below that a horizontal chip row */}
                      <div className={`md:hidden flex items-center gap-1.5 overflow-x-auto ws-no-scrollbar`}>
                        {studioBriefs.map((b) => (
                          <button key={b.id} type="button" onClick={() => { openBrief(b.id); }} className={`shrink-0 rounded-full border px-3 h-8 text-sm transition-colors cursor-pointer ${selectedId === b.id ? 'bg-primary/10 border-primary-border text-primary' : 'bg-container1 border-container1-border text-common'}`}>
                            {b.name}
                          </button>
                        ))}
                        <button type="button" onClick={startNewBrief} className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border border-dashed border-container1-border px-3 h-8 text-sm text-muted hover:text-primary transition-colors cursor-pointer`}><Icon name="plus" className={`text-xs`} />{translate({ key: 'workspaces.studio.newBrief' })}</button>
                      </div>

                      {/* brief header — edit stays a labelled button; delete moves into the overflow menu */}
                      <div className={`flex items-start justify-between gap-3`}>
                        <div className={`min-w-0`}>
                          <div className={`text-xl font-semibold text-title truncate`}>{selected.productName}</div>
                          <div className={`text-sm text-muted mt-0.5 truncate`}>{selected.name} · {selected.audience || translate({ key: 'workspaces.studio.noAudience' })}</div>
                        </div>
                        <div className={`flex items-center gap-1.5 shrink-0`}>
                          <WsButton variant="secondary" onClick={() => { setEditing(true); }}>{translate({ key: 'workspaces.studio.editBrief' })}</WsButton>
                          <PopMenu
                            ariaLabel={translate({ key: 'workspaces.studio.briefActions' })}
                            items={[{ icon: 'trash', label: translate({ key: 'workspaces.studio.deleteBrief' }), danger: true, onClick: () => { removeBrief(selected); } }]}
                          />
                        </div>
                      </div>

                      {/* ---- Generate — THE primary action, grouped by role (Designer / Marketer) ---- */}
                      <div className={`flex flex-col gap-3`}>
                        <div>
                          <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.studio.generate' })}</div>
                          <div className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.studio.generateHint' })}</div>
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
                        {roles.map((role) => (
                          <div key={role}>
                            <div className={`text-xs font-medium text-muted uppercase tracking-wide mb-1.5 flex items-center gap-1.5`}>
                              <Icon name={role === 'designer' ? 'sliders' : 'chart-column'} className={`text-disabled`} />
                              {translate({ key: `workspaces.studio.role.${role}` })}
                            </div>
                            <div className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2`}>
                              {KINDS.filter((k) => k.role === role).map(({ kind, icon }) => (
                                <button key={kind} type="button" disabled={busyKind !== null} onClick={() => { void runGenerate(kind); }}
                                  className={`flex items-center gap-2 rounded-xl border border-container1-border bg-container1 px-3 py-2.5 text-sm text-title hover:border-primary hover:bg-container1-hover transition-colors ${busyKind === null ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                                  <Icon name={busyKind === kind ? 'spinner' : icon} className={busyKind === kind ? 'animate-spin text-primary' : 'text-primary'} />
                                  <span className={`truncate`}>{translate({ key: `workspaces.studio.kind.${kind}` })}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        {/* I4 — the optional refine instruction, collapsed by default; the badge shows it will be applied. */}
                        <Disclosure summary={(
                          <span className={`inline-flex items-center gap-2`}>
                            {translate({ key: 'workspaces.studio.refineTitle' })}
                            {refine.trim().length > 0 && <span className={`inline-flex items-center gap-1.5 text-xs font-normal text-primary`}><span className={`w-1.5 h-1.5 rounded-full bg-primary`} />{translate({ key: 'workspaces.studio.refineActive' })}</span>}
                          </span>
                        )}>
                          <input value={refine} onChange={(e) => { setRefine(e.target.value); }} placeholder={translate({ key: 'workspaces.studio.refinePlaceholder' })} className={inputCls} />
                          {/* IA-conflict finding — refine/tone/voice have no stated precedence; say it inline. */}
                          <div className={`text-xs text-muted mt-1.5`}>{translate({ key: 'workspaces.studio.refinePrecedenceHint' })}</div>
                        </Disclosure>
                        {busyKind && <div className={`text-xs text-muted flex items-center gap-1.5`}><Icon name="spinner" className={`animate-spin`} />{translate({ key: 'workspaces.studio.generating' })}</div>}
                      </div>

                      {/* ---- Generated assets ---- */}
                      <div className={`flex flex-col gap-3`}>
                        <div className={`flex items-center gap-1.5`}>
                          <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.studio.artifactsTitle' })}</div>
                          {/* Regenerate reads like "replace"; every run creates a NEW row, and a published page keeps its own address. */}
                          <InfoTip
                            align="start"
                            label={translate({ key: 'workspaces.tips.studio.regenerateLabel' })}
                            title={translate({ key: 'workspaces.tips.studio.regenerateTitle' })}
                            body={translate({ key: 'workspaces.tips.studio.regenerateBody' })}
                            points={[{ id: 'published', label: translate({ key: 'workspaces.tips.studio.regeneratePublished' }), desc: translate({ key: 'workspaces.tips.studio.regeneratePublishedDesc' }) }]}
                          />
                        </div>
                        {artifacts.length === 0 && !busyKind && (
                          <EmptyState
                            icon="wand-magic-sparkles"
                            title={translate({ key: 'workspaces.studio.emptyBriefTitle' })}
                            sub={translate({ key: variant === 'marketing' ? 'workspaces.studio.emptyBriefBodyMarketing' : 'workspaces.studio.emptyBriefBody' })}
                          />
                        )}
                        {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} busy={busyKind !== null} pendingRefine={refine} onDelete={() => { deleteArtifact(a.id); }} onRegenerate={() => { void runGenerate(a.kind); }} {...(a.kind === 'brand' && a.status === 'ready' ? { onPromote: () => { promoteWithConfirm(a); } } : {})} {...(contentOn && a.status === 'ready' ? { onSendToContent: () => { sendToContent(a.id); } } : {})} {...(a.kind === 'landing' && a.status === 'ready' ? { onPublishLive: () => { publishLive(a.id); } } : {})} />)}
                      </div>
                    </div>
                  )
                  : <BriefForm key={selected?.id ?? (prefillDraft ? `prefill-${String(prefillDraft.seq)}` : 'new')} brief={editing ? selected : null} {...(!selected && prefillDraft ? { initial: prefillDraft.values } : {})} onSaved={() => { setEditing(false); setPrefillDraft(null); }} onCancel={studioBriefs.length > 0 ? () => { setEditing(false); setPrefillDraft(null); if (!selectedId) setSelectedId(studioBriefs[0]?.id ?? null); } : undefined} />)}
            </div>
          </div>
        )}
    </div>
  );
}

//? ---- Brief form ----
//? `initial` (#109) seeds a NEW brief from a copilot prefill; the user reviews + saves themselves.
function BriefForm({ brief, initial, onSaved, onCancel }: { brief: StudioBrief | null; initial?: BriefDraft; onSaved: () => void; onCancel?: () => void }) {
  const translate = useTranslator();
  const { saveBrief, studioBriefs } = useWorkspaces();
  const [name, setName] = useState(brief?.name ?? initial?.name ?? '');
  const [productName, setProductName] = useState(brief?.productName ?? initial?.productName ?? '');
  const [audience, setAudience] = useState(brief?.audience ?? initial?.audience ?? '');
  const [tone, setTone] = useState(brief?.tone ?? initial?.tone ?? '');
  const [goals, setGoals] = useState(brief?.goals ?? initial?.goals ?? '');
  const [notes, setNotes] = useState(brief?.notes ?? initial?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const canSave = name.trim().length > 0 && productName.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    await saveBrief({ ...(brief ? { id: brief.id } : {}), name: name.trim(), productName: productName.trim(), audience: audience.trim(), tone: tone.trim(), goals: goals.trim(), notes: notes.trim() });
    setSaving(false);
    onSaved();
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, area = false) => (
    <div className={`flex flex-col gap-1`}>
      <span className={`text-xs text-muted`}>{label}</span>
      {area
        ? <textarea value={value} onChange={(e) => { set(e.target.value); }} placeholder={placeholder} rows={3} className={`${inputCls} h-auto py-2 resize-y`} />
        : <input value={value} onChange={(e) => { set(e.target.value); }} placeholder={placeholder} className={inputCls} />}
    </div>
  );

  //? "flat stack of 6 identical rows" finding — a second/third brief re-typed everything from a blank
  //? page every time. Offered only on a brand-new brief (not edit) when a brief already exists to copy.
  const duplicateItems: DropdownItem[] = studioBriefs.map((b) => ({ id: b.id, value: b.id, item: `${b.name} — ${b.productName}` }));
  const applyDuplicate = (id: string) => {
    const source = studioBriefs.find((b) => b.id === id);
    if (!source) return;
    setName(source.name); setProductName(source.productName); setAudience(source.audience); setTone(source.tone); setGoals(source.goals); setNotes(source.notes ?? '');
  };

  return (
    <div className={`p-4 md:p-6 max-w-2xl flex flex-col gap-4`}>
      <div className={`text-lg font-semibold text-title`}>{translate({ key: brief ? 'workspaces.studio.editBrief' : 'workspaces.studio.newBrief' })}</div>
      <div className={`text-sm text-muted -mt-2`}>{translate({ key: 'workspaces.studio.briefIntro' })}</div>
      {!brief && studioBriefs.length > 0 && (
        <div className={`flex flex-col gap-1`}>
          <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.studio.duplicateFromLabel' })}</span>
          <Dropdown width="full" items={duplicateItems} placeholder={translate({ key: 'workspaces.studio.duplicateFromPlaceholder' })} onChange={(it) => { applyDuplicate(String(it.id)); }} />
        </div>
      )}
      {/* grouped into two visually distinct clusters instead of six identical label+input rows */}
      <SectionCard title={translate({ key: 'workspaces.studio.identitySection' })}>
        <div className={`flex flex-col gap-4`}>
          {field(translate({ key: 'workspaces.studio.fieldName' }), name, setName, translate({ key: 'workspaces.studio.fieldNamePlaceholder' }))}
          {field(translate({ key: 'workspaces.studio.fieldProduct' }), productName, setProductName, translate({ key: 'workspaces.studio.fieldProductPlaceholder' }))}
        </div>
      </SectionCard>
      <SectionCard title={translate({ key: 'workspaces.studio.targetingSection' })}>
        <div className={`flex flex-col gap-4`}>
          {field(translate({ key: 'workspaces.studio.fieldAudience' }), audience, setAudience, translate({ key: 'workspaces.studio.fieldAudiencePlaceholder' }))}
          {field(translate({ key: 'workspaces.studio.fieldTone' }), tone, setTone, translate({ key: 'workspaces.studio.fieldTonePlaceholder' }))}
        </div>
      </SectionCard>
      {field(translate({ key: 'workspaces.studio.fieldGoals' }), goals, setGoals, translate({ key: 'workspaces.studio.fieldGoalsPlaceholder' }), true)}
      {field(translate({ key: 'workspaces.studio.fieldNotes' }), notes, setNotes, translate({ key: 'workspaces.studio.fieldNotesPlaceholder' }), true)}
      <div className={`flex items-center justify-end gap-2 pt-1`}>
        {onCancel && <WsButton variant="ghost" onClick={onCancel}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>}
        <WsButton icon="check" onClick={() => { void save(); }} disabled={!canSave || saving}>{translate({ key: 'workspaces.studio.saveBrief' })}</WsButton>
      </div>
    </div>
  );
}

//? ---- Artifact card ----
//? Promoted, point-of-the-card actions (Use as brand / Send to Content / Publish live) stay visible
//? and labelled; secondary ones (Copy HTML, Download PNG, Regenerate, Delete) live in the overflow menu.
function ArtifactCard({ artifact, busy, pendingRefine, onDelete, onRegenerate, onPromote, onSendToContent, onPublishLive }: { artifact: StudioArtifact; busy: boolean; pendingRefine: string; onDelete: () => void; onRegenerate: () => void; onPromote?: () => void; onSendToContent?: () => void; onPublishLive?: () => void }) {
  const translate = useTranslator();
  const { navigate } = useWorkspaces();
  const c = asRecord(artifact.content);
  const when = new Date(artifact.createdAt).toLocaleString();
  const html = asStr(c.html);
  const htmlKind = artifact.kind === 'landing' || artifact.kind === 'component' || artifact.kind === 'thumbnail';
  //? I4 bug fix — the refine that PRODUCED this card (persisted, historical) vs. the refine that WILL
  //? apply if Regenerate is clicked now (the live shared box) are two different things; show both
  //? instead of leaving the user to guess which one a stale box silently reapplies.
  const usedRefine = artifact.refine ?? null;
  const trimmedPending = pendingRefine.trim();
  const regenerateLabel = trimmedPending.length > 0
    ? translate({ key: 'workspaces.studio.regenerateWithRefine', params: [{ key: 'refine', value: trimmedPending.length > 28 ? `${trimmedPending.slice(0, 27)}…` : trimmedPending }] })
    : translate({ key: 'workspaces.studio.regenerate' });
  const menu: PopMenuItem[] = [
    ...(htmlKind && artifact.status === 'ready' && html.trim().length > 0
      ? [
        { icon: 'copy' as IconName, label: translate({ key: 'workspaces.studio.copyHtml' }), onClick: () => { void navigator.clipboard.writeText(html); } },
        //? #170 — download the card as a social-sized PNG (client-side raster; falls back to Copy HTML on taint).
        { icon: 'crop' as IconName, label: translate({ key: 'workspaces.studio.downloadPng' }), onClick: () => { downloadHtmlAsPng(html, () => { notify.error({ key: 'workspaces.studio.pngFailed' }); }); } },
      ]
      : []),
    //? Regenerate shares the generate mutual-exclusion: inert while any generation is busy.
    { icon: 'arrows-rotate', label: regenerateLabel, onClick: () => { if (!busy) onRegenerate(); } },
    { divider: true },
    { icon: 'trash', label: translate({ key: 'workspaces.studio.deleteArtifact' }), danger: true, onClick: onDelete },
  ];
  //? Each promoted action writes somewhere OTHER than this card, and the label alone never says where.
  //? Only the actions this card actually offers are explained.
  const actionPoints: InfoTipPoint[] = [
    ...(onPromote ? [{ id: 'brand', label: translate({ key: 'workspaces.studio.useAsBrand' }), desc: translate({ key: 'workspaces.tips.studio.actionsBrandDesc' }) }] : []),
    ...(onSendToContent ? [{ id: 'content', label: translate({ key: 'workspaces.studio.sendToContent' }), desc: translate({ key: 'workspaces.tips.studio.actionsContentDesc' }), onGo: () => { navigate('content'); } }] : []),
    ...(onPublishLive ? [{ id: 'publish', label: translate({ key: 'workspaces.studio.publishLive' }), desc: translate({ key: 'workspaces.tips.studio.actionsPublishDesc' }) }] : []),
  ];
  return (
    <div className={`rounded-2xl border border-container1-border bg-container1 overflow-hidden`}>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 border-b border-divider`}>
        <Icon name={KINDS.find((k) => k.kind === artifact.kind)?.icon ?? 'file-lines'} className={`text-primary`} />
        <div className={`text-sm font-medium text-title flex-1 min-w-0 truncate`}>{artifact.title}</div>
        {/* #168 — a 'generating' artifact shows an in-progress spinner until the detached completion flips it. */}
        {artifact.status === 'generating' && <span className={`text-xs text-muted flex items-center gap-1.5`}><Icon name="spinner" className={`animate-spin`} />{translate({ key: 'workspaces.studio.generating' })}</span>}
        {artifact.status === 'error' && <span className={`text-xs text-wrong`}>{translate({ key: 'workspaces.studio.failed' })}</span>}
        {onPromote && <button type="button" onClick={onPromote} className={`text-xs text-primary hover:text-primary-hover cursor-pointer flex items-center gap-1`} title={translate({ key: 'workspaces.studio.useAsBrandHint' })}><Icon name="book-open" className={`text-xs`} />{translate({ key: 'workspaces.studio.useAsBrand' })}</button>}
        {onSendToContent && <button type="button" onClick={onSendToContent} className={`text-xs text-primary hover:text-primary-hover cursor-pointer flex items-center gap-1`} title={translate({ key: 'workspaces.studio.sendToContentHint' })}><Icon name="paper-plane" className={`text-xs`} />{translate({ key: 'workspaces.studio.sendToContent' })}</button>}
        {/* G3 — one click from "generated page" to a real public URL (re-publish updates the same URL). */}
        {onPublishLive && <button type="button" onClick={onPublishLive} className={`text-xs text-primary hover:text-primary-hover cursor-pointer flex items-center gap-1`} title={translate({ key: 'workspaces.studio.publishLiveHint' })}><Icon name="up-right-from-square" className={`text-xs`} />{translate({ key: 'workspaces.studio.publishLive' })}</button>}
        {actionPoints.length > 0 && (
          <InfoTip
            align="end"
            label={translate({ key: 'workspaces.tips.studio.actionsLabel' })}
            title={translate({ key: 'workspaces.tips.studio.actionsTitle' })}
            body={translate({ key: 'workspaces.tips.studio.actionsBody' })}
            points={actionPoints}
          />
        )}
        <PopMenu ariaLabel={translate({ key: 'workspaces.studio.artifactActions' })} items={menu} />
      </div>
      <div className={`p-4`}>
        {artifact.status === 'generating' && <div className={`text-sm text-muted flex items-center gap-2`}><Icon name="spinner" className={`animate-spin`} />{translate({ key: 'workspaces.studio.generating' })}</div>}
        {artifact.status === 'error' && <div className={`text-sm text-muted`}>{artifact.error ?? translate({ key: 'workspaces.studio.failed' })}</div>}
        {artifact.status === 'ready' && <ArtifactBody kind={artifact.kind} c={c} />}
      </div>
      {/* demoted metadata: one line; provider is real content (provenance), so it stays always-visible
          text rather than a hover-only title — touch/screen-reader users need it too (text-meta token). */}
      <div className={`px-4 py-2 border-t border-divider text-[11px] text-meta flex items-center gap-2`}>
        <span>{translate({ key: `workspaces.studio.kind.${artifact.kind}` })}</span>
        {artifact.providerId && <span>· {artifact.providerId}</span>}
        {usedRefine && <span className={`truncate max-w-[10rem]`} title={usedRefine}>· {translate({ key: 'workspaces.studio.refinedWith', params: [{ key: 'refine', value: usedRefine }] })}</span>}
        <span className={`ml-auto`}>{when}</span>
      </div>
    </div>
  );
}
