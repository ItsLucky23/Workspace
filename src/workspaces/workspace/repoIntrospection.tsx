//? ADR 0313 — show the user what is actually IN their linked repository.
//?
//? The owner's complaint: after linking a repo, the Repository tab offers a Dockerfile draft and two
//? blank text inputs for the dev and prod commands, and nowhere can you see what commands your repo
//? even has. Worse for a real project — one with a docker-compose stack and several Dockerfiles —
//? because none of that is acknowledged at all.
//?
//? The capability was already there: the server reads package.json, lockfiles and Dockerfiles out of
//? the bare clone to feed Dockerfile generation and image builds. It was simply never pointed at the
//? human. This renders that read: scripts you can CLICK instead of retype, plus the Dockerfiles and
//? compose files that exist, so the page stops pretending the repo is a single anonymous blob.
//? @adr 0313

/* eslint-disable react-refresh/only-export-components -- the introspection hook and the panels that render it are one feature; splitting them would put a two-line hook in its own file for a dev-only fast-refresh rule. These are not route components. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from '../_components/Icon';
import { FOCUS_RING } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';

export interface RepoScript { file: string; name: string; command: string }
export interface RepoIntrospection {
  linked: boolean;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';
  scripts: RepoScript[];
  dockerfiles: string[];
  composeFiles: string[];
  units: string[];
  truncated: boolean;
}

const EMPTY: RepoIntrospection = { linked: false, packageManager: 'unknown', scripts: [], dockerfiles: [], composeFiles: [], units: [], truncated: false };

/** Read the linked repo's contents. Re-runs when the project changes; a failure yields the empty
 *  shape rather than an error state — the panel then simply shows nothing was detected. */
export function useRepoIntrospection(workspaceId: string, projectId: string | undefined): { data: RepoIntrospection; loading: boolean; reload: () => void } {
  const [data, setData] = useState<RepoIntrospection>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  //? Sequence guard rather than a `cancelled` flag: reads overlap while switching project, and this
  //? makes completion monotonic — a slow first response can never overwrite a newer one. Same pattern
  //? the workspace snapshot uses for the same reason.
  const runRef = useRef(0);

  useEffect(() => {
    runRef.current += 1;
    const run = runRef.current;
    setLoading(true);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({
        name: 'workspaces/repoIntrospect', version: 'v1',
        data: { workspaceId, ...(projectId === undefined ? {} : { projectId }) },
      }));
      if (runRef.current !== run) return;
      setData(error || res?.status !== 'success' ? EMPTY : res.result);
      setLoading(false);
    })();
  }, [workspaceId, projectId, nonce]);

  const reload = useCallback(() => { setNonce((n) => n + 1); }, []);
  return { data, loading, reload };
}

/** The run prefix for a script, so the command shown is the one you would actually type. */
export function runPrefix(pm: RepoIntrospection['packageManager']): string {
  return pm === 'unknown' ? 'npm run' : `${pm} run`;
}

/** Scripts found in the repo, as rows you pick. Grouped by the package.json they came from, because
 *  in a monorepo "build" means something different per unit and the file is the only thing that says
 *  which one you are choosing. */
export function RepoScriptPicker({ scripts, packageManager, onPick, activeCommand }: {
  scripts: RepoScript[];
  packageManager: RepoIntrospection['packageManager'];
  onPick: (command: string) => void;
  /** The command currently in the field, so the matching row reads as selected. */
  activeCommand?: string;
}) {
  const translate = useTranslator();
  if (scripts.length === 0) return null;

  const byFile = new Map<string, RepoScript[]>();
  for (const script of scripts) byFile.set(script.file, [...(byFile.get(script.file) ?? []), script]);
  const prefix = runPrefix(packageManager);

  return (
    <div className={`flex flex-col gap-3`}>
      {[...byFile.entries()].map(([file, group]) => (
        <div key={file} className={`flex flex-col gap-1.5`}>
          {byFile.size > 1 && <div className={`text-xs font-mono text-meta truncate`}>{file}</div>}
          <div className={`flex flex-wrap gap-1.5`}>
            {group.map((script) => {
              const full = `${prefix} ${script.name}`;
              const on = activeCommand?.trim() === full;
              return (
                <button
                  key={`${file}:${script.name}`}
                  type="button"
                  title={script.command}
                  onClick={() => { onPick(full); }}
                  className={`min-h-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono transition-colors duration-150 cursor-pointer ${FOCUS_RING} ${on ? 'border-primary bg-primary/10 text-primary' : 'border-container1-border bg-container2/50 text-common hover:border-primary/50 hover:text-title'}`}
                >
                  {on && <Icon name="check" className={`text-[10px]`} />}
                  {script.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className={`text-xs text-meta`}>{translate({ key: 'workspaces.repoScan.pickHint', params: [{ key: 'prefix', value: prefix }] })}</div>
    </div>
  );
}

/** The inventory as a self-contained panel, for the Link section: right after you connect a repo, the
 *  first useful confirmation is "yes, and here is what I found in it". */
export function RepoInventoryPanel({ workspaceId }: { workspaceId: string }) {
  const translate = useTranslator();
  const { activeProject } = useWorkspaces();
  const { data, loading } = useRepoIntrospection(workspaceId, activeProject?.id);
  if (loading || (data.units.length === 0 && data.dockerfiles.length === 0 && data.composeFiles.length === 0)) return null;

  return (
    <div className={`rounded-xl border border-container1-border bg-container1 p-4 flex flex-col gap-2.5`}>
      <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.repoScan.foundTitle' })}</div>
      <RepoInventory data={data} />
      {data.composeFiles.length > 0 && (
        <div className={`text-xs text-muted leading-relaxed`}>{translate({ key: 'workspaces.repoScan.composeNote' })}</div>
      )}
    </div>
  );
}

/** The plain inventory: what the scan found, said out loud. Its value is mostly in what it reveals
 *  the app is NOT using — several Dockerfiles when only `.workspaces/Dockerfile` is built, or a
 *  compose file that no service stack has been created from. */
export function RepoInventory({ data }: { data: RepoIntrospection }) {
  const translate = useTranslator();
  const rows: { key: string; icon: IconName; label: string; items: string[] }[] = ([
    { key: 'units', icon: 'file-lines', label: translate({ key: 'workspaces.repoScan.units' }), items: data.units },
    { key: 'dockerfiles', icon: 'cube', label: translate({ key: 'workspaces.repoScan.dockerfiles' }), items: data.dockerfiles },
    { key: 'compose', icon: 'database', label: translate({ key: 'workspaces.repoScan.composeFiles' }), items: data.composeFiles },
  ] satisfies { key: string; icon: IconName; label: string; items: string[] }[]).filter((row) => row.items.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2`}>
      {rows.map((row) => (
        <div key={row.key} className={`flex items-start gap-2.5 text-xs`}>
          <Icon name={row.icon} className={`text-meta mt-0.5 shrink-0`} />
          <span className={`text-meta shrink-0`}>{row.label}</span>
          <span className={`min-w-0 flex-1 flex flex-wrap gap-1`}>
            {row.items.map((item) => (
              <span key={item} className={`rounded bg-container2 px-1.5 py-0.5 font-mono text-meta break-all`}>{item}</span>
            ))}
          </span>
        </div>
      ))}
      {data.truncated && <div className={`text-xs text-meta italic`}>{translate({ key: 'workspaces.repoScan.truncated' })}</div>}
    </div>
  );
}
