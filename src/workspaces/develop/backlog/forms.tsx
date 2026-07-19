//? Workspaces — Backlog menuHandler forms (create ticket · create sprint · edit sprint).
//?
//? These render inside menuHandler overlays, which mount OUTSIDE WorkspacesProvider —
//? so every op + data slice (quickAdd/sprints/members/…) comes in as a PROP and the
//? forms never call useWorkspaces() themselves (lesson 0011: doing so crashes).

import { useEffect, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import { WsButton } from '../../_components/primitives';
import type { Member, Sprint } from '../../_data/types';

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

//? #1 — edit a sprint: activate/deactivate, rename, set/clear the start+end dates. Opened via
//? menuHandler → `sprint-edit` op. Only changed fields are sent.
export function SprintEditForm({ sprint, onSave }: { sprint: { id: string; name: string; active: boolean; start?: string | null; end?: string | null }; onSave: (input: { sprintId: string; name?: string; active?: boolean; startAt?: string; endAt?: string }) => void }) {
  const translate = useTranslator();
  const [name, setName] = useState(sprint.name);
  const [active, setActive] = useState(sprint.active);
  const [startAt, setStartAt] = useState(sprint.start ?? '');
  const [endAt, setEndAt] = useState(sprint.end ?? '');
  const submit = () => {
    if (name.trim().length === 0) return;
    onSave({ sprintId: sprint.id, name: name.trim(), active, startAt, endAt });
    void menuHandler.close();
  };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.backlog.editSprint' })}</div>
      <input value={name} onChange={(e) => { setName(e.target.value); }} className={fieldCls} />
      <div className={`grid grid-cols-2 gap-2`}>
        <label className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.backlog.sprintStart' })}</span><input type="date" value={startAt} onChange={(e) => { setStartAt(e.target.value); }} className={fieldCls} /></label>
        <label className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{translate({ key: 'workspaces.backlog.sprintEnd' })}</span><input type="date" value={endAt} onChange={(e) => { setEndAt(e.target.value); }} className={fieldCls} /></label>
      </div>
      <label className={`flex items-center gap-2 text-sm text-common cursor-pointer`}>
        <input type="checkbox" checked={active} onChange={(e) => { setActive(e.target.checked); }} className={`accent-primary`} />
        {translate({ key: 'workspaces.backlog.sprintSetActive' })}
      </label>
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="check" disabled={name.trim().length === 0} onClick={submit}>{translate({ key: 'workspaces.backlog.sprintSaveEdit' })}</WsButton>
      </div>
    </div>
  );
}

//? Minimal create-sprint menu (opened via menuHandler → `sprint-create` op). Name
//? input auto-focuses; the new sprint starts inactive (the user activates it later).
export function SprintForm({ onCreate }: { onCreate: (name: string) => void }) {
  const translate = useTranslator();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = () => { const n = name.trim(); if (!n) return; onCreate(n); void menuHandler.close(); };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.backlog.newSprint' })}</div>
      <input
        ref={inputRef}
        value={name} onChange={(e) => { setName(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.backlog.sprintNamePlaceholder' })}
        className={fieldCls}
      />
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}

//? Create-ticket menu (opened via menuHandler → `quick-add` op). Title auto-focuses;
//? the sprint picker chooses the target sprint or "Backlog" (no sprint). New tickets
//? always enter at `unrefined` (Conductor-enforced). `quickAdd` + `sprints` come in as
//? props since the menu renders outside the Workspaces provider. `initialSprintId`
//? preselects a sprint when opened from a sprint's own "add ticket" row.
export function NewBacklogTicketForm({ quickAdd, sprints, members, initialSprintId }: {
  quickAdd: (input: { title: string; sprintId?: string; description?: string; labels?: string[]; assigneeId?: string }) => void;
  sprints: Sprint[];
  members: Member[];
  initialSprintId?: string;
}) {
  const translate = useTranslator();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [sprintId, setSprintId] = useState(initialSprintId ?? 'backlog');
  const [assigneeId, setAssigneeId] = useState('unassigned');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const sprintItems: DropdownItem[] = [
    { id: 'backlog', value: 'backlog', item: translate({ key: 'workspaces.backlog.title' }) },
    ...sprints.map((s) => ({ id: s.id, value: s.id, item: s.name })),
  ];
  const assigneeItems: DropdownItem[] = [
    { id: 'unassigned', value: 'unassigned', item: translate({ key: 'workspaces.board.unassigned' }) },
    ...members.map((m) => ({ id: m.id, value: m.id, item: m.name })),
  ];
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const labels = labelsText.split(',').map((l) => l.trim()).filter((l) => l.length > 0);
    quickAdd({
      title: t,
      sprintId: sprintId === 'backlog' ? undefined : sprintId,
      ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(assigneeId === 'unassigned' ? {} : { assigneeId }),
    });
    void menuHandler.close();
  };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.backlog.newTicket' })}</div>
      <input
        ref={inputRef}
        value={title} onChange={(e) => { setTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.backlog.ticketTitlePlaceholder' })}
        className={fieldCls}
      />
      <textarea
        value={description} onChange={(e) => { setDescription(e.target.value); }}
        placeholder={translate({ key: 'workspaces.ticket.addDescriptionPlaceholder' })}
        rows={3}
        className={`resize-y px-3 py-2 rounded-lg border border-container1-border bg-container2/50 text-sm text-common focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30`}
      />
      <div className={`flex gap-2`}>
        <Dropdown size="md" value={sprintItems.find((s) => s.id === sprintId)} items={sprintItems} onChange={(it) => { setSprintId(String(it.id)); }} />
        <Dropdown size="md" value={assigneeItems.find((a) => a.id === assigneeId)} items={assigneeItems} onChange={(it) => { setAssigneeId(String(it.id)); }} />
      </div>
      <input
        value={labelsText} onChange={(e) => { setLabelsText(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.backlog.labelsPlaceholder' })}
        className={fieldCls}
      />
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}
