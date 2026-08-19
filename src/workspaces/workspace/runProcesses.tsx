//? ADR 0317 — the runtime as a LIST of processes instead of one command string.
//?
//? "Starting the app" was a single text input, and a real app is rarely one command: a frontend AND a
//? backend, often a worker, sometimes an ssh tunnel to a database. One field forces all of that onto
//? one shell line, which starts fine and then gives you one merged output stream where you cannot see
//? which half died — and no way to restart just the one that did.
//?
//? Each row starts in the ticket's container and gets its OWN terminal tab there. Exactly one row is
//? the preview: its port is probed and it gets the preview URL. The others simply run, which is what
//? a backend on its own port or a tunnel with no port needs.
//?
//? One command per row on purpose. The stored shape (`commands: string[]`, shared with a pipeline
//? stage) can hold a chain, but a row that runs three commands is a row whose terminal tab cannot be
//? named after what it does — and naming them is the entire point.
//? @adr 0317

/* eslint-disable react-refresh/only-export-components -- the two seed/read helpers belong to this editor's shape and are used by the one call site that renders it; splitting them into a third file to satisfy a dev-only fast-refresh rule buys nothing. Not a route component. */
import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { FOCUS_RING, IconButton, WsButton } from '../_components/primitives';
import { RepoScriptPicker, type RepoIntrospection, type RepoScript } from './repoIntrospection';
import type { StageProcessCfg } from '../_data/types';

const inputCls = 'h-9 w-full px-3 rounded-lg border border-container1-border bg-container2/50 text-sm font-mono text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
const nameCls = 'h-9 w-full px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
//? Overrides the base border/ring rather than sitting next to it, so the field reads as wrong even
//? while it has focus — which is exactly when someone is looking at it.
const errorRing = '!border-wrong focus:!border-wrong focus:!ring-wrong/30';

/** The single command a row runs — the model allows a chain, the editor deliberately does not. */
export function rowCommand(proc: StageProcessCfg): string {
  return proc.commands.find((c) => c.trim().length > 0) ?? '';
}

/** A row only becomes real once it has BOTH halves: a command to run and a name to call its terminal
 *  tab. Half a row is a draft, and a draft must not be saved — the Conductor would drop it, the
 *  snapshot echo would then delete it out from under the person still typing it. */
export function rowIncomplete(proc: StageProcessCfg): { name: boolean; command: boolean } {
  return { name: proc.name.trim().length === 0, command: rowCommand(proc).trim().length === 0 };
}

export function anyRowIncomplete(processes: StageProcessCfg[]): boolean {
  return processes.some((p) => { const m = rowIncomplete(p); return m.name || m.command; });
}

/** Seed the editor from what the project actually has: its list, else its legacy single command. */
export function seedProcesses(runProcesses: StageProcessCfg[] | undefined, devCommand: string): StageProcessCfg[] {
  if (runProcesses !== undefined && runProcesses.length > 0) return runProcesses;
  return [{ id: 'dev', name: 'dev', cwd: '', env: [], commands: [devCommand] }];
}

function newRow(index: number): StageProcessCfg {
  return { id: `p${String(index)}-${String(Date.now())}`, name: '', cwd: '', env: [], commands: [''] };
}

