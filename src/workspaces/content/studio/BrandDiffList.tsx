//? Renders the before/after rows built by brandDiff.ts inside the "Use as brand" menuHandler.confirm
//? (owner decision 6). Shared between /studio and /marketing — same reasoning as promptStack.tsx: the
//? rows themselves are correctness-critical (must track server/studioBrand_v1.ts's promote branch), so
//? only the confirm's surrounding copy is left to each page, not this list.

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import type { BrandDiffRow } from './brandDiff';

export function BrandDiffList({ rows }: { rows: BrandDiffRow[] }) {
  const translate = useTranslator();
  const changed = rows.filter((r) => r.changed);
  const unset = translate({ key: 'workspaces.studio.brandDiffUnset' });

  if (changed.length === 0) return <p className={`text-xs text-meta`}>{translate({ key: 'workspaces.studio.brandDiffNoChanges' })}</p>;

  return (
    <div className={`flex flex-col divide-y divide-divider rounded-lg border border-container1-border overflow-hidden`}>
      {changed.map((r) => (
        <div key={r.field} className={`flex flex-col gap-0.5 px-3 py-2 text-xs`}>
          <span className={`font-medium text-title`}>{translate({ key: `workspaces.studio.${r.field}` })}</span>
          <span className={`text-meta truncate line-through opacity-70`}>{r.before || unset}</span>
          <span className={`text-common truncate flex items-center gap-1`}><Icon name="arrow-right" className={`text-[10px] text-meta`} />{r.after || unset}</span>
        </div>
      ))}
    </div>
  );
}
