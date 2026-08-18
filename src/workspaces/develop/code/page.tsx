//? intent: Code — a read-only browser for the WHOLE codebase of the workspace's linked project repo,
//? reachable from the nav (Develop → Code). Pick a file in the tree on the left, read it syntax-
//? highlighted on the right. Until now only the per-ticket live editor could show repo files; this brings
//? the entire baseline-branch tree to a first-class destination. Phone-width: the tree collapses to a
//? disclosure above the preview. One primary interaction — pick a file, read it.

import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { buildTree } from 'src/_components/editor/fileTree';
import { FileExplorer } from 'src/_components/editor/FileExplorer';
import { languageForPath } from 'src/_components/editor/languages';
import { getPalette, loadThemeId } from 'src/_components/editor/editorThemes';

import Icon from '../../_components/Icon';
import { EmptyPicker, SetupNotice } from '../../_components/SetupNotice';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { Collapse } from '../../_components/motion';
import { InfoTip, WsButton } from '../../_components/primitives';

//? Lazy so Monaco (multi-MB) only loads once a file is actually opened.
const LazyMonacoEditor = lazy(() => import('src/_components/editor/MonacoEditor').then((m) => ({ default: m.MonacoEditor })));

interface RepoTreeEntry { path: string; size: number }
interface OpenFile { path: string; content: string; binary: boolean; truncated: boolean }

export const template = 'workspaces';

