//? Workspaces — self-contained app state + navigation provider.
//?
//? Fetches the tenant-scoped `workspaces/snapshot` (the `useWorkspaceData()` seam,
//? MIGRATION §4) and exposes it + the navigation helpers via `useWorkspaces()`.
//? Navigation drives REAL framework routes; the active `view` is derived from the
//? URL. Mutations go through the `workspaces/control` [control-API] route + refetch
//? (the ops the Conductor implements persist; the rest are optimistic-local until
//? their write slice lands). UI-only state (open tabs, AI panel, chat, ssh keys)
//? stays client-side.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { apiRequest, tryCatch, useSession, useTheme } from '@luckystack/core/client';

import { backendUrl, loginPageUrl } from '../../../config';
import type { SessionLayout } from '../../../config';
import { INITIAL_CHAT, SSH_KEYS } from '../_data/seed';
import type { ControlOp } from '../_functions/controlApi';
import type {
  ActivityEvent, AiSuggestion, ChatMessage, EnvVar, InfoDoc, IntegrationTool, InviteEntry,
  Member, NotificationItem, PermRole, PipelineStage, PipelineStageCfg, SkillEntry, Sprint,
  SshKeyEntry, Ticket, Workspace, WorkspaceBudget,
} from '../_data/types';
import { isTicketView, WorkspacesContextProvider, type WorkspacesCtx, type WsView } from './WorkspacesContext';

const BASE = '/workspaces';

interface Snap {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  members: Member[];
  tickets: Ticket[];
  stages: PipelineStage[];
  sprints: Sprint[];
  suggestions: AiSuggestion[];
  budget: WorkspaceBudget | null;
  docs: InfoDoc[];
  skills: SkillEntry[];
  roles: PermRole[];
  envVars: EnvVar[];
  integrations: IntegrationTool[];
  invites: InviteEntry[];
  events: ActivityEvent[];
  notifications: NotificationItem[];
  stageConfigs: PipelineStageCfg[];
}
const EMPTY_SNAP: Snap = {
  workspaces: [], activeWorkspaceId: null, members: [], tickets: [], stages: [], sprints: [],
  suggestions: [], budget: null, docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [],
  notifications: [], stageConfigs: [],
};

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
  const [mobile, setMobile] = useState(() => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = globalThis.matchMedia('(max-width: 767px)');
    const onChange = () => { setMobile(mq.matches); };
    mq.addEventListener('change', onChange);
    return () => { mq.removeEventListener('change', onChange); };
  }, []);
  return mobile;
}

//? A monotonic-ish client request id for control-API idempotency.
let reqCounter = 0;
function nextReqId(): string { reqCounter += 1; return `c${String(reqCounter)}-${String(reqCounter * 7 + 13)}`; }

