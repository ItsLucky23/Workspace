//? intent: Interviewer — a repo-aware AI chat: ask how this codebase works, what's worth improving,
//? or work out a plan for a new feature, and turn the AI's persisted findings into board tickets.
//? One primary action (ask a question in the composer / tap a starter); the findings list lives
//? behind a "Findings (n)" header pill and "Generate ideas" (+ its focus field) behind a small
//? header dialog, so the chat keeps the whole screen. Backend: the repo-aware `workspaces/aiChat`.

import { useEffect, useRef, useState } from 'react';

import { motion } from 'motion/react';

import { apiRequest, i18nNotify as notify, tryCatch, useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from '../../_components/Icon';
import { Collapse, Popover } from '../../_components/motion';
import { EmptyState, IconButton, InfoTip, InteractiveRow, useClickAway, WsButton } from '../../_components/primitives';
import { EmptyPicker } from '../../_components/SetupNotice';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { InterviewFinding } from '../../_data/types';

export const template = 'workspaces';

interface Msg { id: string; role: 'user' | 'ai'; text: string; pending?: boolean }
let seq = 0;

//? Finding areas → an icon + accent (for the findings view). ADR 0034.
const AREA_META: Record<string, { icon: IconName; tint: string }> = {
  reliability: { icon: 'shield-halved', tint: 'text-correct' },
  security: { icon: 'lock', tint: 'text-wrong' },
  performance: { icon: 'gauge-high', tint: 'text-warning' },
  ux: { icon: 'wand-magic-sparkles', tint: 'text-primary' },
  dx: { icon: 'code', tint: 'text-primary' },
  product: { icon: 'lightbulb', tint: 'text-warning' },
  other: { icon: 'circle-dot', tint: 'text-muted' },
};
const areaMeta = (area: string): { icon: IconName; tint: string } => AREA_META[area] ?? { icon: 'circle-dot', tint: 'text-muted' };

//? Finding severity → translation key (for the row's expanded detail). "high" already has a
//? standalone key because it also renders as a chip on the collapsed row.
const SEVERITY_KEY: Record<string, string> = {
  low: 'workspaces.interviewer.severityLow',
  normal: 'workspaces.interviewer.severityNormal',
  high: 'workspaces.interviewer.high',
};

//? Starter prompts — clickable so a first-time visitor instantly sees what this page is for.
//? The translated starter text IS the prompt that gets sent to the AI.
const STARTERS: { icon: IconName; key: string }[] = [
  { icon: 'magnifying-glass', key: 'explain' },
  { icon: 'bolt', key: 'improve' },
  { icon: 'diagram-project', key: 'plan' },
  { icon: 'shield-halved', key: 'risks' },
];

export default function Interviewer() {
  const translate = useTranslator();
  const { activeWorkspace, activeProject, interviewerChat, interviewFindings, makeTicketFromFinding, dismissFinding, runAgentRole, openTicket, navigate } = useWorkspaces();
  const [messages, setMessages] = useState<Msg[]>(() => interviewerChat.map((message) => ({ id: message.id, role: message.role, text: message.text })));
  useEffect(() => {
    if (interviewerChat.length > 0) setMessages(interviewerChat.map((message) => ({ id: message.id, role: message.role, text: message.text })));
  }, [interviewerChat]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  //? Secondary surface: 'findings' swaps the middle area for the persisted findings list (header pill).
  const [view, setView] = useState<'chat' | 'findings'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  const showFindings = view === 'findings' && interviewFindings.length > 0;

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, showFindings]);

  const ask = (text: string) => {
    const trimmed = text.trim();
    const workspaceId = activeWorkspace.id;
    if (!trimmed || !workspaceId || busy) return;
    setView('chat'); //? sending is always a chat action — bring the conversation back on screen
    const stamp = String(seq + 1); seq += 1;
    const aiId = `a${stamp}`;
    //? F-013 — the last 8 settled turns ride along (aiChat's `history`, #112) so a follow-up ("and how would I
    //? test that?") keeps its context. Mirrors the shell's sendChat; this page is a CONVERSATION and used to
    //? send every message as a fresh single turn.
    const history = messages.filter((m) => !m.pending && m.text.length > 0).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, { id: `u${stamp}`, role: 'user', text: trimmed }, { id: aiId, role: 'ai', text: '', pending: true }]);
    setDraft('');
    setBusy(true);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/aiChat', version: 'v1', data: { workspaceId, message: trimmed, surface: 'interviewer', ...(activeProject ? { projectId: activeProject.id } : {}), ...(history.length > 0 ? { history } : {}), clientRequestId: globalThis.crypto.randomUUID() } }));
      setMessages((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        if (error || res?.status !== 'success' || res.result.error) return { ...m, pending: false, text: translate({ key: 'workspaces.interviewer.error' }) };
        return { ...m, pending: false, text: res.result.reply };
      }));
      setBusy(false);
    })();
  };

  const empty = messages.length === 0;

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      {/* compact header — the page's purpose in one line; rare actions stay small on the right */}
      <div className={`px-5 md:px-6 pt-5 pb-3 border-b border-divider shrink-0`}>
        <div className={`flex items-start justify-between gap-3 flex-wrap`}>
          <div className={`min-w-0`}>
            <div className={`flex items-center gap-2 text-title`}>
              <span className={`w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center`}><Icon name="comment" /></span>
              <span className={`text-xl font-semibold`}>{translate({ key: 'workspaces.interviewer.title' })}</span>
            </div>
            <p className={`text-sm text-muted mt-1.5 max-w-2xl`}>{translate({ key: 'workspaces.interviewer.intro' })}</p>
          </div>
          <div className={`flex items-center gap-2 shrink-0`}>
            {/* findings affordance (ADR 0034) — count stays visible here; the list itself opens on demand */}
            {interviewFindings.length > 0 && (
              <button
                type="button" aria-pressed={showFindings}
                onClick={() => { setView(view === 'findings' ? 'chat' : 'findings'); }}
                className={`inline-flex items-center gap-1.5 rounded-full h-9 px-3.5 text-sm font-medium transition-colors cursor-pointer ${showFindings ? 'bg-primary/12 text-primary' : 'bg-container2 text-common hover:bg-container2-hover'}`}
              >
                <Icon name="list-check" />
                {translate({ key: 'workspaces.interviewer.findingsTitle', params: [{ key: 'n', value: String(interviewFindings.length) }] })}
              </button>
            )}
            {/* #167 — invoke the interviewer agent-role on demand; findings surface via the snapshot when ready. */}
            <GenerateIdeasMenu onGenerate={(focus) => {
              runAgentRole('interviewer', focus);
              const trimmedFocus = focus.trim();
              //? Echo the focus text back so a user who runs this twice with different focuses can tell
              //? which run they just kicked off (the toast used to be identical either way).
              if (trimmedFocus.length > 0) notify.info({ key: 'workspaces.interviewer.generateStartedFocus', params: [{ key: 'focus', value: trimmedFocus }] });
              else notify.info({ key: 'workspaces.interviewer.generateStarted' });
            }} />
          </div>
        </div>
      </div>

      {/* middle — the conversation (default), or the persisted findings list when the pill is active.
          Both panels stay mounted and crossfade via opacity (motion's global reduced-motion config
          honours prefers-reduced-motion automatically) instead of the previous hard ternary swap —
          the single most-reported motion defect in the audit. */}
      <div className={`flex-1 min-h-0 relative`}>
        <motion.div
          ref={scrollRef} aria-hidden={showFindings}
          animate={{ opacity: showFindings ? 0 : 1 }} transition={{ duration: 0.15 }}
          className={`absolute inset-0 overflow-y-auto px-5 md:px-6 py-5 ${showFindings ? 'pointer-events-none' : ''}`}
        >
          {empty ? (
            <div className={`max-w-2xl mx-auto`}>
              <EmptyState
                icon="comment"
                title={translate({ key: 'workspaces.interviewer.emptyTitle' })}
                sub={translate({ key: 'workspaces.interviewer.emptySub' })}
                action={
                  <div className={`grid sm:grid-cols-2 gap-3`}>
                    {STARTERS.map((s) => (
                      <button key={s.key} type="button" onClick={() => { ask(translate({ key: `workspaces.interviewer.starter.${s.key}` })); }}
                        className={`flex items-start gap-3 rounded-2xl border border-container1-border bg-container1 p-4 text-left hover:border-primary hover:bg-container1-hover transition-colors cursor-pointer`}>
                        <span className={`w-8 h-8 shrink-0 rounded-lg bg-primary/12 text-primary flex items-center justify-center`}><Icon name={s.icon} /></span>
                        <span className={`text-sm text-common`}>{translate({ key: `workspaces.interviewer.starter.${s.key}` })}</span>
                      </button>
                    ))}
                  </div>
                }
              />
            </div>
          ) : (
            <div className={`max-w-2xl mx-auto flex flex-col gap-4`}>
              {messages.map((m) => <Bubble key={m.id} m={m} />)}
            </div>
          )}
        </motion.div>
        <motion.div
          aria-hidden={!showFindings}
          animate={{ opacity: showFindings ? 1 : 0 }} transition={{ duration: 0.15 }}
          className={`absolute inset-0 overflow-y-auto px-5 md:px-6 py-5 ${showFindings ? '' : 'pointer-events-none'}`}
        >
          <div className={`max-w-2xl mx-auto flex flex-col gap-2.5`}>
            <div className={`mb-1`}>
              <div className={`flex items-center gap-1.5`}>
                <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.interviewer.findingsTitle', params: [{ key: 'n', value: String(interviewFindings.length) }] })}</div>
                {/* one tip for the whole list, instead of a question mark on every row */}
                <InfoTip
                  align="start"
                  label={translate({ key: 'workspaces.tips.automations.findingsLabel' })}
                  title={translate({ key: 'workspaces.tips.automations.findingsTitle' })}
                  points={[
                    { id: 'source', label: translate({ key: 'workspaces.tips.automations.findingsSource' }), desc: translate({ key: 'workspaces.tips.automations.findingsSourceDesc' }) },
                    { id: 'severity', label: translate({ key: 'workspaces.tips.automations.findingsSeverity' }), desc: translate({ key: 'workspaces.tips.automations.findingsSeverityDesc' }) },
                    { id: 'ticket', label: translate({ key: 'workspaces.tips.automations.findingsTicket' }), desc: translate({ key: 'workspaces.tips.automations.findingsTicketDesc' }) },
                  ]}
                />
              </div>
              <p className={`text-xs text-muted mt-0.5`}>{translate({ key: 'workspaces.interviewer.findingsIntro' })}</p>
            </div>
            {activeProject === null && (
              <EmptyPicker icon="diagram-project" label={translate({ key: 'workspaces.board.needsProject' })} />
            )}
            {interviewFindings.map((f) => (
              <FindingRow key={f.id} f={f} translate={translate} canMakeTicket={activeProject !== null}
                onMakeTicket={() => { makeTicketFromFinding(f.id); }}
                onOpenTicket={() => { if (f.ticketId) openTicket(f.ticketId); }}
                onDismiss={() => { dismissFinding(f.id); }} />
            ))}
          </div>
        </motion.div>
      </div>

      {/* composer — the primary action, always pinned at the bottom */}
      <div className={`shrink-0 border-t border-divider p-3 md:px-6`}>
        <div className={`max-w-2xl mx-auto flex items-end gap-2`}>
          <textarea
            value={draft} onChange={(e) => { setDraft(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
            rows={1} placeholder={translate({ key: 'workspaces.interviewer.placeholder' })}
            className={`flex-1 min-w-0 resize-none max-h-40 px-3.5 py-2.5 rounded-2xl border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30`}
          />
          <WsButton icon="paper-plane" onClick={() => { ask(draft); }} disabled={busy || draft.trim().length === 0}>{translate({ key: 'workspaces.interviewer.send' })}</WsButton>
          {/* what the answers are actually built from — and why they fail without a selected project */}
          <InfoTip
            align="end" className={`self-center`}
            label={translate({ key: 'workspaces.tips.automations.chatLabel' })}
            title={translate({ key: 'workspaces.tips.automations.chatTitle' })}
            body={translate({ key: 'workspaces.tips.automations.chatBody' })}
            points={[{ id: 'index', label: translate({ key: 'workspaces.tips.automations.chatIndexPoint' }), onGo: () => { navigate('sources'); } }]}
          />
        </div>
      </div>
    </div>
  );
}

//? "Generate ideas now" + its focus field, behind a small header dialog. This makes the focus
//? feature usable on phones (it was `hidden sm:block` before). Fire-and-forget by design: results
//? arrive asynchronously via the workspace snapshot (`interviewFindings`), so no local spinner.
function GenerateIdeasMenu({ onGenerate }: { onGenerate: (focus: string) => void }) {
  const translate = useTranslator();
  const [open, setOpen] = useState(false);
  //? Focus (gap-fix): narrows the run to one area (e.g. "the auth flow"); empty = whole project.
  const [focus, setFocus] = useState('');
  const ref = useClickAway<HTMLDivElement>(open, () => { setOpen(false); });
  return (
    <div className={`relative`} ref={ref}>
      <WsButton variant="secondary" icon="wand-magic-sparkles" title={translate({ key: 'workspaces.interviewer.generateNow' })} onClick={() => { setOpen(!open); }}>
        <span className={`hidden sm:inline`}>{translate({ key: 'workspaces.interviewer.generateNow' })}</span>
      </WsButton>
      <Popover open={open} className={`absolute right-0 top-10 z-40 w-72 rounded-xl border border-container1-border bg-container1 p-3 shadow-lg`}>
        <div className={`flex items-center gap-1.5`}>
          <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.interviewer.generateTitle' })}</div>
          <InfoTip
            align="end"
            label={translate({ key: 'workspaces.tips.automations.ideasLabel' })}
            title={translate({ key: 'workspaces.tips.automations.ideasTitle' })}
            body={translate({ key: 'workspaces.tips.automations.ideasBody' })}
          />
        </div>
        <p className={`text-xs text-muted mt-1`}>{translate({ key: 'workspaces.interviewer.generateHint' })}</p>
        <input
          value={focus} onChange={(e) => { setFocus(e.target.value); }}
          placeholder={translate({ key: 'workspaces.interviewer.focusPlaceholder' })}
          className={`mt-2.5 w-full h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary`}
        />
        <WsButton icon="wand-magic-sparkles" className={`mt-2.5 w-full`} onClick={() => { onGenerate(focus); setOpen(false); }}>
          {translate({ key: 'workspaces.interviewer.generateNow' })}
        </WsButton>
      </Popover>
    </div>
  );
}

function FindingRow({ f, translate, canMakeTicket, onMakeTicket, onOpenTicket, onDismiss }: { f: InterviewFinding; translate: ReturnType<typeof useTranslator>; canMakeTicket: boolean; onMakeTicket: () => void; onOpenTicket: () => void; onDismiss: () => void }) {
  const meta = areaMeta(f.area);
  const accepted = f.status === 'accepted';
  //? Expand-to-read-more (gap-fix): the row used to be inert besides its two action buttons, so a
  //? user had to accept/dismiss blind. Click anywhere on the row (not the actions) to reveal the
  //? full severity + when it was found; ClickableCard/InteractiveRow is the shared answer for a
  //? clickable row that also carries its own nested action buttons.
  const [expanded, setExpanded] = useState(false);
  return (
    <InteractiveRow onClick={() => { setExpanded((e) => !e); }} className={`flex flex-col`}>
      <div className={`flex items-start gap-2.5`}>
        <span className={`w-7 h-7 shrink-0 rounded-lg bg-container2 flex items-center justify-center ${meta.tint}`}><Icon name={meta.icon} className={`text-sm`} /></span>
        <div className={`min-w-0 flex-1`}>
          <div className={`flex items-center gap-1.5 flex-wrap`}>
            <span className={`text-sm font-medium text-title`}>{f.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded bg-container2 text-muted uppercase shrink-0`}>{f.area}</span>
            {f.severity === 'high' && <span className={`text-[10px] px-1.5 py-0.5 rounded bg-wrong/12 text-wrong shrink-0`}>{translate({ key: 'workspaces.interviewer.high' })}</span>}
          </div>
          {f.summary.length > 0 && <div className={`text-xs text-muted mt-0.5`}>{f.summary}</div>}
        </div>
        <Icon name="caret-down" className={`shrink-0 self-center text-muted text-xs transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
        {/* nested actions stop the click from also toggling the expand state above */}
        <div onClick={(e) => { e.stopPropagation(); }} className={`shrink-0 self-center`}>
          {accepted ? (
            <button type="button" onClick={onOpenTicket} disabled={!f.ticketId} className={`text-xs text-correct inline-flex items-center gap-1 enabled:hover:underline enabled:cursor-pointer disabled:cursor-default`}><Icon name="circle-check" />{translate({ key: 'workspaces.interviewer.linkedTicket' })}</button>
          ) : (
            <div className={`flex items-center gap-1.5`}>
              <button type="button" onClick={onMakeTicket} disabled={!canMakeTicket} title={canMakeTicket ? undefined : translate({ key: 'workspaces.board.needsProject' })} className={`text-xs text-primary hover:underline cursor-pointer inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline`}><Icon name="plus" className={`text-xs`} />{translate({ key: 'workspaces.interviewer.makeTicket' })}</button>
              <IconButton icon="xmark" size="sm" title={translate({ key: 'workspaces.interviewer.dismiss' })} onClick={onDismiss} className={`hover:text-wrong`} />
            </div>
          )}
        </div>
      </div>
      <Collapse open={expanded}>
        <div className={`pl-[2.375rem] pt-2 flex items-center gap-2 text-xs text-meta`}>
          <span>{translate({ key: SEVERITY_KEY[f.severity] ?? 'workspaces.interviewer.severityNormal' })}</span>
          <span aria-hidden="true">·</span>
          <span>{new Date(f.createdAt).toLocaleString()}</span>
        </div>
      </Collapse>
    </InteractiveRow>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <span className={`w-7 h-7 shrink-0 mr-2 rounded-lg bg-primary/12 text-primary flex items-center justify-center self-end`}><Icon name="robot" /></span>}
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${mine ? 'bg-primary text-title-primary' : 'bg-container1 border border-container1-border text-common'}`}>
        {m.pending
          ? <span className={`inline-flex gap-1 py-1`}>{[0, 1, 2].map((i) => <span key={i} className={`w-1.5 h-1.5 rounded-full bg-current opacity-40 motion-safe:animate-pulse`} style={{ animationDelay: `${String(i * 150)}ms` }} />)}</span>
          : m.text}
      </div>
    </div>
  );
}
