//? Workspaces — self-contained app state + navigation provider.
//?
//? Holds the SPA state the prototype kept in the old splat-`page.tsx` (open ticket
//? tabs, AI chat/suggestions, workspaces, RBAC edits, env/integration config, …)
//? and exposes it + the navigation helpers via `useWorkspaces()`. Navigation now
//? drives REAL framework routes (`/workspaces`, `/workspaces/backlog`,
//? `/workspaces/board/DEV-1240`); the active `view` is derived from the URL. Lives
//? inside the `workspaces` template so it persists across the ws routes (the
//? template is keyed by name in `main.tsx`). State is dummy-data for now — Lane B
//? swaps the internals for the `useWorkspaceData()` seam (see `_docs/MIGRATION.md`).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useTheme } from '@luckystack/core/client';

import {
  AI_SUGGESTIONS, DEFAULT_PERM_ROLES, ENV_VARS, INITIAL_CHAT, INTEGRATION_TOOLS,
  ME, MEMBERS, NOTIFICATIONS, ROLE_DISPLAY, SSH_KEYS, STAGES, WORKSPACES,
} from '../_data/seed';
import type { ChatMessage, EnvVar, IntegrationTool, PermRole, SshKeyEntry, Workspace } from '../_data/types';
import { isTicketView, WorkspacesContextProvider, type WorkspacesCtx, type WsView } from './WorkspacesContext';

const BASE = '/workspaces';

//? view ↔ route path. Board is the index route; a ticket lives under /board/<id>;
//? every other view is its own child route. Keep this the single source of the
//? mapping so nav + active-highlight stay in sync.
function pathForView(view: WsView): string {
  if (view === 'board') return BASE;
  if (isTicketView(view)) return `${BASE}/board/${view}`;
  return `${BASE}/${view}`;
}

function viewFromPath(pathname: string): WsView {
  const rest = pathname.replace(/^\/workspaces\/?/, '').replace(/\/+$/, '');
  if (!rest) return 'board';
  const segs = rest.split('/');
  if (segs[0] === 'board' && segs[1] && isTicketView(segs[1])) return segs[1];
  return segs[0] ?? 'board';
}

const VIEW_LABELS: Record<string, string> = {
  board: 'Board', backlog: 'Backlog', terminals: 'Terminals', activity: 'Activity',
  sources: 'Sources', pipeline: 'Pipeline', usage: 'Usage', settings: 'Account', workspace: 'Workspace',
};
function viewLabel(view: WsView): string {
  return isTicketView(view) ? view : (VIEW_LABELS[view] ?? 'Board');
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => globalThis.window !== undefined && globalThis.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = globalThis.matchMedia('(max-width: 767px)');
    const onChange = () => { setMobile(mq.matches); };
    mq.addEventListener('change', onChange);
    return () => { mq.removeEventListener('change', onChange); };
  }, []);
  return mobile;
}

//? Parse a "move DEV-1240 to review" instruction from the AI chat → a stage id.
function parseMove(text: string): { id: string; stage: string; stageName: string } | { unknownStage: string } | null {
  const m = /move\s+(dev-\d+)\s+to\s+([a-z]+)/i.exec(text.trim());
  if (!m) return null;
  const id = m[1].toUpperCase();
  const term = m[2].toLowerCase();
  const stage = STAGES.find((s) => s.id === term || s.name.toLowerCase() === term);
  return stage ? { id, stage: stage.id, stageName: stage.name } : { unknownStage: m[2] };
}

