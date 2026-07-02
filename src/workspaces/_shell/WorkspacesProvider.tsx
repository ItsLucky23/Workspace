//? Workspaces — self-contained app state + navigation provider.
//?
//? Fetches the tenant-scoped `workspaces/snapshot` (the `useWorkspaceData()` seam,
//? MIGRATION §4) and exposes it + the navigation helpers via `useWorkspaces()`.
//? Navigation drives REAL framework routes; the active `view` is derived from the
//? URL. Mutations go through PER-ACTION typed `_api` routes (`workspaces/quickAdd`,
//? `workspaces/changeRole`, …) — each fully typed via the generated type-map — then
//? refetch the snapshot (Fase-0 split; ADR 0005). UI-only state (open tabs, AI panel,
//? chat, ssh keys) stays client-side.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { apiRequest, tryCatch, useSession, useTheme } from '@luckystack/core/client';

import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

import { backendUrl, loginPageUrl } from '../../../config';
import type { SessionLayout } from '../../../config';
import { INITIAL_CHAT, SSH_KEYS } from '../_data/seed';
import type {
  ActivityEvent, AiSuggestion, ChatMessage, EnvVar, InfoDoc, IntegrationTool, InviteEntry,
  Member, MyInvite, NotificationItem, PermRole, PipelineStage, PipelineStageCfg, SkillEntry, Sprint,
  SshKeyEntry, Ticket, TicketNote, Workspace, WorkspaceBudget,
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
  myInvites: MyInvite[];
  notes: TicketNote[];
}
const EMPTY_SNAP: Snap = {
  workspaces: [], activeWorkspaceId: null, members: [], tickets: [], stages: [], sprints: [],
  suggestions: [], budget: null, docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [],
  notifications: [], stageConfigs: [], myInvites: [], notes: [],
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

//? A globally-unique client request id for control-API idempotency. MUST be unique
//? across users, tabs and reloads: the Conductor dedups on it, so a reused id (the
//? old reload-resetting counter did this) makes a real write look like a duplicate
//? re-send and get silently dropped. `randomUUID` is available in every secure
//? context (https + localhost/127.0.0.1).
function nextReqId(): string { return globalThis.crypto.randomUUID(); }
//? A local counter for UI-only ids (chat messages) — never sent to the server.
let reqCounter = 0;

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

  //? ----- Realtime (milestone 1) -----------------------------------------------
  //? Writes go through per-action `_sync` events that broadcast their delta to the
  //? workspace room; every client (incl. the sender) MERGES the delta into local
  //? state via `upsertSyncEventCallback` — no refetch. The initial load stays a
  //? snapshot `apiRequest` (above); after that it's live deltas.
  const { upsertSyncEventCallback } = useSyncEvents();

  //? Join the active workspace's realtime room (room code = workspaceId) so our
  //? writes broadcast here and other members' writes arrive live. Re-join on switch.
  useEffect(() => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void joinRoom(room);
    return () => { void leaveRoom(room); };
  }, [snap.activeWorkspaceId]);

  //? quick-add delta → merge the new ticket (dedupe by id, since the sender also
  //? receives its own broadcast). No refetch.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/quickAdd', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.ticket) return;
      const ticket = serverOutput.ticket;
      setSnap((s) => (s.tickets.some((t) => t.id === ticket.id) ? s : { ...s, tickets: [...s.tickets, ticket] }));
    },
  }), [upsertSyncEventCallback]);

  //? Per-action REALTIME write: fire the op's `_sync` event to the workspace room;
  //? the merge-callback above updates the UI for everyone (no refetch).
  const quickAddApi = useCallback((input: { title: string; sprintId?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void syncRequest({ name: 'workspaces/quickAdd', version: 'v1', data: { title: input.title, ...(input.sprintId ? { sprintId: input.sprintId } : {}), clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);
  const sprintCreateApi = useCallback((sprintName: string) => {
    void (async () => {
      await apiRequest({ name: 'workspaces/sprintCreate', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', name: sprintName, active: false, clientRequestId: nextReqId() } });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);

  //? Fire-and-refetch for the typed per-action writes: takes the (already typed)
  //? `apiRequest(...)` promise and refetches the snapshot once it settles. Takes a
  //? Promise (NOT a route name), so it never erases apiRequest's route/version
  //? inference — the literal `name:` at each call site keeps the payload fully typed.
  const afterWrite = useCallback((p: Promise<unknown>) => { void p.then(() => { refetch(); }); }, [refetch]);

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
    const lastNav = navStack.at(-1);
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
      canGoBack: lastNav !== undefined,
      backLabel: lastNav === undefined ? null : viewLabel(lastNav),
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
        afterWrite(apiRequest({ name: 'workspaces/acceptSuggestion', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', suggestionId: id, clientRequestId: nextReqId() } }));
        setLocalSuggestionsDismissed((prev) => [...prev, id]);
      },
      notifications: snap.notifications,
      unreadNotifications: snap.notifications.filter((n) => !n.read).length,
      markNotificationRead: (id) => { afterWrite(apiRequest({ name: 'workspaces/markRead', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', notificationId: id, clientRequestId: nextReqId() } })); },
      markAllNotificationsRead: () => { afterWrite(apiRequest({ name: 'workspaces/markRead', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', all: true, clientRequestId: nextReqId() } })); },
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
      createWorkspace: (name) => { afterWrite(apiRequest({ name: 'workspaces/createWorkspace', version: 'v1', data: { name, clientRequestId: nextReqId() } })); },
      myInvites: snap.myInvites,
      acceptInvite: (token) => { afterWrite(apiRequest({ name: 'workspaces/acceptInvite', version: 'v1', data: { inviteToken: token, clientRequestId: nextReqId() } })); },
      sprintCreate: sprintCreateApi,
      renameWorkspace: (name) => { afterWrite(apiRequest({ name: 'workspaces/renameWorkspace', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', name, clientRequestId: nextReqId() } })); },
      deleteWorkspace: () => {
        afterWrite(apiRequest({ name: 'workspaces/deleteWorkspace', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', clientRequestId: nextReqId() } }));
        setWantWorkspaceId(undefined);
        setLoading(true);
      },
      saveGitlab: (baseUrl, token) => {
        afterWrite(apiRequest({ name: 'workspaces/gitlabSettings', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', baseUrl, ...(token ? { token } : {}), clientRequestId: nextReqId() } }));
      },
      permRoles: snap.roles,
      togglePerm: (ri, ci) => {
        const role = snap.roles[ri];
        if (!role || role.locked === true) return;
        const perms = role.perms.map((v, j) => (j === ci ? !v : v));
        setSnap((s) => ({ ...s, roles: s.roles.map((r, i) => (i === ri ? { ...r, perms } : r)) }));
        afterWrite(apiRequest({ name: 'workspaces/roleUpdate', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', roleKey: role.key, perms, clientRequestId: nextReqId() } }));
      },
      addRole: (name) => {
        const key = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || `role-${String(snap.roles.length + 1)}`;
        const perms = (snap.roles[0]?.perms ?? []).map(() => false);
        setSnap((s) => ({ ...s, roles: [...s.roles, { key, name, perms }] }));
        afterWrite(apiRequest({ name: 'workspaces/roleCreate', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', key, label: name, perms, clientRequestId: nextReqId() } }));
      },
      memberRoles: Object.fromEntries(snap.members.map((m) => [m.id, m.role])),
      setMemberRole: (mid, role) => { afterWrite(apiRequest({ name: 'workspaces/changeRole', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', memberId: mid, roleKey: role, clientRequestId: nextReqId() } })); },
      inviteMember: (email, roleKey) => { afterWrite(apiRequest({ name: 'workspaces/invite', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', email, roleKey, clientRequestId: nextReqId() } })); },
      revokeInvite: (inviteId) => { afterWrite(apiRequest({ name: 'workspaces/revokeInvite', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', inviteId, clientRequestId: nextReqId() } })); },
      removeMember: (memberId) => { afterWrite(apiRequest({ name: 'workspaces/removeMember', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', memberId, clientRequestId: nextReqId() } })); },
      transferOwnership: (memberId) => { afterWrite(apiRequest({ name: 'workspaces/transferOwnership', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', memberId, clientRequestId: nextReqId() } })); },
      envVars: snap.envVars,
      saveEnvVar: (v) => { afterWrite(apiRequest({ name: 'workspaces/saveEnv', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', key: v.key, value: v.value, secret: v.secret, clientRequestId: nextReqId() } })); },
      removeEnvVar: (id) => { afterWrite(apiRequest({ name: 'workspaces/removeEnv', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', envId: id, clientRequestId: nextReqId() } })); },
      integrationTools: snap.integrations,
      saveIntegrationTool: (t) => {
        const known = snap.integrations.some((x) => x.id === t.id);
        setSnap((s) => ({ ...s, integrations: known ? s.integrations.map((x) => (x.id === t.id ? t : x)) : [...s.integrations, t] }));
        afterWrite(apiRequest({ name: 'workspaces/saveIntegration', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ...(known ? { integrationId: t.id } : {}), name: t.name, type: t.type, fields: t.fields, mcp: t.mcp, clientRequestId: nextReqId() } }));
      },
      removeIntegrationTool: (id) => {
        setSnap((s) => ({ ...s, integrations: s.integrations.filter((x) => x.id !== id) }));
        afterWrite(apiRequest({ name: 'workspaces/removeIntegration', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', integrationId: id, clientRequestId: nextReqId() } }));
      },
      stageOverrides,
      moveTicket: (id, stage) => { setStageOverrides((prev) => ({ ...prev, [id]: stage })); },
      quickAdd: quickAddApi,
      editTicket: (id, patch) => { afterWrite(apiRequest({ name: 'workspaces/ticketEdit', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketId: id, ...patch, clientRequestId: nextReqId() } })); },
      addComment: (ticketId, body) => { afterWrite(apiRequest({ name: 'workspaces/addComment', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketId, body, clientRequestId: nextReqId() } })); },
      //? Board/ticket writes — each on its OWN typed `_api` route (Fase-0 split).
      archiveTicket: (id) => { void (async () => { await apiRequest({ name: 'workspaces/archive', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketId: id, clientRequestId: nextReqId() } }); refetch(); })(); },
      bulkMove: (ids, stageId) => { void (async () => { await apiRequest({ name: 'workspaces/bulkMove', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketIds: ids, stageId, clientRequestId: nextReqId() } }); refetch(); })(); },
      bulkStatus: (ids, status) => { void (async () => { await apiRequest({ name: 'workspaces/bulkStatus', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketIds: ids, status, clientRequestId: nextReqId() } }); refetch(); })(); },
      bulkAssign: (ids, assigneeId) => { void (async () => { await apiRequest({ name: 'workspaces/bulkAssign', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketIds: ids, assigneeId, clientRequestId: nextReqId() } }); refetch(); })(); },
      bulkSprint: (ids, sprintId) => { void (async () => { await apiRequest({ name: 'workspaces/bulkSprint', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketIds: ids, sprintId, clientRequestId: nextReqId() } }); refetch(); })(); },
      bulkArchive: (ids) => { void (async () => { await apiRequest({ name: 'workspaces/bulkArchive', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', ticketIds: ids, clientRequestId: nextReqId() } }); refetch(); })(); },
      toggleSkill: (id, on) => { afterWrite(apiRequest({ name: 'workspaces/skillToggle', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', sourceId: id, on, clientRequestId: nextReqId() } })); },
      stageConfigs: snap.stageConfigs,
      saveStageConfig: (cfg) => { afterWrite(apiRequest({ name: 'workspaces/saveStageConfig', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', stageId: cfg.id, cfg, clientRequestId: nextReqId() } })); },
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
      ticketNotes: snap.notes,
    };
  }, [view, navStack, recent, openTabs, isMobile, theme, setTheme, activeSuggestions, navigate, currentUser, sshKeys, sshUserId, addSshKey, removeSshKey, aiOpen, chat, sendChat, snap, afterWrite, quickAddApi, sprintCreateApi, membersById, stageOverrides, loading, refetch, signOut]);

  return <WorkspacesContextProvider value={ctx}>{children}</WorkspacesContextProvider>;
}
