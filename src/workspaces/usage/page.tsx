//? Workspaces — Usage. No monetary budget/cap/alert (we run Claude via the Pro
//? Max CLI subscription, not a metered API), so this is about token volume +
//? time + who handled what. Activity chart, per-ticket breakdown (tokens +
//? time, no cost), and a per-member breakdown with counters. Dummy data.

import { useMemo } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { AvatarBubble } from '../_components/primitives';
import { SPEND_7D, USAGE_ROWS } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { Member, Ticket } from '../_data/types';

function Card({ title, desc, children, className }: { title: string; desc?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-container1-border bg-container1 p-5 ${className ?? ''}`}>
      <div className="mb-4">
        <div className="text-base font-semibold text-title">{title}</div>
        {desc && <div className="text-sm text-muted mt-0.5">{desc}</div>}
      </div>
      {children}
    </section>
  );
}

export const template = 'workspaces';

export default function Usage() {
  const { openTicket, tickets, membersById } = useWorkspaces();
  const translate = useTranslator();
  const maxDay = Math.max(...SPEND_7D.map((d) => d.cost));

  const byMember = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const handler = t.assigneeId ?? t.creatorId;
      if (!handler) continue;
      const list = map.get(handler) ?? [];
      list.push(t);
      map.set(handler, list);
    }
    return [...map.entries()]
      .map(([uid, ticketList]) => ({ member: membersById[uid], tickets: ticketList }))
      .filter((x): x is { member: Member; tickets: Ticket[] } => Boolean(x.member))
      .toSorted((a, b) => b.tickets.length - a.tickets.length);
  }, [tickets, membersById]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.usage.title' })}</h1>
        <span className="text-sm text-muted">{translate({ key: 'workspaces.usage.subtitle' })}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="flex flex-col gap-4">
          <Card title={translate({ key: 'workspaces.usage.activityTitle' })}>
            <div className="flex items-end gap-3 h-36">
              {SPEND_7D.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex items-end justify-center h-full">
                    <div className="w-full max-w-16 rounded-t-lg bg-primary/70 hover:bg-primary transition-colors" style={{ height: `${String((d.cost / maxDay) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-muted">{d.day}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <Card title={translate({ key: 'workspaces.usage.byTicketTitle' })} desc={translate({ key: 'workspaces.usage.byTicketDesc' })}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-divider">
                    <th className="py-2 font-medium">{translate({ key: 'workspaces.usage.colTicket' })}</th>
                    <th className="py-2 font-medium text-right">{translate({ key: 'workspaces.usage.colTokensIn' })}</th>
                    <th className="py-2 font-medium text-right">{translate({ key: 'workspaces.usage.colTokensOut' })}</th>
                    <th className="py-2 font-medium text-right">{translate({ key: 'workspaces.usage.colTime' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {USAGE_ROWS.map((r) => (
                    <tr key={r.ticketId} className="border-b border-divider last:border-0 hover:bg-container2/40 cursor-pointer" onClick={() => { openTicket(r.ticketId); }}>
                      <td className="py-2.5 font-mono text-xs text-primary">{r.ticketId}</td>
                      <td className="py-2.5 text-right font-mono text-xs text-muted">{r.tokensIn}</td>
                      <td className="py-2.5 text-right font-mono text-xs text-muted">{r.tokensOut}</td>
                      <td className="py-2.5 text-right text-xs text-muted">{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title={translate({ key: 'workspaces.usage.byPersonTitle' })} desc={translate({ key: 'workspaces.usage.byPersonDesc' })}>
              <div className="flex flex-col gap-2">
                {byMember.map(({ member, tickets }) => (
                  <div key={member.id} className="flex items-start gap-3 py-2 border-b border-divider last:border-0">
                    <div className="w-8 h-8 shrink-0"><AvatarBubble user={member} size={32} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-title">{member.name}</span>
                        <span className="rounded-full bg-container2 px-2 text-xs text-muted">{tickets.length} {tickets.length === 1 ? translate({ key: 'workspaces.usage.ticketSingular' }) : translate({ key: 'workspaces.usage.ticketPlural' })}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tickets.map((t) => (
                          <button key={t.id} type="button" onClick={() => { openTicket(t.id); }} className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-mono text-common hover:bg-container2-hover cursor-pointer">{t.id}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted">
            <Icon name="circle-question" /> {translate({ key: 'workspaces.usage.runawayNote' })}
          </div>
        </div>
      </div>
    </div>
  );
}