export function WorkspacesProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const view = viewFromPath(location.pathname);

  const [openTabs, setOpenTabs] = useState<string[]>(['DEV-1240', 'DEV-1245', 'DEV-1242']);
  const [aiOpen, setAiOpen] = useState(true);
  const [suggestions, setSuggestions] = useState(AI_SUGGESTIONS);
  const [sshKeys, setSshKeys] = useState<SshKeyEntry[]>(SSH_KEYS);
  const [navStack, setNavStack] = useState<WsView[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(WORKSPACES[0].id);
  const [permRoles, setPermRoles] = useState<PermRole[]>(DEFAULT_PERM_ROLES);
  const [memberRoles, setMemberRoles] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.values(MEMBERS).map((m) => [m.id, ROLE_DISPLAY[m.role]])),
  );
  const [stageOverrides, setStageOverrides] = useState<Record<string, string>>({});
  const [envVars, setEnvVars] = useState<EnvVar[]>(ENV_VARS);
  const [integrationTools, setIntegrationTools] = useState<IntegrationTool[]>(INTEGRATION_TOOLS);

  const addSshKey = useCallback((key: SshKeyEntry) => { setSshKeys((prev) => [...prev, key]); }, []);
  const removeSshKey = useCallback((id: string) => { setSshKeys((prev) => prev.filter((k) => k.id !== id)); }, []);
  //? Active SSH identity = the most recently linked key's mapped user.
  const sshUserId = sshKeys.at(-1)?.userId ?? null;
  const currentUser = ME; // the account; SSH identity is separate (terminals)

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
      void navigate(BASE);
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
      navigate: (v) => { void navigate(pathForView(v)); },
      //? reference nav (a link clicked from page content) — pushes the stack.
      pushTo: (v) => { push(v); void navigate(pathForView(v)); },
      goBack: () => {
        const prev = navStack.at(-1);
        if (prev === undefined) return;
        setNavStack((s) => s.slice(0, -1));
        void navigate(pathForView(prev));
      },
      canGoBack: navStack.length > 0,
      backLabel: navStack.length > 0 ? viewLabel(navStack.at(-1)!) : null,
      openTabs,
      openTicket: (id) => {
        setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8));
        push(id);
        void navigate(pathForView(id));
      },
      closeTab: (id) => {
        setOpenTabs((prev) => prev.filter((t) => t !== id));
        if (view === id) void navigate(BASE);
      },
      recent,
      isMobile,
      theme: theme === 'dark' ? 'dark' : 'light',
      setTheme,
      suggestions,
      dismissSuggestion: (id) => { setSuggestions((s) => s.filter((x) => x.id !== id)); },
      unreadNotifications: NOTIFICATIONS.filter((n) => !n.read).length,
      currentUser,
      sshKeys,
      sshUserId,
      addSshKey,
      removeSshKey,
      aiOpen,
      toggleAi: () => { setAiOpen((o) => !o); },
      chat,
      sendChat,
      workspaces,
      activeWorkspace: workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0],
      setActiveWorkspace: (id) => { setActiveWorkspaceId(id); },
      createWorkspace: (name) => {
        const slug = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
        const id = `ws-${slug || 'new'}`;
        setWorkspaces((prev) => [...prev, { id, name: name.trim(), slug: slug || id, ownerId: currentUser.id, role: 'owner' }]);
        setActiveWorkspaceId(id);
      },
      permRoles,
      togglePerm: (ri, ci) => { setPermRoles((prev) => prev.map((r, i) => (i === ri && !r.locked ? { ...r, perms: r.perms.map((v, j) => (j === ci ? !v : v)) } : r))); },
      addRole: (name) => { setPermRoles((prev) => [...prev, { name, perms: prev[0].perms.map(() => false) }]); },
      memberRoles,
      setMemberRole: (mid, role) => { setMemberRoles((prev) => ({ ...prev, [mid]: role })); },
      envVars,
      saveEnvVar: (v) => { setEnvVars((prev) => (prev.some((x) => x.id === v.id) ? prev.map((x) => (x.id === v.id ? v : x)) : [...prev, v])); },
      removeEnvVar: (id) => { setEnvVars((prev) => prev.filter((x) => x.id !== id)); },
      integrationTools,
      saveIntegrationTool: (t) => { setIntegrationTools((prev) => (prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t])); },
      removeIntegrationTool: (id) => { setIntegrationTools((prev) => prev.filter((x) => x.id !== id)); },
      stageOverrides,
      moveTicket: (id, stage) => { setStageOverrides((prev) => ({ ...prev, [id]: stage })); },
    };
  }, [view, navStack, recent, openTabs, isMobile, theme, setTheme, suggestions, navigate, currentUser, sshKeys, sshUserId, addSshKey, removeSshKey, aiOpen, chat, sendChat, workspaces, activeWorkspaceId, permRoles, memberRoles, envVars, integrationTools, stageOverrides]);

  return <WorkspacesContextProvider value={ctx}>{children}</WorkspacesContextProvider>;
}
