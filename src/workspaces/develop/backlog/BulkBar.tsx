//? Workspaces — Backlog bulk-action bar. The bottom-pinned surface that appears once a
//? selection exists in select mode. At sm+ it shows the four pickers (Move / Status /
//? Assign / Sprint) + Archive inline; below sm the five collapse into ONE "Actions"
//? popover so the bar never overflows a phone screen. Archive keeps its confirm gate
//? (the handler comes in via `onArchive` — the page owns the menuHandler.confirm).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from '../../_components/Icon';
import { Popover } from '../../_components/motion';
import { FOCUS_RING, useClickAway } from '../../_components/primitives';

export interface PickerItem { label: string; onClick: () => void }
export interface BulkPicker { icon: IconName; label: string; items: PickerItem[] }

function BarBtn({ icon, label, danger, onClick }: { icon: IconName; label: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-sm cursor-pointer transition-colors whitespace-nowrap ${FOCUS_RING} ${danger ? 'text-wrong hover:bg-wrong/10' : 'text-common hover:bg-container2'}`}>
      <Icon name={icon} /> {label}
    </button>
  );
}

//? A bulk-bar button (13) that opens a click-away popover of choices instead of
//? navigating — used for the Move/Status/Assign/Sprint pickers. Opens upward
//? since the bar sits pinned to the bottom of the screen.
function BulkPickerButton({ icon, label, items }: BulkPicker) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(open, () => { setOpen(false); });
  return (
    <div className={`relative`} ref={ref}>
      <BarBtn icon={icon} label={label} onClick={() => { setOpen((o) => !o); }} />
      <Popover open={open} className={`absolute z-30 bottom-full left-0 mb-1 min-w-[180px] max-h-64 overflow-auto rounded-xl border border-container1-border bg-container1 p-1 shadow-lg`}>
        {items.map((it) => (
          <button key={it.label} type="button" onClick={() => { setOpen(false); it.onClick(); }} className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer text-left truncate`}>
            {it.label}
          </button>
        ))}
      </Popover>
    </div>
  );
}

//? Phone-width collapse: ONE "Actions" button whose upward popover lists the four
//? pickers as headed groups plus the (danger) Archive row — same handlers, one surface.
function PhoneActionsButton({ pickers, onArchive }: { pickers: BulkPicker[]; onArchive: () => void }) {
  const translate = useTranslator();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(open, () => { setOpen(false); });
  return (
    <div className={`relative`} ref={ref}>
      <BarBtn icon="ellipsis" label={translate({ key: 'workspaces.backlog.actions' })} onClick={() => { setOpen((o) => !o); }} />
      <Popover open={open} className={`absolute z-30 bottom-full right-0 mb-1 w-56 max-h-72 overflow-auto rounded-xl border border-container1-border bg-container1 p-1 shadow-lg`}>
        {pickers.map((p) => (
          <div key={p.label}>
            <div className={`px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted`}>{p.label}</div>
            {p.items.map((it) => (
              <button key={it.label} type="button" onClick={() => { setOpen(false); it.onClick(); }} className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer text-left truncate`}>
                {it.label}
              </button>
            ))}
          </div>
        ))}
        <div className={`my-1 h-px bg-divider`} />
        <button type="button" onClick={() => { setOpen(false); onArchive(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-wrong hover:bg-wrong/10 cursor-pointer text-left`}>
          <Icon name="box-archive" /> {translate({ key: 'workspaces.backlog.archive' })}
        </button>
      </Popover>
    </div>
  );
}

export function BulkActionsBar({ count, pickers, onArchive, onClear }: {
  count: number;
  pickers: BulkPicker[];
  onArchive: () => void;
  onClear: () => void;
}) {
  const translate = useTranslator();
  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-2xl border border-container1-border bg-container1 shadow-lg px-2 py-1.5 max-w-[calc(100%-1.5rem)]`}
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      <span className={`px-2 text-sm text-title whitespace-nowrap`}>{translate({ key: 'workspaces.backlog.selectedCount', params: [{ key: 'count', value: String(count) }] })}</span>
      <div className={`w-px h-5 bg-divider mx-1`} />
      <div className={`hidden sm:flex items-center gap-1`}>
        {pickers.map((p) => <BulkPickerButton key={p.label} icon={p.icon} label={p.label} items={p.items} />)}
        <BarBtn icon="box-archive" label={translate({ key: 'workspaces.backlog.archive' })} danger onClick={onArchive} />
      </div>
      <div className={`flex sm:hidden`}>
        <PhoneActionsButton pickers={pickers} onArchive={onArchive} />
      </div>
      <button type="button" onClick={onClear} aria-label={translate({ key: 'workspaces.backlog.clearSelection' })} className={`w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:bg-container2 cursor-pointer ml-1 shrink-0 ${FOCUS_RING}`}><Icon name="xmark" /></button>
    </div>
  );
}
