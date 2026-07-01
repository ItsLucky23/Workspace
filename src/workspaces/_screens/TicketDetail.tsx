//? Workspaces — ticket detail. Header (id/issue/status/branch/MR/cost/preview +
//? status dropdown + viewers), needs-input / done banners, and the tabbed body
//? (Overview · Terminal · Files & refs · Activity · Links · Stage history).
//? Desktop-first; dummy data. Overlays (promote preview, teardown, reference
//? picker) run through the shared `menuHandler.confirm`.

import { useState } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

import FileDiffViewer from '../_components/FileDiffViewer';
import Icon from '../_components/Icon';
import XtermTerminal from '../_components/XtermTerminal';
import { AvatarStack, EmptyState, LabelChip, StatusPill, Tabs, WsButton, type TabDef } from '../_components/primitives';
import { EVENTS, MEMBERS, STAGES, TERMINALS, TICKETS, ticketLinkedMembers } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { ActivityEvent, StageHistoryEntry, Ticket, TicketFile, TicketLink } from '../_data/types';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'file-lines' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'files', label: 'Files & refs', icon: 'diagram-project' },
  { id: 'activity', label: 'Activity', icon: 'wave-square' },
  { id: 'links', label: 'Links', icon: 'link' },
  { id: 'history', label: 'Stage history', icon: 'list-check' },
];

export default function TicketDetail({ id }: { id: string }) {
  const ctx = useWorkspaces();
  const ticket = TICKETS.find((t) => t.id === id);
  const [tab, setTab] = useState('overview');

  if (!ticket) return <EmptyState icon="circle-question" title={`${id} not found`} />;

  //? Status is AI-owned — the user can't change it (it'd be wrong to flip
  //? "needs input" to "busy"). Shown read-only; the user's lever is replying.
  const status = ticket.status;
  const stage = STAGES.find((s) => s.id === ticket.stageId);
  const nextStage = STAGES.find((s) => s.order === (stage?.order ?? -1) + 1);

  return (
    <div className="flex flex-col h-full min-h-0">
      <TicketHeader ticket={ticket} />

      {status === 'needs-input' && ticket.needsInput && <NeedsInputBanner question={ticket.needsInput} />}
      {status === 'done' && (
        <Banner
          tone="correct" icon="circle-check"
          title={`Done in ${stage?.name ?? 'this stage'}`}
          action={nextStage && (
            <WsButton onClick={() => void menuHandler.confirm({ title: `Promote ${ticket.id} to ${nextStage.name}?`, content: ticket.carryOver ?? 'The structured carry-over from this stage will be injected as the next stage’s start prompt.' })}>
              Promote to {nextStage.name}
            </WsButton>
          )}
        />
      )}

      <div className="px-4 md:px-6">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        <div className={`mx-auto w-full ${tab === 'files' || tab === 'terminal' ? 'max-w-5xl' : 'max-w-3xl'}`}>
          {tab === 'overview' && <OverviewTab ticket={ticket} stage={stage?.name} />}
          {tab === 'terminal' && <TerminalTab ticketId={ticket.id} />}
          {tab === 'files' && <FilesTab files={ticket.files ?? []} />}
          {tab === 'activity' && <ActivityTab events={EVENTS.filter((e) => e.ticketId === ticket.id)} />}
          {tab === 'links' && <LinksTab links={ticket.links ?? []} onOpen={ctx.openTicket} />}
          {tab === 'history' && <HistoryTab history={ticket.history ?? []} />}
        </div>
      </div>
    </div>
  );
}