export function RunProcessList({ processes, previewId, onChange, scripts, packageManager }: {
  processes: StageProcessCfg[];
  previewId: string;
  onChange: (next: StageProcessCfg[], previewId: string) => void;
  scripts: RepoScript[];
  packageManager: RepoIntrospection['packageManager'];
}) {
  const translate = useTranslator();
  //? The script picker belongs to ONE row at a time: rendering a chip row under every command turns a
  //? three-process runtime into three stacked pickers, and the chips then read as unrelated to the
  //? input above them.
  const [openPicker, setOpenPicker] = useState('');

  const patch = (id: string, next: Partial<StageProcessCfg>): void => {
    onChange(processes.map((p) => (p.id === id ? { ...p, ...next } : p)), previewId);
  };
  const add = (): void => {
    const row = newRow(processes.length);
    //? A first row is automatically the preview — there is nothing else it could be.
    onChange([...processes, row], processes.length === 0 ? row.id : previewId);
  };
  const remove = (id: string): void => {
    const next = processes.filter((p) => p.id !== id);
    //? Removing the preview row must hand the URL to something that exists, or the preview would
    //? silently proxy nothing and read as a broken dev server.
    onChange(next, previewId === id ? (next[0]?.id ?? '') : previewId);
  };

  return (
    //? A radiogroup, because exactly one process owns the preview URL: a set of toggles would let a
    //? user express "none" or "both", neither of which is a thing the preview can be.
    <div className={`flex flex-col gap-2.5`} role="radiogroup" aria-label={translate({ key: 'workspaces.runtime.isPreview' })}>
      {processes.map((proc) => {
        const isPreview = proc.id === previewId;
        //? Marked the moment a half is missing, including on a freshly added row — the red IS the
        //? instruction ("these two are required"), and hiding it until some notion of "touched" would
        //? mean the row silently refuses to save while looking finished.
        const missing = rowIncomplete(proc);
        return (
          //? Every row keeps the SAME neutral frame. Tinting the preview row read as "this is the row
          //? you have selected" — the owner said so — when what it means is "this one publishes a URL".
          //? A state that is about one attribute of the row belongs on a chip inside it, not on its border.
          <div key={proc.id} className={`rounded-xl border border-container1-border bg-container2/30 px-3 py-2.5 flex flex-col gap-2`}>
            <div className={`flex items-center gap-2`}>
              <input
                value={proc.name} onChange={(e) => { patch(proc.id, { name: e.target.value }); }}
                placeholder={translate({ key: 'workspaces.runtime.namePlaceholder' })}
                aria-invalid={missing.name}
                className={`${nameCls} max-w-40 ${missing.name ? errorRing : ''}`}
              />
              {/* Reads as a LABEL when set ("preview URL", filled chip) and as an ACTION when not
                  ("make this the preview URL", quiet). Same control either way — role=radio keeps the
                  one-of-N semantics a screen reader needs. */}
              <button
                type="button" role="radio" aria-checked={isPreview}
                onClick={() => { onChange(processes, proc.id); }}
                title={translate({ key: isPreview ? 'workspaces.runtime.isPreviewTitle' : 'workspaces.runtime.makePreview' })}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs cursor-pointer transition-colors ${FOCUS_RING} ${isPreview
                  ? 'bg-primary/12 text-primary font-semibold ring-1 ring-inset ring-primary-border'
                  : 'text-meta hover:text-common hover:bg-container2'}`}
              >
                {/* Icon only on the SET state: `IconName` accepts any string and silently falls back to
                    circle-question, so inventing a name for the unset state would ship a stray glyph. */}
                {isPreview && <Icon name="globe" className={`text-[10px]`} />}
                {translate({ key: isPreview ? 'workspaces.runtime.isPreview' : 'workspaces.runtime.makePreview' })}
              </button>
              <div className={`ml-auto`}>
                <IconButton
                  icon="trash" size="sm"
                  title={translate({ key: 'workspaces.runtime.removeProcess' })}
                  onClick={() => { remove(proc.id); }}
                />
              </div>
            </div>

            <input
              value={rowCommand(proc)} onFocus={() => { setOpenPicker(proc.id); }}
              onChange={(e) => { patch(proc.id, { commands: [e.target.value] }); }}
              placeholder={translate({ key: 'workspaces.runtime.commandPlaceholder' })}
              aria-invalid={missing.command}
              className={`${inputCls} ${missing.command ? errorRing : ''}`}
            />
            <input
              value={proc.cwd} onChange={(e) => { patch(proc.id, { cwd: e.target.value }); }}
              placeholder={translate({ key: 'workspaces.runtime.cwdPlaceholder' })}
              className={`${inputCls} text-xs`}
            />
            {(missing.name || missing.command) && (
              <div className={`flex items-center gap-1.5 text-xs text-wrong`}>
                <Icon name="triangle-exclamation" className={`text-[10px]`} />
                {translate({ key: missing.name && missing.command
                  ? 'workspaces.runtime.needsBoth'
                  : (missing.name ? 'workspaces.runtime.needsName' : 'workspaces.runtime.needsCommand') })}
              </div>
            )}
            {openPicker === proc.id && (
              <RepoScriptPicker
                scripts={scripts} packageManager={packageManager}
                activeCommand={rowCommand(proc)}
                onPick={(command) => { patch(proc.id, { commands: [command] }); }}
              />
            )}
          </div>
        );
      })}

      <div className={`flex items-center gap-3`}>
        <WsButton variant="secondary" icon="plus" onClick={add}>{translate({ key: 'workspaces.runtime.addProcess' })}</WsButton>
        <span className={`text-xs text-meta inline-flex items-center gap-1.5`}>
          <Icon name="terminal" className={`text-[10px]`} />
          {translate({ key: 'workspaces.runtime.terminalHint' })}
        </span>
      </div>
    </div>
  );
}
