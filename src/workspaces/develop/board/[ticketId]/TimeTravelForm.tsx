//? Workspaces — the time-travel dialog form (T1/T3): pick a raw commit, "main minus
//? commit X", "as of a date", or an arbitrary git ref (#25) → a past-version preview.
//? Rendered through `menuHandler.open`, which portals ABOVE WorkspacesProvider — so
//? everything it needs (translate, onSubmit) is injected as props, never via context
//? hooks (lesson 0011).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import { WsButton } from '../../../_components/primitives';
import { INPUT_CLS_FULL as inputCls } from '../../../_components/settings';

//? #25 — the 'ref' kind previews an ARBITRARY git ref (SHA/tag/branch) via open-ref-preview;
//? commit/revert/asof go through timeTravelPreview. The page owns the op calls.
export type TravelSpec = { kind: 'commit'; value: string } | { kind: 'revert'; value: string } | { kind: 'asof'; whenMs: number } | { kind: 'ref'; value: string };
const asTravelMode = (v: string): 'commit' | 'revert' | 'asof' | 'ref' => (v === 'revert' || v === 'asof' || v === 'ref' ? v : 'commit');

export default function TimeTravelForm({ onSubmit, translate }: { onSubmit: (spec: TravelSpec) => void; translate: ReturnType<typeof useTranslator> }) {
  const [mode, setMode] = useState<'commit' | 'revert' | 'asof' | 'ref'>('commit');
  const [value, setValue] = useState('');
  const [when, setWhen] = useState('');
  const modeItems: DropdownItem[] = (['commit', 'revert', 'asof', 'ref'] as const).map((m) => ({ id: m, value: m, item: translate({ key: `workspaces.timetravel.mode_${m}` }) }));
  const valuePh = mode === 'revert' ? 'workspaces.timetravel.revertPh' : (mode === 'ref' ? 'workspaces.timetravel.refPh' : 'workspaces.timetravel.commitPh');
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.timetravel.title' })}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-common">{translate({ key: 'workspaces.timetravel.mode' })}</span>
        <Dropdown size="sm" items={modeItems} value={modeItems.find((it) => it.id === mode)} onChange={(it) => { setMode(asTravelMode(String(it.value))); }} />
      </div>
      {mode === 'asof'
        ? <input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); }} className={inputCls} />
        : <input value={value} onChange={(e) => { setValue(e.target.value); }} placeholder={translate({ key: valuePh })} className={inputCls} />}
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="clock-rotate-left" onClick={() => {
          if (mode === 'asof') { if (when) onSubmit({ kind: 'asof', whenMs: new Date(when).getTime() }); return; }
          const v = value.trim(); if (v) onSubmit({ kind: mode, value: v });
        }}>{translate({ key: 'workspaces.timetravel.preview' })}</WsButton>
      </div>
    </div>
  );
}
