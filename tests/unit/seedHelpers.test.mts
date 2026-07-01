//? Unit tests for the pure seed helpers ticketCreator / ticketAssignee /
//? ticketLinkedMembers (src/workspaces/_data/seed.ts). No DB — hand-built Ticket
//? objects. Run: `npx tsx tests/unit/seedHelpers.test.mts`.

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
    viewers: [],
    hasTerminal: false,
    ...over,
  };
}

// ---- ticketCreator ----

// creator falls back to viewers[0] when no explicit creatorId
eq(ticketCreator(makeTicket({ viewers: ['sanne', 'tom'] })), 'sanne', 'creator = viewers[0] when no creatorId');

// creator falls back to 'mathijs' when there are no viewers either
eq(ticketCreator(makeTicket({ viewers: [] })), 'mathijs', "creator = 'mathijs' when no creatorId and no viewers");

// explicit creatorId overrides the viewer fallback
eq(ticketCreator(makeTicket({ creatorId: 'daan', viewers: ['sanne', 'tom'] })), 'daan', 'explicit creatorId overrides viewers[0]');

// ---- ticketAssignee ----

// assignee is the next viewer after the creator
eq(ticketAssignee(makeTicket({ viewers: ['sanne', 'tom'] })), 'tom', 'assignee = next viewer after creator');

// only one viewer → no next viewer → undefined
eq(ticketAssignee(makeTicket({ viewers: ['sanne'] })), undefined, 'assignee = undefined when only the creator views');

// no viewers → undefined (creator falls back to mathijs, no viewer to pick)
eq(ticketAssignee(makeTicket({ viewers: [] })), undefined, 'assignee = undefined when there are no viewers');

// explicit assigneeId overrides the viewer fallback
eq(ticketAssignee(makeTicket({ assigneeId: 'lina', viewers: ['sanne', 'tom'] })), 'lina', 'explicit assigneeId overrides next-viewer');

// explicit creator not in viewers → assignee is the first viewer (none equals the creator)
eq(ticketAssignee(makeTicket({ creatorId: 'daan', viewers: ['sanne', 'tom'] })), 'sanne', 'assignee skips no one when creator is outside viewers');

// ---- ticketLinkedMembers ----

// returns real Member objects for creator + assignee, in order
const two = ticketLinkedMembers(makeTicket({ viewers: ['sanne', 'tom'] }));
eq(two.length, 2, 'linkedMembers returns two members for a creator + distinct assignee');
eq(two[0], MEMBERS.sanne, 'linkedMembers[0] is the creator Member object');
eq(two[1], MEMBERS.tom, 'linkedMembers[1] is the assignee Member object');
assert(two[0].name === 'Sanne' && two[1].name === 'Tom', 'linkedMembers carry the full Member shape (name)');

// dedupes when creator and assignee resolve to the same id
const deduped = ticketLinkedMembers(makeTicket({ creatorId: 'sanne', assigneeId: 'sanne', viewers: ['sanne', 'tom'] }));
eq(deduped.length, 1, 'linkedMembers dedupes when creator === assignee');
eq(deduped[0], MEMBERS.sanne, 'linkedMembers deduped entry is the shared Member');

// single viewer → only the creator, no assignee
const solo = ticketLinkedMembers(makeTicket({ viewers: ['lina'] }));
eq(solo.length, 1, 'linkedMembers returns only the creator when there is no assignee');
eq(solo[0], MEMBERS.lina, 'linkedMembers solo entry is the creator Member');

// no viewers, no explicit ids → creator falls back to mathijs, no assignee
const fallback = ticketLinkedMembers(makeTicket({ viewers: [] }));
eq(fallback.length, 1, 'linkedMembers has just the fallback creator when nothing is set');
eq(fallback[0], MEMBERS.mathijs, "linkedMembers fallback entry is 'mathijs'");

report('tests/unit/seedHelpers.test.mts');
