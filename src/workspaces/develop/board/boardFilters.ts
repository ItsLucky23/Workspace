import type { TicketStatus } from '../../_data/types';

//? Filters applied client-side on top of the live snapshot (no control-API op — purely a view
//? concern, nothing is persisted). Own file so BoardHeader.tsx only exports components
//? (react-refresh rule) while page.tsx shares the type + default set.
export interface BoardFilters { status: TicketStatus | 'all'; assigneeId: string; sprintId: string }
export const ALL_FILTERS: BoardFilters = { status: 'all', assigneeId: 'all', sprintId: 'all' };
