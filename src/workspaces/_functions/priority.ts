//? Ticket-priority presentation helpers (#13). One place for the label i18n keys +
//? the theme-token dot colour per priority, so the board card, the ticket detail and
//? the create form all render a priority identically. `urgent` is the hotfix/security
//? tier (force-passes the #12 capacity cap) and gets the loudest (wrong) token.

import type { TicketPriority } from '../_data/types';
import { TICKET_PRIORITIES } from '../_data/types';

//? i18n key per priority (label shown in dropdowns + the card tooltip).
export const PRIORITY_LABEL_KEY: Record<TicketPriority, string> = {
  low: 'workspaces.priority.low',
  normal: 'workspaces.priority.normal',
  high: 'workspaces.priority.high',
  urgent: 'workspaces.priority.urgent',
};

//? Theme-token dot colour per priority (never an arbitrary hex — ai:lint enforces this).
export const PRIORITY_DOT: Record<TicketPriority, string> = {
  low: 'bg-disabled',
  normal: 'bg-muted',
  high: 'bg-warning',
  urgent: 'bg-wrong',
};

//? Priorities a card should badge — low/normal are the quiet default, so only high
//? and urgent draw a dot on the board (keeps the card uncluttered).
export const isBadgedPriority = (p: TicketPriority | undefined): p is 'high' | 'urgent' =>
  p === 'high' || p === 'urgent';

//? All priorities in display order (low → urgent) for the create/edit dropdowns.
export const PRIORITY_ORDER: readonly TicketPriority[] = TICKET_PRIORITIES;