function TicketHeader({ ticket }: { ticket: Ticket }) {
  const ctx = useWorkspaces();
  const linked = ticketLinkedMembers(ticket);
  return (
    <div className="px-4 md:px-6 pt-4 md:pt-5 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm text-muted">
            <span className="font-mono">{ticket.id}</span>
            {ticket.issue && <span>· {ticket.issue}</span>}
            {ticket.status !== 'idle' && <StatusPill status={ticket.status} />}
          </div>
          <h1 className="text-xl md:text-2xl font-semibold text-title mt-1.5 leading-snug">{ticket.title}</h1>
        </div>
        {linked.length > 0 && <div className="shrink-0 pt-1" title="Creator · assignee"><AvatarStack users={linked} size={26} /></div>}
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-3">
        {ticket.branch && <MetaChip icon="diagram-project" text={ticket.branch} />}
        {ticket.mr && ticket.mr !== '—' && <MetaChip icon="code-merge" text={ticket.mr} />}
        {ticket.costLabel && <MetaChip icon="chart-column" text={ticket.costLabel} />}
        <MetaChip icon="up-right-from-square" text="Preview · live" tone="correct" />
        <div className="flex-1" />
        <WsButton variant="secondary" icon="terminal" onClick={() => { ctx.navigate('terminals'); }}>Open terminal</WsButton>
        <WsButton variant="secondary" icon="up-right-from-square">GitLab</WsButton>
      </div>

      {ticket.labels.length > 0 && <div className="flex flex-wrap gap-1 mt-3">{ticket.labels.map((l) => <LabelChip key={l} name={l} />)}</div>}
    </div>
  );
}

