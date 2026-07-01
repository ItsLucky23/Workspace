//? Workspaces — ticket detail (`/workspaces/board/:ticketId`). The framework
//? lowercases route patterns, so the `[ticketId]` folder yields the `ticketid`
//? param. The ticket id value itself (e.g. `DEV-1240`) is preserved as-is.

import TicketDetail from '../../_screens/TicketDetail';

export const template = 'workspaces';

export default function TicketPage({ params }: { params: Record<string, string | undefined> }) {
  return <TicketDetail id={params.ticketid ?? ''} />;
}
