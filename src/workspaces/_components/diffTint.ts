//? Workspaces — the one set of inline-diff row/text tints + gutter signs, shared by the ticket
//? DiffView and the MR review panel so the two renderers can never drift apart.

import type { DiffLine } from '../_data/types';

export const DIFF_ROW_TINT: Record<DiffLine['kind'], string> = { add: 'bg-correct/10', del: 'bg-wrong/10', ctx: '', hunk: 'bg-container2' };
export const DIFF_TEXT_TINT: Record<DiffLine['kind'], string> = { add: 'text-correct', del: 'text-wrong', ctx: 'text-common', hunk: 'text-muted' };
export const DIFF_SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '-', ctx: ' ', hunk: '' };
