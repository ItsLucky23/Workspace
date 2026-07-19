//? Workspaces — zero-workspace onboarding. Rendered by WorkspacesShell when the
//? signed-in user belongs to no workspace: create one, or accept a pending email
//? invitation. Both go through existing control-ops (create-workspace / accept-invite)
//? — no new verbs. Replaces the old demo-seed-on-first-login path.

import { useEffect, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { ModulePicker } from '../_components/ModulePicker';
import { WsButton } from '../_components/primitives';
import { WORKSPACE_MODULES, sectionsForModules, type WorkspaceModuleId } from '../_data/modules';
import { WORKSPACE_PACK_CHOICES } from '../_data/packs';
import { useWorkspaces } from './WorkspacesContext';

export function Onboarding() {
  const translate = useTranslator();
  const { createWorkspace, myInvites, acceptInvite } = useWorkspaces();
  const [name, setName] = useState('');
  //? Default to all modules on (= the full experience, backward-compatible); the user
  //? deselects the lanes they don't want. At least one module is required.
  const [modules, setModules] = useState<WorkspaceModuleId[]>(WORKSPACE_MODULES.map((m) => m.id));
  //? #19 — the FIRST screen a new user ever sees is exactly where "what is this for?" belongs. Packs were
  //? initially only added to the in-app create form, which is the one place the question matters least:
  //? by then you already know what the product does.
  const [pack, setPack] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const toggleModule = (id: WorkspaceModuleId) => { setModules((cur) => (cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id])); };
  const choosePack = (packId: string): void => {
    setPack(packId);
    const chosen = WORKSPACE_PACK_CHOICES.find((p) => p.id === packId);
    if (chosen) setModules(chosen.modules);
  };
  const submit = () => {
    const n = name.trim();
    if (!n || modules.length === 0) return;
    const chosen = WORKSPACE_PACK_CHOICES.find((p) => p.id === pack);
    createWorkspace(n, sectionsForModules(modules), chosen?.preset, pack || undefined);
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-title flex items-start md:items-center justify-center p-4">
      <div className="w-full max-w-md flex flex-col gap-6 py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="w-12 h-12 rounded-2xl bg-primary text-title-primary flex items-center justify-center text-xl font-bold">{translate({ key: 'workspaces.shell.brandInitial' })}</span>
          <div className="text-2xl font-semibold text-title">{translate({ key: 'workspaces.onboarding.welcome' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.onboarding.subtitle' })}</div>
        </div>

        <div className="rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.onboarding.createHeading' })}</div>
          <input
            ref={inputRef}
            value={name} onChange={(e) => { setName(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={translate({ key: 'workspaces.shell.workspaceNamePlaceholder' })}
            className="h-10 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          {/* #19 — one question instead of four checkboxes: what is this workspace for? Answering it seeds
              real starting content, so the first screen after this is never blank. The module checkboxes
              stay available underneath for anyone who wants them. */}
          <div className="text-xs font-medium text-muted mt-1">{translate({ key: 'workspaces.packs.heading' })}</div>
          <div className="grid grid-cols-2 gap-2">
            {WORKSPACE_PACK_CHOICES.map((p) => (
              <button key={p.id} type="button" onClick={() => { choosePack(p.id); }}
                className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left cursor-pointer transition-colors ${pack === p.id ? 'border-primary-border bg-primary/10' : 'border-container1-border bg-container2/50 hover:bg-container2'}`}>
                <Icon name={p.icon} className={`mt-0.5 ${pack === p.id ? 'text-primary' : 'text-muted'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-title">{translate({ key: p.labelKey })}</span>
                  <span className="block text-xs text-muted">{translate({ key: p.descKey })}</span>
                </span>
              </button>
            ))}
          </div>
          {/* Modules are first-class (no "advanced" fold): a pack pre-checks them, and the
              checkboxes below let you add or drop lanes before creating. */}
          <div className="flex flex-col gap-2 mt-1">
            <div className="text-xs font-medium text-muted">{translate({ key: 'workspaces.modules.pickHeading' })}</div>
            <ModulePicker selected={modules} onToggle={toggleModule} />
          </div>
          <WsButton icon="plus" onClick={submit} disabled={name.trim().length === 0 || modules.length === 0}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
        </div>

        {myInvites.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-title px-1 flex items-center gap-2"><Icon name="envelope" className="text-muted" /> {translate({ key: 'workspaces.onboarding.invitesHeading' })}</div>
            {myInvites.map((inv) => (
              <div key={inv.token} className="rounded-xl border border-container1-border bg-container1 p-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-container2 text-sm font-bold flex items-center justify-center shrink-0">{inv.workspaceName.slice(0, 1)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-title truncate">{inv.workspaceName}</div>
                  <div className="text-xs text-muted capitalize">{inv.role}</div>
                </div>
                <WsButton variant="secondary" onClick={() => { acceptInvite(inv.token); }}>{translate({ key: 'workspaces.shell.accept' })}</WsButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
