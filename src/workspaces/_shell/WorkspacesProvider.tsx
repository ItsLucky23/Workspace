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
  Member, MyInvite, NotificationItem, PermRole, PipelineStage, PipelineStageCfg, RepoInfo, SkillEntry, Sprint,
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
  repo: RepoInfo;
}
const EMPTY_SNAP: Snap = {
  workspaces: [], activeWorkspaceId: null, members: [], tickets: [], stages: [], sprints: [],
  suggestions: [], budget: null, docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [],
  notifications: [], stageConfigs: [], myInvites: [], notes: [], repo: { linked: false },
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
      //? Not logged in → go to the login page instead of leaking the onboarding UI
      //? (a logged-out visitor otherwise sees the "Create a workspace" form + only
      //? gets "you need to be logged in" after acting).
      if (res.status === 'error' && res.errorCode === 'auth.required') { globalThis.location.href = loginPageUrl; return; }
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

  //? Shared realtime reducer: UPSERT the broadcast ticket(s) by id (an archive is
  //? just an upsert with `archived:true` — the board/backlog derive visibility from
  //? it). Every ticket-mutation `_sync` event routes its delta through here.
  const mergeTickets = useCallback((incoming: Ticket[]) => {
    if (incoming.length === 0) return;
    setSnap((s) => {
      const byId = new Map(s.tickets.map((t) => [t.id, t]));
      for (const t of incoming) byId.set(t.id, t);
      return { ...s, tickets: [...byId.values()] };
    });
  }, []);

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

  //? archive / ticket-edit deltas → upsert the affected ticket(s). No refetch.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/archive', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/ticketEdit', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);

  //? bulk-* deltas → upsert the affected tickets (each its own event; shared reducer).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/bulkMove', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/bulkStatus', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/bulkAssign', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/bulkSprint', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/bulkArchive', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);

  //? add-comment delta → merge the new note into the ticket's thread (dedupe by id).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/addComment', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.note) return;
      const note = serverOutput.note;
      setSnap((s) => (s.notes.some((n) => n.id === note.id) ? s : { ...s, notes: [...s.notes, note] }));
    },
  }), [upsertSyncEventCallback]);

  //? sprint-create delta → merge the new sprint into the sprint list (dedupe by id).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/sprintCreate', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.sprint) return;
      const sprint = serverOutput.sprint;
      setSnap((s) => (s.sprints.some((sp) => sp.id === sprint.id) ? s : { ...s, sprints: [...s.sprints, sprint] }));
    },
  }), [upsertSyncEventCallback]);

  //? env-var deltas → upsert / drop by id (settings realtime; no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveEnv', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.envVar) return;
      const envVar = serverOutput.envVar;
      setSnap((s) => ({ ...s, envVars: s.envVars.some((e) => e.id === envVar.id) ? s.envVars.map((e) => (e.id === envVar.id ? envVar : e)) : [...s.envVars, envVar] }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/removeEnv', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const id = serverOutput.removedEnvId;
      setSnap((s) => ({ ...s, envVars: s.envVars.filter((e) => e.id !== id) }));
    },
  }), [upsertSyncEventCallback]);

  //? integration-tool deltas → upsert / drop by id (settings realtime; no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveIntegration', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.integration) return;
      const integration = serverOutput.integration;
      setSnap((s) => ({ ...s, integrations: s.integrations.some((x) => x.id === integration.id) ? s.integrations.map((x) => (x.id === integration.id ? integration : x)) : [...s.integrations, integration] }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/removeIntegration', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const id = serverOutput.removedIntegrationId;
      setSnap((s) => ({ ...s, integrations: s.integrations.filter((x) => x.id !== id) }));
    },
  }), [upsertSyncEventCallback]);

  //? role deltas → upsert by key (settings realtime; no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/roleCreate', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.role) return;
      const role = serverOutput.role;
      setSnap((s) => ({ ...s, roles: s.roles.some((r) => r.key === role.key) ? s.roles.map((r) => (r.key === role.key ? role : r)) : [...s.roles, role] }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/roleUpdate', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.role) return;
      const role = serverOutput.role;
      setSnap((s) => ({ ...s, roles: s.roles.some((r) => r.key === role.key) ? s.roles.map((r) => (r.key === role.key ? role : r)) : [...s.roles, role] }));
    },
  }), [upsertSyncEventCallback]);

  //? member deltas → update role in place / drop / ownership transfer (no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/changeRole', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const { memberId, role } = serverOutput;
      setSnap((s) => ({ ...s, members: s.members.map((m) => (m.id === memberId ? { ...m, role } : m)) }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/removeMember', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const id = serverOutput.removedMemberId;
      setSnap((s) => ({ ...s, members: s.members.filter((m) => m.id !== id) }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/transferOwnership', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const { newOwnerId, previousOwnerId } = serverOutput;
      setSnap((s) => ({
        ...s,
        members: s.members.map((m) => (m.id === newOwnerId ? { ...m, role: 'owner' } : (m.id === previousOwnerId ? { ...m, role: 'admin' } : m))),
        workspaces: s.workspaces.map((w) => (w.id === s.activeWorkspaceId ? { ...w, ownerId: newOwnerId } : w)),
      }));
    },
  }), [upsertSyncEventCallback]);

  //? invite deltas → upsert by id / drop on revoke (settings realtime; no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/invite', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.invite) return;
      const invite = serverOutput.invite;
      setSnap((s) => ({ ...s, invites: s.invites.some((i) => i.id === invite.id) ? s.invites.map((i) => (i.id === invite.id ? invite : i)) : [...s.invites, invite] }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/revokeInvite', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const id = serverOutput.revokedInviteId;
      setSnap((s) => ({ ...s, invites: s.invites.filter((i) => i.id !== id) }));
    },
  }), [upsertSyncEventCallback]);

  //? workspace rename / skill toggle / suggestion accept deltas (no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/renameWorkspace', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const { workspaceId, name } = serverOutput;
      setSnap((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === workspaceId ? { ...w, name } : w)) }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/skillToggle', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const { sourceId, on } = serverOutput;
      setSnap((s) => ({ ...s, skills: s.skills.map((sk) => (sk.id === sourceId ? { ...sk, on } : sk)) }));
    },
  }), [upsertSyncEventCallback]);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/acceptSuggestion', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const id = serverOutput.acceptedSuggestionId;
      setSnap((s) => ({ ...s, suggestions: s.suggestions.filter((sug) => sug.id !== id) }));
    },
  }), [upsertSyncEventCallback]);

  //? link-repo delta → set the workspace's repo status (register-flow step A).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/linkRepo', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.repo) return;
      const repo = serverOutput.repo;
      setSnap((s) => ({ ...s, repo }));
    },
  }), [upsertSyncEventCallback]);

  //? stage-config delta → upsert by id (pipeline settings realtime; no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveStageConfig', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.stageConfig) return;
      const cfg = serverOutput.stageConfig;
      setSnap((s) => ({ ...s, stageConfigs: s.stageConfigs.some((c) => c.id === cfg.id) ? s.stageConfigs.map((c) => (c.id === cfg.id ? cfg : c)) : [...s.stageConfigs, cfg] }));
    },
  }), [upsertSyncEventCallback]);

  //? Per-action REALTIME write: fire the op's `_sync` event to the workspace room;
  //? the merge-callback above updates the UI for everyone (no refetch).
  const quickAddApi = useCallback((input: { title: string; sprintId?: string; description?: string; labels?: string[]; assigneeId?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void syncRequest({
      name: 'workspaces/quickAdd', version: 'v1',
      data: {
        title: input.title,
        ...(input.sprintId ? { sprintId: input.sprintId } : {}),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.labels && input.labels.length > 0 ? { labels: input.labels } : {}),
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        clientRequestId: nextReqId(),
      },
      receiver: room,
    });
  }, [snap.activeWorkspaceId]);
  const sprintCreateApi = useCallback((sprintName: string) => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/sprintCreate', version: 'v1', data: { name: sprintName, active: false, clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);

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
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/acceptSuggestion', version: 'v1', data: { suggestionId: id, clientRequestId: nextReqId() }, receiver: room });
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
      renameWorkspace: (name) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/renameWorkspace', version: 'v1', data: { name, clientRequestId: nextReqId() }, receiver: room }); },
      deleteWorkspace: () => {
        afterWrite(apiRequest({ name: 'workspaces/deleteWorkspace', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', clientRequestId: nextReqId() } }));
        setWantWorkspaceId(undefined);
        setLoading(true);
      },
      saveGitlab: (baseUrl, token) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/gitlabSettings', version: 'v1', data: { baseUrl, ...(token ? { token } : {}), clientRequestId: nextReqId() }, receiver: room });
      },
      repo: snap.repo,
      linkRepo: (gitUrl, token) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/linkRepo', version: 'v1', data: { gitUrl, ...(token ? { token } : {}), clientRequestId: nextReqId() }, receiver: room });
      },
      permRoles: snap.roles,
      togglePerm: (ri, ci) => {
        const role = snap.roles[ri];
        if (!role || role.locked === true) return;
        const room = snap.activeWorkspaceId;
        const perms = role.perms.map((v, j) => (j === ci ? !v : v));
        if (room) void syncRequest({ name: 'workspaces/roleUpdate', version: 'v1', data: { roleKey: role.key, perms, clientRequestId: nextReqId() }, receiver: room });
      },
      addRole: (name) => {
        const room = snap.activeWorkspaceId;
        const key = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || `role-${String(snap.roles.length + 1)}`;
        const perms = (snap.roles[0]?.perms ?? []).map(() => false);
        if (room) void syncRequest({ name: 'workspaces/roleCreate', version: 'v1', data: { key, label: name, perms, clientRequestId: nextReqId() }, receiver: room });
      },
      memberRoles: Object.fromEntries(snap.members.map((m) => [m.id, m.role])),
      setMemberRole: (mid, role) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/changeRole', version: 'v1', data: { memberId: mid, roleKey: role, clientRequestId: nextReqId() }, receiver: room }); },
      inviteMember: (email, roleKey) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/invite', version: 'v1', data: { email, roleKey, clientRequestId: nextReqId() }, receiver: room }); },
      revokeInvite: (inviteId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/revokeInvite', version: 'v1', data: { inviteId, clientRequestId: nextReqId() }, receiver: room }); },
      removeMember: (memberId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/removeMember', version: 'v1', data: { memberId, clientRequestId: nextReqId() }, receiver: room }); },
      transferOwnership: (memberId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/transferOwnership', version: 'v1', data: { memberId, clientRequestId: nextReqId() }, receiver: room }); },
      envVars: snap.envVars,
      saveEnvVar: (v) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/saveEnv', version: 'v1', data: { key: v.key, value: v.value, secret: v.secret, clientRequestId: nextReqId() }, receiver: room }); },
      removeEnvVar: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/removeEnv', version: 'v1', data: { envId: id, clientRequestId: nextReqId() }, receiver: room }); },
      integrationTools: snap.integrations,
      saveIntegrationTool: (t) => {
        const room = snap.activeWorkspaceId;
        const known = snap.integrations.some((x) => x.id === t.id);
        if (room) void syncRequest({ name: 'workspaces/saveIntegration', version: 'v1', data: { ...(known ? { integrationId: t.id } : {}), name: t.name, type: t.type, fields: t.fields, mcp: t.mcp, clientRequestId: nextReqId() }, receiver: room });
      },
      removeIntegrationTool: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/removeIntegration', version: 'v1', data: { integrationId: id, clientRequestId: nextReqId() }, receiver: room }); },
      stageOverrides,
      moveTicket: (id, stage) => { setStageOverrides((prev) => ({ ...prev, [id]: stage })); },
      quickAdd: quickAddApi,
      //? Realtime writes — per-action `_sync` event → delta broadcast → client merge.
      editTicket: (id, patch) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/ticketEdit', version: 'v1', data: { ticketId: id, ...patch, clientRequestId: nextReqId() }, receiver: room }); },
      addComment: (ticketId, body) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/addComment', version: 'v1', data: { ticketId, body, clientRequestId: nextReqId() }, receiver: room }); },
      archiveTicket: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/archive', version: 'v1', data: { ticketId: id, clientRequestId: nextReqId() }, receiver: room }); },
      bulkMove: (ids, stageId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkMove', version: 'v1', data: { ticketIds: ids, stageId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkStatus: (ids, status) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkStatus', version: 'v1', data: { ticketIds: ids, status, clientRequestId: nextReqId() }, receiver: room }); },
      bulkAssign: (ids, assigneeId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkAssign', version: 'v1', data: { ticketIds: ids, assigneeId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkSprint: (ids, sprintId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkSprint', version: 'v1', data: { ticketIds: ids, sprintId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkArchive: (ids) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkArchive', version: 'v1', data: { ticketIds: ids, clientRequestId: nextReqId() }, receiver: room }); },
      toggleSkill: (id, on) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/skillToggle', version: 'v1', data: { sourceId: id, on, clientRequestId: nextReqId() }, receiver: room }); },
      stageConfigs: snap.stageConfigs,
      saveStageConfig: (cfg) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/saveStageConfig', version: 'v1', data: { stageId: cfg.id, cfg, clientRequestId: nextReqId() }, receiver: room }); },
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
