//? Workspaces — SPA root, registered as a splat route (`/workspaces/*`, via
//? `export const splat`). One persistent shell stays mounted; the current view
//? and any open ticket come straight from the URL (`/workspaces/board`,
//? `/workspaces/backlog`, `/workspaces/board/DEV-1240`), so browser back/forward
//? and deep links work while nav/AI-panel/tab state survive navigation. Built
//? on dummy data for now — see `_data/seed.ts`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AnimatePresence, motion, MotionConfig } from 'motion/react';

import { useTheme } from '@luckystack/core/client';

import './workspaces.css';
import AccountSettings from './_screens/AccountSettings';
import Activity from './_screens/Activity';
import Backlog from './_screens/Backlog';
import Board from './_screens/Board';
import Pipeline from './_screens/Pipeline';
import Placeholder from './_screens/Placeholder';
import Sources from './_screens/Sources';
import Terminals from './_screens/Terminals';
import TicketDetail from './_screens/TicketDetail';
import Usage from './_screens/Usage';
import WorkspaceSettings from './_screens/WorkspaceSettings';
import { AIPanel, MobileBottomBar, NavRail, TabBar, TopBar } from './_shell/Shell';
import { MobileHeader } from './_shell/MobileChrome';
import { isTicketView, WorkspacesProvider, type WorkspacesCtx, type WsView } from './_shell/WorkspacesContext';
import SearchPalette from './_components/SearchPalette';
import Icon from './_components/Icon';
import { AI_SUGGESTIONS, DEFAULT_PERM_ROLES, ENV_VARS, INITIAL_CHAT, INTEGRATION_TOOLS, ME, MEMBERS, NOTIFICATIONS, ROLE_DISPLAY, SSH_KEYS, STAGES, WORKSPACES } from './_data/seed';
import type { IconName } from './_components/Icon';
import type { ChatMessage, EnvVar, IntegrationTool, PermRole, SshKeyEntry, StageId, Workspace } from './_data/types';

const BASE = '/workspaces';

function deriveView(pathname: string): WsView {
  const rest = pathname.replace(/^\/workspaces\/?/, '');
  if (!rest) return 'board';
  const segs = rest.split('/');
  if (segs[0] === 'board' && segs[1] && isTicketView(segs[1])) return segs[1];
  return segs[0] ?? 'board';
}

function urlForView(view: WsView): string {
  return isTicketView(view) ? `${BASE}/board/${view}` : `${BASE}/${view}`;
}