//? Page header: title + baseline-branch chip + (phone-only) tree toggle. Its own component so it can
//? translate/render on both the linked + empty-state paths without prop-drilling the translator.
function CodeHeader({ branch, onToggleFiles }: { branch: string | null; onToggleFiles: (() => void) | null }) {
  const translate = useTranslator();
  const { focusSetup } = useWorkspaces();
  return (
    <div className={`flex items-start justify-between gap-3 px-4 md:px-6 py-3 md:py-4`}>
      <div className={`min-w-0`}>
        <div className={`flex items-center gap-3 flex-wrap`}>
          <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.code.title' })}</h1>
          {branch !== null && (
            <span className={`inline-flex items-center gap-1.5`}>
              {/* "branch" means something different here than on a ticket: this is the read-only default
                  branch of the repo, not any ticket's in-flight work — say so on the chip itself. */}
              <span className={`inline-flex items-center gap-1.5 rounded-lg bg-container2 px-2 h-7 text-xs font-medium text-common`}>
                <Icon name="code-branch" /> {branch} <span className={`text-meta`}>· {translate({ key: 'workspaces.code.baselineReadOnly' })}</span>
              </span>
              {/* The chip's branch AND everything below it are read from the server's own bare mirror.
                  That mirror is created at link time but is ALSO the repo Workspaces itself writes to
                  (MR merge / rollback / conductor commit land there first) — so it is not a frozen
                  snapshot. What never happens is a fetch FROM origin: nothing in server/ pulls, so
                  outside pushes stay invisible until a re-link, which re-clones from scratch and drops
                  the local ticket branches — hence the split third point around the destructive fix. */}
              <InfoTip
                title={translate({ key: 'workspaces.code.branchInfoTitle' })}
                body={translate({ key: 'workspaces.code.branchInfoBody' })}
                points={[
                  { id: 'copy', label: translate({ key: 'workspaces.tips.code.mirrorCopy' }), desc: translate({ key: 'workspaces.tips.code.mirrorCopyDesc' }) },
                  { id: 'refresh', label: translate({ key: 'workspaces.tips.code.mirrorRefresh' }), desc: translate({ key: 'workspaces.tips.code.mirrorRefreshDesc' }) },
                  {
                    id: 'relink',
                    label: translate({ key: 'workspaces.tips.code.mirrorRelink' }),
                    desc: translate({ key: 'workspaces.tips.code.mirrorRelinkDesc' }),
                    onGo: () => { focusSetup({ view: 'workspace', tab: 'repository' }); },
                    goLabel: translate({ key: 'workspaces.tips.code.mirrorRefreshGo' }),
                  },
                ]}
                align="end"
              />
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1.5 mt-0.5`}>
          <p className={`text-sm text-muted`}>{translate({ key: 'workspaces.code.subtitle' })}</p>
          {/* Two invisible inputs decide WHICH files this is: the active project, and the server's
              5000-file listing cap (the page never sees the `truncated` flag). */}
          {branch !== null && (
            <InfoTip
              title={translate({ key: 'workspaces.tips.code.scopeTitle' })}
              body={translate({ key: 'workspaces.tips.code.scopeBody' })}
              points={[
                { id: 'project', label: translate({ key: 'workspaces.tips.code.scopeProject' }), desc: translate({ key: 'workspaces.tips.code.scopeProjectDesc' }) },
                { id: 'cap', label: translate({ key: 'workspaces.tips.code.scopeCap' }), desc: translate({ key: 'workspaces.tips.code.scopeCapDesc' }) },
              ]}
              align="start"
            />
          )}
        </div>
      </div>
      {onToggleFiles !== null && (
        <WsButton variant="secondary" icon="bars" onClick={onToggleFiles} className={`md:hidden shrink-0`}>
          {translate({ key: 'workspaces.code.files' })}
        </WsButton>
      )}
    </div>
  );
}

export default function CodeBrowser() {
  const translate = useTranslator();
  const { repo, activeWorkspace, activeProjectId } = useWorkspaces();
  const themeId = loadThemeId(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const palette = getPalette(themeId);

  const [entries, setEntries] = useState<RepoTreeEntry[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  //? Monotonic request tokens: a later request bumps the ref, so a stale tree/file response (from a
  //? project switch or a quick second click) is dropped instead of clobbering the newer state.
  const treeReqRef = useRef(0);
  const fileReqRef = useRef(0);

  const tree = useMemo(() => buildTree(entries.map((e) => e.path)), [entries]);

  //? Load the whole-repo listing whenever the linked repo / active project changes.
  useEffect(() => {
    if (!repo.linked) { setEntries([]); setBranch(null); return; }
    const req = treeReqRef.current + 1;
    treeReqRef.current = req;
    setTreeLoading(true); setTreeError(false);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({
        name: 'workspaces/repoTree', version: 'v1',
        data: { workspaceId: activeWorkspace.id, ...(activeProjectId ? { projectId: activeProjectId } : {}) },
      }));
      //? Drop a superseded response (deps changed / component gone).
      if (req !== treeReqRef.current) return;
      setTreeLoading(false);
      if (error || res?.status !== 'success') { setTreeError(true); return; }
      if (!res.result.linked) { setEntries([]); setBranch(null); return; }
      const list = res.result.entries ?? [];
      setEntries(list);
      setBranch(res.result.branch ?? null);
      //? Open only the TOP-LEVEL folders so a large repo lands tidy, not fully-unfolded.
      const built = buildTree(list.map((e) => e.path));
      setExpanded(new Set(built.filter((n) => n.type === 'dir').map((n) => n.path)));
    })();
  }, [repo.linked, activeWorkspace.id, activeProjectId]);

  const toggleDir = (path: string): void => {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  };

  const openFile = (path: string): void => {
    setActivePath(path);
    setDrawerOpen(false);
    setFileLoading(true); setFileError(false); setFile(null);
    const req = fileReqRef.current + 1;
    fileReqRef.current = req;
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({
        name: 'workspaces/repoFile', version: 'v1',
        data: { workspaceId: activeWorkspace.id, ...(activeProjectId ? { projectId: activeProjectId } : {}), path },
      }));
      //? Drop a stale response if the user has since picked another file.
      if (req !== fileReqRef.current) return;
      setFileLoading(false);
      if (error || res?.status !== 'success' || !res.result.ok) { setFileError(true); return; }
      setFile({ path, content: res.result.content ?? '', binary: res.result.binary ?? false, truncated: res.result.truncated ?? false });
    })();
  };

  if (!repo.linked) {
    return (
      <div className={`flex flex-col h-full min-h-0`}>
        <CodeHeader branch={null} onToggleFiles={null} />
        <SetupNotice
          icon="code"
          title={translate({ key: 'workspaces.code.emptyTitle' })}
          body={translate({ key: 'workspaces.setup.repo.why' })}
          fix={{ cap: 'workspaceSettings', view: 'workspace', tab: 'repository', cta: translate({ key: 'workspaces.setup.repo.cta' }) }}
        />
      </div>
    );
  }

  //? Same shape as renderPreview below: early returns rather than a ternary chain, so adding the
  //? empty-repo case did not turn this into three nested conditionals.
  const renderTree = (): ReactNode => {
    if (treeLoading && entries.length === 0) return <div className={`h-full flex items-center justify-center text-sm text-muted`}>{translate({ key: 'workspaces.ticket.loadingEditor' })}</div>;
    if (treeError) return <div className={`h-full flex items-center justify-center px-4 text-center text-sm text-wrong`}>{translate({ key: 'workspaces.code.treeError' })}</div>;
    //? A linked repo with an EMPTY listing (a repo with no commits yet, or a listing that failed)
    //? used to render a blank panel with no reason and no way out — say which, and point at the one
    //? place a repo is linked/replaced.
    if (entries.length === 0) {
      return (
        <div className={`h-full overflow-y-auto p-2`}>
          <EmptyPicker
            icon="file-lines"
            label={translate({ key: 'workspaces.tips.code.emptyTree' })}
            fix={{ cap: 'workspaceSettings', view: 'workspace', tab: 'repository', cta: translate({ key: 'workspaces.tips.code.emptyTreeCta' }) }}
          />
        </div>
      );
    }
    return <FileExplorer tree={tree} activePath={activePath} onOpen={openFile} palette={palette} expanded={expanded} onToggleDir={toggleDir} />;
  };

  const treePanel = (
    <div className={`h-full min-h-0 overflow-hidden rounded-lg border border-container1-border`} style={{ background: palette.bgAlt }}>
      {renderTree()}
    </div>
  );

  //? The right pane's content, chosen by state (loading → error → nothing-picked → binary → editor).
  //? A function of early returns rather than a deep ternary chain.
  const renderPreview = (): ReactNode => {
    if (fileLoading) return <div className={`h-full flex items-center justify-center text-sm text-muted`}>{translate({ key: 'workspaces.ticket.loadingEditor' })}</div>;
    if (fileError) return <div className={`h-full flex items-center justify-center text-sm text-wrong`}>{translate({ key: 'workspaces.code.fileError' })}</div>;
    if (file === null) return <div className={`h-full flex items-center justify-center px-6 text-center text-sm text-muted`}>{translate({ key: 'workspaces.editor.openFileHint' })}</div>;
    if (file.binary) return <div className={`h-full flex flex-col items-center justify-center gap-2 text-sm text-muted`}><Icon name="file-lines" className={`text-3xl text-disabled`} />{translate({ key: 'workspaces.code.binaryFile' })}</div>;
    return (
      <Suspense fallback={<div className={`h-full flex items-center justify-center text-sm text-muted`}>{translate({ key: 'workspaces.ticket.loadingEditor' })}</div>}>
        <LazyMonacoEditor value={file.content} language={languageForPath(file.path)} theme={themeId} path={file.path} readOnly minimap={false} />
      </Suspense>
    );
  };

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <CodeHeader branch={branch} onToggleFiles={() => { setDrawerOpen((o) => !o); }} />
      <div className={`flex-1 min-h-0 flex flex-col md:flex-row gap-3 px-4 md:px-6 pb-6`}>
        {/* Desktop: a fixed tree column. */}
        <div className={`hidden md:block md:w-72 shrink-0 min-h-0`}>{treePanel}</div>
        {/* Phone: the tree is a disclosure ABOVE the preview, toggled from the header. */}
        <Collapse open={drawerOpen} className={`md:hidden shrink-0`}>
          <div className={`h-64`}>{treePanel}</div>
        </Collapse>
        {/* Preview */}
        <div className={`flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden rounded-lg border border-container1-border`} style={{ background: palette.bg }}>
          <div className={`flex items-center gap-2 px-3 h-9 shrink-0 border-b border-divider`}>
            <span className={`text-[13px] font-mono truncate`} style={{ color: palette.fg }}>{activePath ?? translate({ key: 'workspaces.editor.openFileHint' })}</span>
            <div className={`flex-1`} />
            {file?.truncated === true && <span className={`text-[11px] rounded px-1.5 py-0.5 bg-warning/15 text-warning whitespace-nowrap`}>{translate({ key: 'workspaces.code.truncated' })}</span>}
          </div>
          <div className={`flex-1 min-h-0`}>{renderPreview()}</div>
        </div>
      </div>
    </div>
  );
}