function MetaChip({ icon, text, tone }: { icon: Parameters<typeof Icon>[0]['name']; text: string; tone?: 'correct' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg bg-container2 px-2 h-7 text-xs font-medium ${tone === 'correct' ? 'text-correct' : 'text-common'}`}>
      <Icon name={icon} /> {text}
    </span>
  );
}

function Banner({ tone, icon, title, action, children }: { tone: 'warning' | 'correct'; icon: Parameters<typeof Icon>[0]['name']; title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  const ring = tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-correct/40 bg-correct/10';
  const fg = tone === 'warning' ? 'text-warning' : 'text-correct';
  return (
    <div className={`mx-4 md:mx-6 mb-2 rounded-xl border ${ring} p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon name={icon} className={`${fg} mt-0.5`} />
          <div>
            <div className="text-sm font-semibold text-title">{title}</div>
            {children}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}

function NeedsInputBanner({ question }: { question: string }) {
  const [reply, setReply] = useState('');
  return (
    <Banner tone="warning" icon="circle-question" title="Agent needs your input">
      <p className="text-sm text-common mt-0.5">{question}</p>
      <div className="flex items-center gap-2 mt-2">
        <input
          value={reply} onChange={(e) => { setReply(e.target.value); }}
          placeholder="Type your answer…"
          className="flex-1 h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
        />
        <WsButton onClick={() => { setReply(''); }}>Send</WsButton>
      </div>
    </Banner>
  );
}

function OverviewTab({ ticket, stage }: { ticket: Ticket; stage?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Description">
        <p className="text-sm text-common leading-relaxed">{ticket.description ?? 'No description yet.'}</p>
      </Card>
      {ticket.carryOver && (
        <Card title="Carry-over from previous stage">
          <p className="text-sm text-common leading-relaxed">{ticket.carryOver}</p>
        </Card>
      )}
      <Card title="Stage config">
        <div className="flex items-center gap-2 text-sm text-common">
          <Icon name="diagram-project" className="text-muted" />
          <span className="text-title font-medium">{stage ?? '—'}</span>
          <span className="text-muted">· AI-driven · RAG, graphify, symbol-index</span>
        </div>
      </Card>
      <div className="flex items-center gap-2">
        <WsButton
          variant="danger" icon="box-archive"
          onClick={() => void menuHandler.confirm({ title: `Teardown ${ticket.id}'s container?`, content: 'The container + worktree are removed. The branch and event log persist — you can reactivate later.', input: ticket.id })}
        >
          Teardown container
        </WsButton>
      </div>
    </div>
  );
}

function TerminalTab({ ticketId }: { ticketId: string }) {
  const ctx = useWorkspaces();
  const terminal = TERMINALS.find((t) => t.ticketId === ticketId);
  const [active, setActive] = useState(0);
  if (!terminal) {
    return <EmptyState icon="terminal" title="No terminal running" sub="This ticket has no active container. Reactivate it to attach a terminal." />;
  }
  const proc = terminal.processes[active] ?? terminal.processes[0];
  return (
    <div className="rounded-xl overflow-hidden border border-container1-border">
      <div className="flex items-center justify-between gap-2 bg-terminal-surface px-3 h-10 text-terminal-text">
        <div className="flex items-center gap-1">
          {terminal.processes.map((p, i) => (
            <button key={p.name} type="button" onClick={() => { setActive(i); }}
              className={`rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors ${i === active ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}>
              {p.name}
            </button>
          ))}
          <span className="text-terminal-muted text-xs ml-1">· {proc.cwd}</span>
        </div>
        <button type="button" onClick={() => { ctx.navigate('terminals'); }} className="text-xs text-terminal-muted hover:text-terminal-text cursor-pointer inline-flex items-center gap-1">
          <Icon name="up-right-from-square" /> Open in Terminals
        </button>
      </div>
      <XtermTerminal key={`${ticketId}:${proc.name}`} sessionId={`${ticketId}:${proc.name}`} className="h-80" />
    </div>
  );
}

function FilesTab({ files }: { files: TicketFile[] }) {
  if (files.length === 0) return <EmptyState icon="diagram-project" title="No file changes yet" sub="Changed files appear here as the agent edits the worktree." />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">{files.length} changed files</span>
        <WsButton variant="secondary" icon="link">Add reference…</WsButton>
      </div>
      <FileDiffViewer files={files} />
    </div>
  );
}

const ACTOR_GLYPH = (actor: string) => (actor === 'ai' ? '🤖' : (actor === 'mr' ? '🔀' : (MEMBERS[actor]?.name[0] ?? '·')));
const EVENT_TINT: Record<ActivityEvent['type'], string> = {
  command: 'bg-container2 text-common',
  'file-change': 'bg-primary/12 text-primary',
  'ai-message': 'bg-primary/12 text-primary',
  'status-change': 'bg-warning/15 text-warning',
  mr: 'bg-correct/15 text-correct',
  comment: 'bg-container2 text-muted',
};

function ActivityTab({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return <EmptyState icon="wave-square" title="No activity yet" />;
  return (
    <div className="flex flex-col gap-2">
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-container2/50 transition-colors">
          <span className="w-6 h-6 rounded-full bg-container2 text-xs flex items-center justify-center shrink-0">{ACTOR_GLYPH(e.actor)}</span>
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${EVENT_TINT[e.type]}`}>{e.type}</span>
          <span className="text-sm text-common flex-1 min-w-0 truncate">{e.text}</span>
          <span className="text-xs text-muted font-mono shrink-0">{e.time}</span>
        </div>
      ))}
    </div>
  );
}

function WhyPopover({ reason }: { reason: string }) {
  return (
    <span className="relative group/why inline-flex">
      <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center cursor-help">?</span>
      <span className="pointer-events-none absolute right-0 top-6 z-30 w-64 rounded-xl border border-container1-border bg-container1 p-3 text-xs text-common shadow-lg opacity-0 translate-y-1 group-hover/why:opacity-100 group-hover/why:translate-y-0 transition-all duration-150">
        <span className="font-semibold text-title block mb-1">Why this link?</span>
        {reason}
      </span>
    </span>
  );
}

function LinksTab({ links, onOpen }: { links: TicketLink[]; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">Related tickets</span>
        <WsButton variant="secondary" icon="link">Link ticket…</WsButton>
      </div>
      {links.length === 0
        ? <EmptyState icon="link" title="No links yet" sub="Relate, block, or dedupe against other tickets." />
        : (
          <Card>
            <div className="flex flex-col divide-y divide-divider">
              {links.map((l) => (
                <div key={l.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <button type="button" onClick={() => { onOpen(l.id); }} className="font-mono text-sm text-primary hover:underline cursor-pointer">{l.id}</button>
                  <span className="text-sm text-muted">{l.rel}</span>
                  {l.ai && (
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px] font-medium"><Icon name="robot" /> AI-suggested</span>
                      {l.reason && <WhyPopover reason={l.reason} />}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
    </div>
  );
}

function HistoryTab({ history }: { history: StageHistoryEntry[] }) {
  if (history.length === 0) return <EmptyState icon="list-check" title="No stage history yet" />;
  return (
    <div className="flex flex-col">
      {history.map((h, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${h.done ? 'bg-correct/15 text-correct' : 'bg-primary/12 text-primary'}`}>
              <Icon name={h.done ? 'circle-check' : 'clock'} />
            </span>
            {i < history.length - 1 && <span className="w-px flex-1 bg-divider my-1" />}
          </div>
          <div className="pb-5">
            <div className="text-sm font-semibold text-title">{h.stage}</div>
            <div className="text-sm text-common mt-0.5">{h.summary}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      {title && <div className="text-sm font-semibold text-title mb-2">{title}</div>}
      {children}
    </section>
  );
}
