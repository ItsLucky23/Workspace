//? Unit tests for the pure seed helpers ticketCreator / ticketAssignee /
//? ticketLinkedMembers (src/workspaces/_data/seed.ts). No DB — hand-built Ticket
//? objects. The viewers-based fallbacks died with `Ticket.viewers` (non-functional
//? UI removal, ADR 0326): creator/assignee are now explicit ids only.
//? Run: `npx tsx tests/unit/seedHelpers.test.mts`.

import { assert, eq, report } from '../_helpers.mts';
import type { Ticket } from '../../src/workspaces/_data/types';
import {
  MEMBERS,
  ticketCreator,
  ticketAssignee,
  ticketLinkedMembers,
} from '../../src/workspaces/_data/seed';

//? Minimal Ticket factory — only the fields the helpers read matter; the rest
//? are required by the type so we fill them with inert defaults.
function makeTicket(over: Partial<Ticket>): Ticket {
  return {
    id: 'DEV-9000',
    workspaceId: 'ws-youcomm',
    projectId: 'prj-app',
    title: 'test ticket',
    stageId: 'unrefined',
    status: 'idle',
    labels: [],
    hasTerminal: false,
    ...over,
  };
}

// ---- ticketCreator ----

// explicit creatorId wins
eq(ticketCreator(makeTicket({ creatorId: 'daan' })), 'daan', 'explicit creatorId is the creator');

// no creatorId → the demo-owner fallback
eq(ticketCreator(makeTicket({})), 'mathijs', "creator = 'mathijs' when no creatorId");

// ---- ticketAssignee ----

// explicit assigneeId is the assignee
eq(ticketAssignee(makeTicket({ assigneeId: 'lina' })), 'lina', 'explicit assigneeId is the assignee');

// no assigneeId → undefined (no viewer fallback any more)
eq(ticketAssignee(makeTicket({})), undefined, 'assignee = undefined when no assigneeId');

// ---- ticketLinkedMembers ----

// returns real Member objects for creator + assignee, in order
const two = ticketLinkedMembers(makeTicket({ creatorId: 'sanne', assigneeId: 'tom' }));
eq(two.length, 2, 'linkedMembers returns two members for a creator + distinct assignee');
eq(two[0], MEMBERS.sanne, 'linkedMembers[0] is the creator Member object');
eq(two[1], MEMBERS.tom, 'linkedMembers[1] is the assignee Member object');
assert(two[0].name === 'Sanne' && two[1].name === 'Tom', 'linkedMembers carry the full Member shape (name)');

// dedupes when creator and assignee resolve to the same id
const deduped = ticketLinkedMembers(makeTicket({ creatorId: 'sanne', assigneeId: 'sanne' }));
eq(deduped.length, 1, 'linkedMembers dedupes when creator === assignee');
eq(deduped[0], MEMBERS.sanne, 'linkedMembers deduped entry is the shared Member');

// creator only, no assignee
const solo = ticketLinkedMembers(makeTicket({ creatorId: 'lina' }));
eq(solo.length, 1, 'linkedMembers returns only the creator when there is no assignee');
eq(solo[0], MEMBERS.lina, 'linkedMembers solo entry is the creator Member');

// nothing set → creator falls back to mathijs, no assignee
const fallback = ticketLinkedMembers(makeTicket({}));
eq(fallback.length, 1, 'linkedMembers has just the fallback creator when nothing is set');
eq(fallback[0], MEMBERS.mathijs, "linkedMembers fallback entry is 'mathijs'");

report('tests/unit/seedHelpers.test.mts');