export function WorkspacesProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const { session } = useSession<SessionLayout>();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const view = viewFromPath(location.pathname);

  const [snap, setSnap] = useState<Snap>(EMPTY_SNAP);
  const [loading, setLoading] = useState(true);
  const [wantWorkspaceId, setWantWorkspaceId] = useState<string | undefined>();

  const refetch = useCallback(() => {
    void (async () => {
      const res = await apiRequest({ name: 'workspaces/snapshot', version: 'v1', data: { workspaceId: wantWorkspaceId } });
      if (res.status === 'success') setSnap(res.result);
      setLoading(false);
    })();
  }, [wantWorkspaceId]);
  useEffect(() => { refetch(); }, [refetch]);

  //? A control-API write: enqueue → the Conductor persists → refetch the snapshot.
  const control = useCallback((op: ControlOp, target: Record<string, unknown>, payload: Record<string, unknown>) => {
    void (async () => {
      await apiRequest({ name: 'workspaces/control', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', op, target, payload, clientRequestId: nextReqId() } });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);

  // UI-only state (not yet server-backed).
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(true);
  const [sshKeys, setSshKeys] = useState<SshKeyEntry[]>(SSH_KEYS);
  const [navStack, setNavStack] = useState<WsView[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [stageOverrides, setStageOverrides] = useState<Record<string, string>>({});
  const [localSuggestionsDismissed, setLocalSuggestionsDismissed] = useState<string[]>([]);

  const addSshKey = useCallback((key: SshKeyEntry) => { setSshKeys((prev) => [...prev, key]); }, []);
  const removeSshKey = useCallback((id: string) => { setSshKeys((prev) => prev.filter((k) => k.id !== id)); }, []);
  const sshUserId = sshKeys.at(-1)?.userId ?? null;

  //? currentUser = the logged-in session user (falls back to the owner member).
  const currentUser: Member = useMemo(() => {
    const s = session;
    const inMembers = s ? snap.members.find((m) => m.id === s.id) : undefined;
    if (inMembers) return inMembers;
    if (s) return { id: s.id, name: s.name ?? s.email, email: s.email, avatar: s.avatar.length > 0 ? s.avatar : undefined, avatarFallback: s.avatarFallback.length > 0 ? s.avatarFallback : '#6366F1', role: 'owner' };
    return { id: '', name: '', email: '', avatarFallback: '#6366F1', role: 'member' };
  }, [session, snap.members]);

  const membersById = useMemo(() => Object.fromEntries(snap.members.map((m) => [m.id, m])), [snap.members]);

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const stamp = String(reqCounter + 1); reqCounter += 1;
    const reply = 'Noted — the live Workspace-AI lands with the pipeline engine (Fase 2). For now I can only chat.';
    setChat((prev) => [...prev, { id: `u${stamp}`, role: 'user', text: trimmed }, { id: `a${stamp}`, role: 'ai', text: reply }]);
  }, []);

  const activeSuggestions = useMemo(() => snap.suggestions.filter((s) => !localSuggestionsDismissed.includes(s.id)), [snap.suggestions, localSuggestionsDismissed]);

  //? Framework logout, not a [control-API] op: no client-side logout helper is
  //? exported by @luckystack/core/client or @luckystack/login, so this expires
  //? the session cookie over HTTP (mirrors socketInitializer.ts's server-emitted
  //? logout flow) and redirects. Redirects regardless of the request outcome —
  //? the session is already invalidated server-side once the request is sent.
  const signOut = useCallback(() => {
    void (async () => {
      await tryCatch(() => fetch(`${backendUrl}/auth/logout`, { method: 'POST', credentials: 'include' }));
      globalThis.location.href = loginPageUrl;
    })();
  }, []);

  const ctx = useMemo<WorkspacesCtx>(() => {
    const push = (v: WsView) => { if (v !== view) setNavStack((s) => [...s, view]); };
    const activeWorkspace = snap.workspaces.find((w) => w.id === snap.activeWorkspaceId) ?? snap.workspaces.at(0) ?? { id: '', name: 'Loading…', slug: '', ownerId: '', role: 'member' as const };
    return {
      view,
      navigate: (v) => { void navigate(pathForView(v)); },
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
      suggestions: activeSuggestions,
      dismissSuggestion: (id) => { setLocalSuggestionsDismissed((prev) => [...prev, id]); },
      acceptSuggestion: (id) => {
        control('accept-suggestion', { suggestionId: id }, {});
        setLocalSuggestionsDismissed((prev) => [...prev, id]);
      },
      notifications: snap.notifications,
      unreadNotifications: snap.notifications.filter((n) => !n.read).length,
      markNotificationRead: (id) => { control('mark-read', { notificationId: id }, {}); },
      markAllNotificationsRead: () => { control('mark-read', { all: true }, {}); },
      currentUser,
      sshKeys,
      sshUserId,
      addSshKey,
      removeSshKey,
      aiOpen,
      toggleAi: () => { setAiOpen((o) => !o); },
      chat,
      sendChat,
      workspaces: snap.workspaces,
      activeWorkspace,
      setActiveWorkspace: (id) => { setWantWorkspaceId(id); setLoading(true); },
      createWorkspace: (name) => { control('create-workspace', {}, { name }); },
      renameWorkspace: (name) => { control('rename-workspace', {}, { name }); },
      deleteWorkspace: () => {
        control('delete-workspace', {}, {});
        setWantWorkspaceId(undefined);
        setLoading(true);
      },
      saveGitlab: (baseUrl, token) => {
        control('gitlab-settings', {}, token ? { baseUrl, token } : { baseUrl });
      },
      permRoles: snap.roles,
      togglePerm: (ri, ci) => {
        const role = snap.roles[ri];
        if (!role || role.locked === true) return;
        const perms = role.perms.map((v, j) => (j === ci ? !v : v));
        setSnap((s) => ({ ...s, roles: s.roles.map((r, i) => (i === ri ? { ...r, perms } : r)) }));
        control('role-update', { roleKey: role.key }, { perms });
      },
      addRole: (name) => {
        const key = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || `role-${String(snap.roles.length + 1)}`;
        const perms = (snap.roles[0]?.perms ?? []).map(() => false);
        setSnap((s) => ({ ...s, roles: [...s.roles, { key, name, perms }] }));
        control('role-create', {}, { key, label: name, perms });
      },
      memberRoles: Object.fromEntries(snap.members.map((m) => [m.id, m.role])),
      setMemberRole: (mid, role) => { control('change-role', { memberId: mid }, { roleKey: role }); },
      inviteMember: (email, roleKey) => { control('invite', {}, { email, roleKey }); },
      revokeInvite: (inviteId) => { control('revoke-invite', { inviteId }, {}); },
      removeMember: (memberId) => { control('remove-member', { memberId }, {}); },
      transferOwnership: (memberId) => { control('transfer-ownership', { memberId }, {}); },
      envVars: snap.envVars,
      saveEnvVar: (v) => { control('save-env', {}, { key: v.key, value: v.value, secret: v.secret }); },
      removeEnvVar: (id) => { control('remove-env', { envId: id }, {}); },
      integrationTools: snap.integrations,
      saveIntegrationTool: (t) => {
        const known = snap.integrations.some((x) => x.id === t.id);
        setSnap((s) => ({ ...s, integrations: known ? s.integrations.map((x) => (x.id === t.id ? t : x)) : [...s.integrations, t] }));
        control('save-integration', known ? { integrationId: t.id } : {}, { name: t.name, type: t.type, fields: t.fields, mcp: t.mcp });
      },
      removeIntegrationTool: (id) => {
        setSnap((s) => ({ ...s, integrations: s.integrations.filter((x) => x.id !== id) }));
        control('remove-integration', { integrationId: id }, {});
      },
      stageOverrides,
      moveTicket: (id, stage) => { setStageOverrides((prev) => ({ ...prev, [id]: stage })); },
      quickAdd: (input) => { control('quick-add', {}, { ...input }); },
      archiveTicket: (id) => { control('archive', { ticketId: id }, {}); },
      bulkMove: (ids, stageId) => { control('bulk-move', { ticketIds: ids }, { stageId }); },
      bulkStatus: (ids, status) => { control('bulk-status', { ticketIds: ids }, { status }); },
      bulkAssign: (ids, assigneeId) => { control('bulk-assign', { ticketIds: ids }, { assigneeId }); },
      bulkSprint: (ids, sprintId) => { control('bulk-sprint', { ticketIds: ids }, { sprintId }); },
      bulkArchive: (ids) => { control('bulk-archive', { ticketIds: ids }, {}); },
      toggleSkill: (id, on) => { control('skill-toggle', { sourceId: id }, { on }); },
      stageConfigs: snap.stageConfigs,
      saveStageConfig: (cfg) => { control('save-stage-config', { stageId: cfg.id }, { ...cfg }); },
      signOut,
      // live tenant data
      loading,
      refetch,
      tickets: snap.tickets,
      members: snap.members,
      membersById,
      ticketMembers: (ticket) => {
        const ids = [ticket.creatorId, ticket.assigneeId, ...ticket.viewers].filter((x): x is string => x !== undefined && x !== '');
        return [...new Set(ids)].map((id) => membersById[id]).filter((m): m is Member => m !== undefined);
      },
      stages: snap.stages,
      sprints: snap.sprints,
      budget: snap.budget,
      docs: snap.docs,
      skills: snap.skills,
      invites: snap.invites,
      activityEvents: snap.events,
    };
  }, [view, navStack, recent, openTabs, isMobile, theme, setTheme, activeSuggestions, navigate, currentUser, sshKeys, sshUserId, addSshKey, removeSshKey, aiOpen, chat, sendChat, snap, control, membersById, stageOverrides, loading, refetch, signOut]);

  return <WorkspacesContextProvider value={ctx}>{children}</WorkspacesContextProvider>;
}