const VIEW_LABELS: Record<string, string> = {
  board: 'Board', backlog: 'Backlog', terminals: 'Terminals', activity: 'Activity',
  sources: 'Sources', pipeline: 'Pipeline', usage: 'Usage', settings: 'Account', workspace: 'Workspace',
};
function viewLabel(view: WsView): string {
  return isTicketView(view) ? view : (VIEW_LABELS[view] ?? 'Board');
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

const PLACEHOLDERS: Partial<Record<WsView, { title: string; icon: IconName }>> = {};

function Screen({ view }: { view: WsView }) {
  if (isTicketView(view)) return <TicketDetail id={view} />;
  if (view === 'board') return <Board />;
  if (view === 'backlog') return <Backlog />;
  if (view === 'terminals') return <Terminals />;
  if (view === 'sources') return <Sources />;
  if (view === 'activity') return <Activity />;
  if (view === 'pipeline') return <Pipeline />;
  if (view === 'usage') return <Usage />;
  if (view === 'settings') return <AccountSettings />;
  if (view === 'workspace') return <WorkspaceSettings />;
  const ph = PLACEHOLDERS[view] ?? { title: 'Board', icon: 'table-columns' as IconName };
  return <Placeholder title={ph.title} icon={ph.icon} />;
}

//? Parse a "move DEV-1240 to review" instruction from the AI chat → a stage id.
function parseMove(text: string): { id: string; stage: StageId; stageName: string } | { unknownStage: string } | null {
  const m = /move\s+(dev-\d+)\s+to\s+([a-z]+)/i.exec(text.trim());
  if (!m) return null;
  const id = m[1]!.toUpperCase();
  const term = m[2]!.toLowerCase();
  const stage = STAGES.find((s) => s.id === term || s.name.toLowerCase() === term);
  return stage ? { id, stage: stage.id, stageName: stage.name } : { unknownStage: m[2]! };
}

export const template = 'plain';
export const splat = true;

export default function WorkspacesApp() {
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const view = deriveView(location.pathname);

  const [openTabs, setOpenTabs] = useState<string[]>(['DEV-1240', 'DEV-1245', 'DEV-1242']);
  const [expanded, setExpanded] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [suggestions, setSuggestions] = useState(AI_SUGGESTIONS);
  const [sshKeys, setSshKeys] = useState<SshKeyEntry[]>(SSH_KEYS);
  const [navStack, setNavStack] = useState<WsView[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(WORKSPACES[0]!.id);
  const [permRoles, setPermRoles] = useState<PermRole[]>(DEFAULT_PERM_ROLES);
  const [memberRoles, setMemberRoles] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.values(MEMBERS).map((m) => [m.id, ROLE_DISPLAY[m.role]])),
  );
  const [stageOverrides, setStageOverrides] = useState<Record<string, StageId>>({});
  const [envVars, setEnvVars] = useState<EnvVar[]>(ENV_VARS);
  const [integrationTools, setIntegrationTools] = useState<IntegrationTool[]>(INTEGRATION_TOOLS);

  const addSshKey = useCallback((key: SshKeyEntry) => setSshKeys((prev) => [...prev, key]), []);
  const removeSshKey = useCallback((id: string) => setSshKeys((prev) => prev.filter((k) => k.id !== id)), []);
  //? Active SSH identity = the most recently linked key's mapped user.
  const sshUserId = sshKeys.at(-1)?.userId ?? null;
  const currentUser = ME; // the account; SSH identity is separate (terminals)

  //? Normalise the bare root to /workspaces/board so the URL always names a view.
  useEffect(() => {
    if (location.pathname === BASE || location.pathname === `${BASE}/`) void navigate(`${BASE}/board`, { replace: true });
  }, [location.pathname, navigate]);

  //? Dummy chat: appends the user line + an AI reply. A recognised "move … to …"
  //? instruction actually moves the ticket (stage override) and shows the board.
  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = parseMove(trimmed);
    let reply = "Noted. This is a dummy prototype, so I can't run real agents yet — but in the live app I'd take it from here.";
    if (parsed && 'stage' in parsed) {
      setStageOverrides((prev) => ({ ...prev, [parsed.id]: parsed.stage }));
      reply = `Done — moved ${parsed.id} to ${parsed.stageName}. Watch it slide across the board.`;
      void navigate(`${BASE}/board`);
    } else if (parsed) {
      reply = `I don't know a stage called “${parsed.unknownStage}”. Try Unrefined, Refined, Plan, Implementatie, Test, Review or Final.`;
    }
    const stamp = Date.now();
    setChat((prev) => [...prev, { id: `u${String(stamp)}`, role: 'user', text: trimmed }, { id: `a${String(stamp)}`, role: 'ai', text: reply }]);
  }, [navigate]);

  const ctx = useMemo<WorkspacesCtx>(() => {
    //? push = remember the current view so the back arrow can return to it.
    const push = (v: WsView) => { if (v !== view) setNavStack((s) => [...s, view]); };
    return {
      view,
      //? chrome nav — does NOT touch the back stack.
      navigate: (v) => { void navigate(urlForView(v)); },
      //? reference nav (a link clicked from page content) — pushes the stack.
      pushTo: (v) => { push(v); void navigate(urlForView(v)); },
      goBack: () => {
        const prev = navStack.at(-1);
        if (prev === undefined) return;
        setNavStack((s) => s.slice(0, -1));
        void navigate(urlForView(prev));
      },
      canGoBack: navStack.length > 0,
      backLabel: navStack.length > 0 ? viewLabel(navStack.at(-1)!) : null,
      openTabs,
      openTicket: (id) => {
        setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8));
        push(id);
        void navigate(urlForView(id));
      },
      closeTab: (id) => {
        setOpenTabs((prev) => prev.filter((t) => t !== id));
        if (view === id) void navigate(`${BASE}/board`);
      },
      recent,
      isMobile,
      theme: theme === 'dark' ? 'dark' : 'light',
      setTheme,
      suggestions,
      dismissSuggestion: (id) => setSuggestions((s) => s.filter((x) => x.id !== id)),
      unreadNotifications: NOTIFICATIONS.filter((n) => !n.read).length,
      currentUser,
      sshKeys,
      sshUserId,
      addSshKey,
      removeSshKey,
      aiOpen,
      toggleAi: () => setAiOpen((o) => !o),
      chat,
      sendChat,
      workspaces,
      activeWorkspace: workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0]!,
      setActiveWorkspace: (id) => setActiveWorkspaceId(id),
      createWorkspace: (name) => {
        const slug = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
        const id = `ws-${slug || 'new'}`;
        setWorkspaces((prev) => [...prev, { id, name: name.trim(), slug: slug || id, ownerId: currentUser.id, role: 'owner' }]);
        setActiveWorkspaceId(id);
      },
      permRoles,
      togglePerm: (ri, ci) => setPermRoles((prev) => prev.map((r, i) => (i === ri && !r.locked ? { ...r, perms: r.perms.map((v, j) => (j === ci ? !v : v)) } : r))),
      addRole: (name) => setPermRoles((prev) => [...prev, { name, perms: prev[0]!.perms.map(() => false) }]),
      memberRoles,
      setMemberRole: (mid, role) => setMemberRoles((prev) => ({ ...prev, [mid]: role })),
      envVars,
      saveEnvVar: (v) => setEnvVars((prev) => (prev.some((x) => x.id === v.id) ? prev.map((x) => (x.id === v.id ? v : x)) : [...prev, v])),
      removeEnvVar: (id) => setEnvVars((prev) => prev.filter((x) => x.id !== id)),
      integrationTools,
      saveIntegrationTool: (t) => setIntegrationTools((prev) => (prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t])),
      removeIntegrationTool: (id) => setIntegrationTools((prev) => prev.filter((x) => x.id !== id)),
      stageOverrides,
      moveTicket: (id, stage) => setStageOverrides((prev) => ({ ...prev, [id]: stage })),
    };
  }, [view, navStack, recent, openTabs, isMobile, theme, setTheme, suggestions, navigate, currentUser, sshKeys, sshUserId, addSshKey, removeSshKey, aiOpen, chat, sendChat, workspaces, activeWorkspaceId, permRoles, memberRoles, envVars, integrationTools, stageOverrides]);

  //? ⌘K / Ctrl-K opens the search palette anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const noop = () => {};
  const openSearch = () => setSearchOpen(true);
  const showAi = aiOpen;

  return (
    <MotionConfig reducedMotion="user">
      <WorkspacesProvider value={ctx}>
        <div className="flex h-full w-full bg-background text-title overflow-hidden">
          <NavRail expanded={expanded} setExpanded={setExpanded} />
          <div className="flex-1 flex flex-col min-w-0">
            <MobileHeader onCmdK={openSearch} />
            <TopBar onCmdK={openSearch} onNotifications={noop} />
            <TabBar onAiToggle={() => setAiOpen((o) => !o)} />
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                {/* contextual back row — only when a reference was followed */}
                <AnimatePresence initial={false}>
                  {ctx.canGoBack && (
                    <motion.div key="backbar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden border-b border-divider bg-background">
                      <div className="px-4 md:px-6 py-2">
                        <button type="button" onClick={ctx.goBack} className="inline-flex items-center gap-2 rounded-lg pl-2 pr-3 h-8 text-sm text-common hover:bg-container2 cursor-pointer">
                          <Icon name="arrow-left" /> Back{ctx.backLabel ? ` to ${ctx.backLabel}` : ''}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex-1 min-h-0">
                  <Screen view={view} />
                </div>
              </div>
              <AnimatePresence initial={false}>
                {showAi && <AIPanel key="ai" onClose={() => setAiOpen(false)} />}
              </AnimatePresence>
            </div>
            <MobileBottomBar onFab={noop} />
          </div>
        </div>
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      </WorkspacesProvider>
    </MotionConfig>
  );
}
