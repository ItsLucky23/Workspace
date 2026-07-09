//? Workspaces — self-contained app state + navigation provider.
//?
//? Fetches the tenant-scoped `workspaces/snapshot` (the `useWorkspaceData()` seam,
//? MIGRATION §4) and exposes it + the navigation helpers via `useWorkspaces()`.
//? Navigation drives REAL framework routes; the active `view` is derived from the
//? URL. Mutations go through PER-ACTION typed `_api` routes (`workspaces/quickAdd`,
//? `workspaces/changeRole`, …) — each fully typed via the generated type-map — then
//? refetch the snapshot (Fase-0 split; ADR 0005). UI-only state (open tabs, AI panel,
//? chat, ssh keys) stays client-side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { apiRequest, tryCatch, useSession, useTheme, useTranslator } from '@luckystack/core/client';

import { useSocketStatus } from 'src/_providers/socketStatusProvider';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

import { backendUrl, loginPageUrl } from '../../../config';
import type { SessionLayout } from '../../../config';
import { INITIAL_CHAT, SSH_KEYS } from '../_data/seed';
import type {
  ActivityEvent, AiSuggestion, ChatMessage, ChatPlan, ChatProposal, EnvVar, GitConfig, InfoDoc, IntegrationTool, InviteEntry,
  Member, MrActionFields, MrActionKind, MrActionResult, MrView, MyInvite, NotificationItem, PermRole, PipelineStage,
  PipelineStageCfg, RagIndexStatus, RepoInfo, SkillEntry, Sprint,
  SshKeyEntry, Ticket, TicketNote, TicketPriority, Workspace, WorkspaceBudget, WorkspaceUsage, WorkspaceInsights, WorkspaceAnalytics, WorkspaceTrigger,
  StudioBrief, StudioArtifact, StudioBrandLibrary, AiRun, DesignArtifact, InterviewFinding, TicketArtifactLink,
  ProjectSummary, ServiceSummary, EnvironmentSummary, BuildArtifactSummary, AnswerQueueItem, ContentSnapshot,
} from '../_data/types';
import { isTicketView, WorkspacesContextProvider, type WorkspacesCtx, type WsView } from './WorkspacesContext';

const BASE = '/workspaces';

interface Snap {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  //? Multi-project (ADR 0035): the workspace's projects + selected one + its services.
  projects: ProjectSummary[];
  activeProjectId: string | null;
  services: ServiceSummary[];
  //? The active project's persistent environments (ADR 0037).
  environments: EnvironmentSummary[];
  //? The active project's downloadable build exports (ADR 0038).
  buildArtifacts: BuildArtifactSummary[];
  //? Greenfield scaffolding (ADR 0046): the curated stack templates.
  templates: { key: string; label: string; description: string }[];
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
  aiOverrides: { feature: string; providerId: string }[];
  customTasks: { id: string; name: string; promptTemplate: string; lastOutput: string | null; lastRunAt: number | null }[];
  outputTemplates: { id: string; name: string; format: string; watermarkPosition: string }[];
  myInvites: MyInvite[];
  notes: TicketNote[];
  repo: RepoInfo;
  gitConfig: GitConfig;
  workspacePaused: boolean;
  usage: WorkspaceUsage;
  insights: WorkspaceInsights;
  analytics: WorkspaceAnalytics;
  answerQueue: AnswerQueueItem[];
  content: ContentSnapshot;
  triggers: WorkspaceTrigger[];
  agentRoles: { key: string; label: string; description: string; mutates: boolean }[];
  aiRuns: AiRun[];
  studioBriefs: StudioBrief[];
  studioArtifacts: StudioArtifact[];
  studioBrand: StudioBrandLibrary | null;
  designArtifacts: DesignArtifact[];
  interviewFindings: InterviewFinding[];
  ticketArtifactLinks: TicketArtifactLink[];
}
//? The `gitConfig` here is just the pre-load placeholder (the server always sends the real
//? one in the snapshot); the canonical default lives in server/git/branchStrategy.ts.
const EMPTY_SNAP: Snap = {
  workspaces: [], activeWorkspaceId: null, projects: [], activeProjectId: null, services: [], environments: [], buildArtifacts: [],
  templates: [],
  members: [], tickets: [], stages: [], sprints: [],
  suggestions: [], budget: null, docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [],
  notifications: [], stageConfigs: [], aiOverrides: [], customTasks: [], outputTemplates: [], myInvites: [], notes: [], repo: { linked: false },
  gitConfig: { branchStrategy: 'ticket-prefix', defaultBranchType: 'feature', branchTemplate: '{{type}}/{{key}}-{{slug}}', pushPolicy: 'local-only', targetBranch: 'main', protectedBranches: ['main', 'master'], commitSigning: false },
  workspacePaused: false,
  usage: { byTicket: [], activity: [], totalTokens: 0, totalTurns: 0 },
  insights: { avgCycleHours: 0, throughput7d: 0, avgTokensPerTicket: 0, doneCount: 0, openCount: 0 },
  analytics: { cycleP50Hours: 0, cycleP85Hours: 0, throughputByWeek: [], stuckCount: 0, doneCount: 0, openCount: 0, tokensByLabel: [], totalTokens: 0 },
  answerQueue: [],
  content: { pieces: [], mediaBudget: { enabled: false, capCents: 0, spentCents: 0, alertPct: 80, overAlert: false }, analytics: { totalPieces: 0, doneCount: 0, publishedCount: 0, byStage: [], byFormat: [], totalCostCents: 0, costByFeature: [] }, styles: [], references: [], channels: [], publishTargets: [], mediaCosts: [], mediaModels: [] },
  triggers: [],
  agentRoles: [],
  aiRuns: [],
  studioBriefs: [],
  studioArtifacts: [],
  studioBrand: null,
  designArtifacts: [],
  interviewFindings: [],
  ticketArtifactLinks: [],
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
  sources: 'Sources', pipeline: 'Pipeline', usage: 'Usage', studio: 'Studio',
  designer: 'Designer', interviewer: 'Interviewer', marketing: 'Marketing', scheduled: 'Scheduled',
  content: 'Content', settings: 'Account', workspace: 'Workspace',
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
  //? Multi-project (ADR 0035): the client-selected project (mirrors wantWorkspaceId). A
  //? stale id from another workspace is harmless — the server validates + falls back to
  //? the first project. Cleared on workspace switch.
  const [wantProjectId, setWantProjectId] = useState<string | undefined>();
  //? Realtime side-channels not part of the snapshot: the RAG code-index status
  //? (07 §D) and the built-in MR review views keyed by their source branch
  //? (BUILTIN_MR_REVIEW). Both are hydrated by their `_sync` delta callbacks below.
  const [ragIndex, setRagIndex] = useState<RagIndexStatus | null>(null);
  const [mrByBranch, setMrByBranch] = useState<Record<string, MrView>>({});
  //? Realtime presence (#17): userId → who they're viewing + when last seen. Fed by the
  //? `workspaces/presence` relay; a `tick` state prunes stale entries so a crashed viewer drops.
  const [presence, setPresence] = useState<Record<string, { ticketKey: string; lastSeen: number; claiming?: boolean }>>({});
  const [, setPresenceTick] = useState(0);

  const refetch = useCallback(() => {
    void (async () => {
      const res = await apiRequest({ name: 'workspaces/snapshot', version: 'v1', data: { workspaceId: wantWorkspaceId, projectId: wantProjectId } });
      //? Not logged in → go to the login page instead of leaking the onboarding UI
      //? (a logged-out visitor otherwise sees the "Create a workspace" form + only
      //? gets "you need to be logged in" after acting).
      if (res.status === 'error' && res.errorCode === 'auth.required') { globalThis.location.href = loginPageUrl; return; }
      if (res.status === 'success') setSnap(res.result);
      setLoading(false);
    })();
  }, [wantWorkspaceId, wantProjectId]);
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

  //? Reconnect healing (robustness): a client that briefly drops misses every delta broadcast during the
  //? gap AND is no longer in the room. When the socket transitions BACK to CONNECTED from a
  //? disconnected/reconnecting state, re-join the room and refetch the full snapshot so nothing stays
  //? stale. The initial STARTUP→CONNECTED is skipped (the mount refetch already ran).
  const { socketStatus } = useSocketStatus();
  const socketStatusValue = socketStatus.self.status;
  const prevSocketStatus = useRef(socketStatusValue);
  useEffect(() => {
    const prev = prevSocketStatus.current;
    prevSocketStatus.current = socketStatusValue;
    if (socketStatusValue === 'CONNECTED' && prev !== 'CONNECTED' && prev !== 'STARTUP') {
      const room = snap.activeWorkspaceId;
      if (room) void joinRoom(room);
      refetch();
    }
  }, [socketStatusValue, snap.activeWorkspaceId, refetch]);

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
  //? answer-input (#17): the parked ticket's banner clears → merge the updated ticket.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/answerInput', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);
  //? presence (#17): update who's viewing what. A `viewing:false` (clean leave) removes the entry;
  //? otherwise stamp lastSeen. Stale entries are pruned by the ticker below.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/presence', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const p = serverOutput.presence;
      setPresence((prev) => {
        if (p.viewing) return { ...prev, [p.userId]: { ticketKey: p.ticketKey, lastSeen: Date.now(), claiming: p.claiming } };
        //? Clean leave → drop this user's entry (only if it was on this ticket). Rebuild without
        //? the key (no `delete`) so the reducer stays pure.
        if (prev[p.userId]?.ticketKey !== p.ticketKey) return prev;
        return Object.fromEntries(Object.entries(prev).filter(([uid]) => uid !== p.userId));
      });
    },
  }), [upsertSyncEventCallback]);
  //? Prune presence entries older than 25s (a viewer whose heartbeat stopped) + tick a re-render.
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - 25_000;
      setPresence((prev) => {
        const next: typeof prev = {};
        let changed = false;
        for (const [uid, v] of Object.entries(prev)) { if (v.lastSeen >= cutoff) next[uid] = v; else changed = true; }
        return changed ? next : prev;
      });
      setPresenceTick((n) => n + 1);
    }, 8000);
    return () => { clearInterval(t); };
  }, []);

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

  //? module-gating delta → replace the active workspace's enabledSections (nav re-renders).
  //? Room-scoped broadcast, so it applies to the active workspace.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveSections', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const enabledSections = serverOutput.enabledSections;
      setSnap((s) => (s.activeWorkspaceId ? { ...s, workspaces: s.workspaces.map((w) => (w.id === s.activeWorkspaceId ? { ...w, enabledSections } : w)) } : s));
    },
  }), [upsertSyncEventCallback]);

  //? A4 — autonomy-level delta → replace it on the active workspace.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveAutonomy', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const autonomyLevel = serverOutput.autonomyLevel;
      setSnap((s) => (s.activeWorkspaceId ? { ...s, workspaces: s.workspaces.map((w) => (w.id === s.activeWorkspaceId ? { ...w, autonomyLevel } : w)) } : s));
    },
  }), [upsertSyncEventCallback]);

  //? P1 — AI provider-override delta → replace the override map.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveAiProvider', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const aiOverrides = serverOutput.aiOverrides;
      setSnap((s) => ({ ...s, aiOverrides }));
    },
  }), [upsertSyncEventCallback]);

  //? Q4 — workspace AI-instruction delta → replace it on the active workspace.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveAiInstruction', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const { aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl } = serverOutput;
      setSnap((s) => (s.activeWorkspaceId ? { ...s, workspaces: s.workspaces.map((w) => (w.id === s.activeWorkspaceId ? { ...w, aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl } : w)) } : s));
    },
  }), [upsertSyncEventCallback]);

  //? content-asset delta → upsert the asset by id into its piece (live media queue/timer state:
  //? queued → processing → ready). Room-scoped; merges into the matching content piece.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/contentAssetDelta', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.asset) return;
      const asset = serverOutput.asset;
      const pieceId = serverOutput.contentProjectId;
      setSnap((s) => ({
        ...s,
        content: {
          ...s.content,
          pieces: s.content.pieces.map((p) => (p.id === pieceId
            ? { ...p, assets: p.assets.some((a) => a.id === asset.id) ? p.assets.map((a) => (a.id === asset.id ? asset : a)) : [...p.assets, asset] }
            : p)),
        },
      }));
    },
  }), [upsertSyncEventCallback]);

  //? content-dirty nudge → debounced full refetch (coalesces a burst of content ops into one refetch).
  //? The catch-all that syncs structural content changes (piece create/advance/archive, script gen,
  //? settings) to EVERY member — the fine-grained per-asset timer state still flows via contentAssetDelta.
  const dirtyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/contentDirty', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      if (dirtyTimer.current) clearTimeout(dirtyTimer.current);
      dirtyTimer.current = setTimeout(() => { refetch(); }, 400);
    },
  }), [upsertSyncEventCallback, refetch]);
  //? Clear the debounce timer on unmount.
  useEffect(() => () => { if (dirtyTimer.current) clearTimeout(dirtyTimer.current); }, []);

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
      //? An InfoSource id may be a skill (SkillEntry.on) or a context-doc (aiEditable) —
      //? both back onto `enabled`, so update whichever list holds it.
      setSnap((s) => ({
        ...s,
        skills: s.skills.map((sk) => (sk.id === sourceId ? { ...sk, on } : sk)),
        docs: s.docs.map((d) => (d.id === sourceId ? { ...d, aiEditable: on } : d)),
      }));
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

  //? scan-docs delta → replace the workspace's context-doc list (docs-init).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/scanDocs', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const docs = serverOutput.docs;
      setSnap((s) => ({ ...s, docs }));
    },
  }), [upsertSyncEventCallback]);

  //? K2 — uploaded-doc delta → replace the context-doc list (same shape as scan-docs).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/addInfoDoc', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const docs = serverOutput.docs;
      setSnap((s) => ({ ...s, docs }));
    },
  }), [upsertSyncEventCallback]);

  //? scan-index delta → store the latest RAG code-index status (07 §D). Broadcast to the
  //? whole room so every client shows the fresh files/chunks/commit/embedder.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/scanIndex', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      setRagIndex(serverOutput.ragIndex);
    },
  }), [upsertSyncEventCallback]);

  //? mr-action delta → upsert the fresh MR view keyed by its source branch
  //? (BUILTIN_MR_REVIEW). The broadcast reaches everyone in the room; a client keys by
  //? branch so a review it isn't looking at doesn't clobber the panel it is. A null `mr`
  //? (ticket has no branch) carries no key, so nothing is stored.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/mrAction', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.mr) return;
      const mr = serverOutput.mr;
      setMrByBranch((m) => ({ ...m, [mr.sourceBranch]: mr }));
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

  //? git-config delta → replace snap.gitConfig (workspace settings realtime; no refetch).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/saveGitConfig', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const gitConfig = serverOutput.gitConfig;
      setSnap((s) => ({ ...s, gitConfig }));
    },
  }), [upsertSyncEventCallback]);

  //? agent-control delta → reflect pause-all/resume-all on snap.workspacePaused live (ticket-
  //? scoped pause/resume/kill broadcast their own ticket delta via the bulkMove callback).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/agentControl', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !('workspacePaused' in serverOutput)) return;
      const workspacePaused = serverOutput.workspacePaused;
      setSnap((s) => ({ ...s, workspacePaused }));
    },
  }), [upsertSyncEventCallback]);

  //? Per-action REALTIME write: fire the op's `_sync` event to the workspace room;
  //? the merge-callback above updates the UI for everyone (no refetch).
  const quickAddApi = useCallback((input: { title: string; sprintId?: string; description?: string; labels?: string[]; assigneeId?: string; priority?: TicketPriority; startWithAi?: boolean }) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void syncRequest({
      name: 'workspaces/quickAdd', version: 'v1',
      data: {
        title: input.title,
        //? Multi-project (ADR 0035): the ticket lands in the active project.
        ...(snap.activeProjectId ? { projectId: snap.activeProjectId } : {}),
        ...(input.sprintId ? { sprintId: input.sprintId } : {}),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.labels && input.labels.length > 0 ? { labels: input.labels } : {}),
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        ...(input.priority && input.priority !== 'normal' ? { priority: input.priority } : {}),
        ...(input.startWithAi === true ? { startWithAi: true } : {}),
        clientRequestId: nextReqId(),
      },
      receiver: room,
    });
  }, [snap.activeWorkspaceId, snap.activeProjectId]);
  //? Multi-project / multi-service admin writes (ADR 0035) → the projectAdmin `_sync`
  //? route; the client refetches on success (these change rarely). project-create
  //? switches to the new project once the refetch lands it.
  const createProjectApi = useCallback((input: { name: string; gitUrl?: string; gitlabPath?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || input.name.trim().length === 0) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'project-create', name: input.name, ...(input.gitUrl ? { gitUrl: input.gitUrl } : {}), ...(input.gitlabPath ? { gitlabPath: input.gitlabPath } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  //? Greenfield scaffolding (ADR 0046): create a fresh project from a curated stack template.
  const createFromTemplateApi = useCallback((input: { name: string; template: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || input.name.trim().length === 0) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'project-from-template', name: input.name, template: input.template, clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  const createServiceApi = useCallback((input: { projectId: string; name: string; path?: string; buildCmd?: string; deployUnit?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || input.name.trim().length === 0) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'service-create', projectId: input.projectId, name: input.name, ...(input.path ? { path: input.path } : {}), ...(input.buildCmd ? { buildCmd: input.buildCmd } : {}), ...(input.deployUnit ? { deployUnit: input.deployUnit } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  const deleteServiceApi = useCallback((serviceId: string) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'service-delete', serviceId, clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  //? Per-project forge connection (ADR 0036): GitLab OR GitHub for a specific project.
  const connectForgeApi = useCallback((input: { projectId: string; mode: 'gitlab' | 'github'; baseUrl?: string; token?: string; repoPath?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'forge-connect', projectId: input.projectId, mode: input.mode, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}), ...(input.token ? { token: input.token } : {}), ...(input.repoPath ? { repoPath: input.repoPath } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  //? Environments (ADR 0037): deploy the active project (or a service) to a dev/staging/prod env,
  //? or tear one down. Deploy is slow (container launch + readiness) → refetch after it settles.
  const deployEnvApi = useCallback((input: { kind: string; serviceId?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || !snap.activeProjectId) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-deploy', projectId: snap.activeProjectId ?? '', kind: input.kind, ...(input.serviceId ? { serviceId: input.serviceId } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, snap.activeProjectId, refetch]);
  const teardownEnvApi = useCallback((envId: string) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-teardown', envId, clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  //? Promote up the dev→staging→prod ladder (ADR 0038); prod needs `approved`. Slow → refetch after.
  const promoteEnvApi = useCallback((input: { fromKind: string; approved?: boolean }) => {
    const room = snap.activeWorkspaceId;
    if (!room || !snap.activeProjectId) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-promote', projectId: snap.activeProjectId ?? '', fromKind: input.fromKind, ...(input.approved ? { approved: true } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, snap.activeProjectId, refetch]);
  //? Export the active project's built image as a downloadable tarball (ADR 0038).
  const exportBuildApi = useCallback((kind: string) => {
    const room = snap.activeWorkspaceId;
    if (!room || !snap.activeProjectId) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'build-export', projectId: snap.activeProjectId ?? '', kind, clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, snap.activeProjectId, refetch]);
  const sprintCreateApi = useCallback((sprintName: string) => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/sprintCreate', version: 'v1', data: { name: sprintName, active: false, clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);
  //? Presence (#17): announce (or retract) that this user is viewing a ticket. The ticket detail
  //? calls it on open + a heartbeat + on close; the relay re-broadcasts it to the room.
  const setTicketPresence = useCallback((ticketKey: string, viewing: boolean) => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/presence', version: 'v1', data: { ticketKey, viewing, clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);
  //? Review ergonomics (ADR 0048): soft-claim a ticket's question (I'm answering) so others don't
  //? double-answer. Ephemeral via the presence relay; `claiming:false` releases. Idempotent.
  const claimTicketApi = useCallback((ticketKey: string, claiming: boolean) => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/presence', version: 'v1', data: { ticketKey, viewing: true, claiming, clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);

  //? RAG reindex (07 §D) — mirror scanDocs: fire the scan-index sync; the delta callback
  //? above stores the returned status. Fire-and-forget.
  const scanIndexApi = useCallback(() => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/scanIndex', version: 'v1', data: { clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);

  //? Built-in MR review (BUILTIN_MR_REVIEW) — fire an MR action into the room and resolve
  //? with whether the sync succeeded (so the panel can show loading/error). The fresh MR
  //? view lands in `mrByBranch` via the delta callback above.
  const mrActionApi = useCallback(async (action: MrActionKind, fields: MrActionFields): Promise<MrActionResult> => {
    const room = snap.activeWorkspaceId;
    if (!room) return { ok: false, error: 'mr.noRoom' };
    const res = await syncRequest({
      name: 'workspaces/mrAction', version: 'v1',
      data: {
        clientRequestId: nextReqId(), action, ticketKey: fields.ticketKey,
        ...(fields.mrId ? { mrId: fields.mrId } : {}),
        ...(fields.body === undefined ? {} : { body: fields.body }),
        ...(fields.filePath ? { filePath: fields.filePath } : {}),
        ...(fields.line === undefined ? {} : { line: fields.line }),
        ...(fields.threadId ? { threadId: fields.threadId } : {}),
        ...(fields.side ? { side: fields.side } : {}),
        ...(fields.resolved === undefined ? {} : { resolved: fields.resolved }),
      },
      receiver: room,
    });
    if (res.status !== 'success') return { ok: false, error: res.errorCode };
    if (res.result.status !== 'success') return { ok: false, error: res.result.errorCode };
    //? Carry the transient merge/rollback outcome (no-approval / conflict) off the returned view
    //? so the panel can toast it — it isn't persisted, so it must be read from this response.
    return { ok: true, outcome: res.result.mr?.actionResult };
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

  const translate = useTranslator();

  //? Send a chat message to the live Workspace-AI: echo the user turn + a pending AI
  //? bubble immediately, then resolve it with the AI's reply and (if any) a VALIDATED
  //? action proposal the user can accept. The AI never writes — acceptChatProposal does.
  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    const workspaceId = snap.activeWorkspaceId;
    if (!trimmed || !workspaceId) return;
    const stamp = String(reqCounter + 1); reqCounter += 1;
    const aiId = `a${stamp}`;
    setChat((prev) => [...prev, { id: `u${stamp}`, role: 'user', text: trimmed }, { id: aiId, role: 'ai', text: '', pending: true }]);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/aiChat', version: 'v1', data: { workspaceId, message: trimmed } }));
      setChat((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        if (error || res?.status !== 'success' || res.result.error) {
          return { ...m, pending: false, text: translate({ key: 'workspaces.shell.aiError' }) };
        }
        const { reply, proposal, plan } = res.result;
        return { ...m, pending: false, text: reply, ...(proposal ? { proposal } : {}), ...(plan ? { plan } : {}) };
      }));
    })();
  }, [snap.activeWorkspaceId, translate]);

  //? Accept an AI proposal → dispatch the matching control-op via the same `_sync` routes
  //? the manual UI uses (so execution stays under the Conductor + OP_CAPABILITY RBAC) and
  //? mark the bubble consumed so its Accept button can't re-fire.
  //? Dispatch a SINGLE proposal to the existing `_sync` verb (never a new verb; Conductor stays the writer).
  //? Shared by acceptChatProposal (one op) and acceptChatPlan (O-A, each step in order).
  const dispatchProposal = useCallback((p: ChatProposal, room: string) => {
    if (p.op === 'bulk-move' && p.ticketKeys && p.stageId) void syncRequest({ name: 'workspaces/bulkMove', version: 'v1', data: { ticketIds: p.ticketKeys, stageId: p.stageId, clientRequestId: nextReqId() }, receiver: room });
    else if (p.op === 'assign' && p.ticketKeys && p.assigneeId) void syncRequest({ name: 'workspaces/bulkAssign', version: 'v1', data: { ticketIds: p.ticketKeys, assigneeId: p.assigneeId, clientRequestId: nextReqId() }, receiver: room });
    else if (p.op === 'add-comment' && p.ticketKeys?.[0] && p.body) void syncRequest({ name: 'workspaces/addComment', version: 'v1', data: { ticketId: p.ticketKeys[0], body: p.body, clientRequestId: nextReqId() }, receiver: room });
    //? O-B — create ops route to the EXISTING verbs (quick-add / content-from-brief), not a new one.
    else if (p.op === 'create-ticket' && p.title) void syncRequest({ name: 'workspaces/quickAdd', version: 'v1', data: { title: p.title, ...(p.description ? { description: p.description } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); });
    else if (p.op === 'create-content' && p.title && p.brief) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-from-brief', title: p.title, brief: p.brief, format: p.format ?? 'faceless', clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); });
  }, [refetch]);

  const acceptChatProposal = useCallback((messageId: string, p: ChatProposal) => {
    const room = snap.activeWorkspaceId;
    if (room) dispatchProposal(p, room);
    setChat((prev) => prev.map((m) => (m.id === messageId ? { ...m, accepted: true } : m)));
  }, [snap.activeWorkspaceId, dispatchProposal]);

  //? O-A — approve a whole intake plan: dispatch each step in order (single-writer intact; each step is an
  //? existing verb). One approval → the Conductor materializes every ticket/piece the plan proposed.
  const acceptChatPlan = useCallback((messageId: string, plan: ChatPlan) => {
    const room = snap.activeWorkspaceId;
    if (room) for (const step of plan.steps) dispatchProposal(step, room);
    setChat((prev) => prev.map((m) => (m.id === messageId ? { ...m, accepted: true } : m)));
  }, [snap.activeWorkspaceId, dispatchProposal]);

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
      acceptChatProposal,
      acceptChatPlan,
      workspaces: snap.workspaces,
      activeWorkspace,
      setActiveWorkspace: (id) => { setWantWorkspaceId(id); setWantProjectId(undefined); setLoading(true); },
      createWorkspace: (name, enabledSections) => { afterWrite(apiRequest({ name: 'workspaces/createWorkspace', version: 'v1', data: { name, ...(enabledSections ? { enabledSections } : {}), clientRequestId: nextReqId() } })); },
      //? Multi-project / multi-service (ADR 0035).
      projects: snap.projects,
      activeProject: snap.projects.find((p) => p.id === snap.activeProjectId) ?? snap.projects.at(0) ?? null,
      activeProjectId: snap.activeProjectId,
      setActiveProject: (id) => { setWantProjectId(id); setLoading(true); },
      services: snap.services,
      templates: snap.templates,
      createProject: createProjectApi,
      createFromTemplate: createFromTemplateApi,
      createService: createServiceApi,
      deleteService: deleteServiceApi,
      connectForge: connectForgeApi,
      environments: snap.environments,
      deployEnv: deployEnvApi,
      teardownEnv: teardownEnvApi,
      promoteEnv: promoteEnvApi,
      buildArtifacts: snap.buildArtifacts,
      exportBuild: exportBuildApi,
      myInvites: snap.myInvites,
      acceptInvite: (token) => { afterWrite(apiRequest({ name: 'workspaces/acceptInvite', version: 'v1', data: { inviteToken: token, clientRequestId: nextReqId() } })); },
      sprintCreate: sprintCreateApi,
      renameWorkspace: (name) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/renameWorkspace', version: 'v1', data: { name, clientRequestId: nextReqId() }, receiver: room }); },
      deleteWorkspace: () => {
        afterWrite(apiRequest({ name: 'workspaces/deleteWorkspace', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', clientRequestId: nextReqId() } }));
        setWantWorkspaceId(undefined);
        setLoading(true);
      },
      saveGitlab: (baseUrl, token, forgeType) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/gitlabSettings', version: 'v1', data: { baseUrl, ...(token ? { token } : {}), ...(forgeType ? { forgeType } : {}), clientRequestId: nextReqId() }, receiver: room });
      },
      repo: snap.repo,
      linkRepo: (gitUrl, token) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/linkRepo', version: 'v1', data: { gitUrl, ...(token ? { token } : {}), clientRequestId: nextReqId() }, receiver: room });
      },
      scanDocs: () => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/scanDocs', version: 'v1', data: { clientRequestId: nextReqId() }, receiver: room });
      },
      //? K2 — register an uploaded doc (md/txt) as a context-doc InfoSource the AI can use.
      addInfoDoc: (name, content) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/addInfoDoc', version: 'v1', data: { name, content, clientRequestId: nextReqId() }, receiver: room });
      },
      scanIndex: scanIndexApi,
      ragIndex,
      mrAction: mrActionApi,
      mrByBranch,
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
      answerInput: (ticketId, answer) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/answerInput', version: 'v1', data: { ticketKey: ticketId, answer, clientRequestId: nextReqId() }, receiver: room }); },
      setTicketPresence,
      viewersOf: (ticketKey: string): string[] => Object.entries(presence).filter(([uid, v]) => v.ticketKey === ticketKey && uid !== currentUser.id).map(([uid]) => uid),
      //? Review ergonomics (ADR 0048): the cross-ticket answer-queue + soft-claim.
      answerQueue: snap.answerQueue,
      content: snap.content,
      claimTicket: claimTicketApi,
      //? Who (if anyone) has soft-claimed this ticket's question (is answering it) — null if free.
      claimedBy: (ticketKey: string): string | null => (Object.entries(presence).find(([, v]) => v.ticketKey === ticketKey && v.claiming === true)?.[0]) ?? null,
      archiveTicket: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/archive', version: 'v1', data: { ticketId: id, clientRequestId: nextReqId() }, receiver: room }); },
      bulkMove: (ids, stageId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkMove', version: 'v1', data: { ticketIds: ids, stageId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkStatus: (ids, status) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkStatus', version: 'v1', data: { ticketIds: ids, status, clientRequestId: nextReqId() }, receiver: room }); },
      bulkAssign: (ids, assigneeId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkAssign', version: 'v1', data: { ticketIds: ids, assigneeId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkSprint: (ids, sprintId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkSprint', version: 'v1', data: { ticketIds: ids, sprintId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkArchive: (ids) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkArchive', version: 'v1', data: { ticketIds: ids, clientRequestId: nextReqId() }, receiver: room }); },
      toggleSkill: (id, on) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/skillToggle', version: 'v1', data: { sourceId: id, on, clientRequestId: nextReqId() }, receiver: room }); },
      stageConfigs: snap.stageConfigs,
      saveStageConfig: (cfg) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/saveStageConfig', version: 'v1', data: { stageId: cfg.id, cfg, clientRequestId: nextReqId() }, receiver: room }); },
      gitConfig: snap.gitConfig,
      saveGitConfig: (cfg) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/saveGitConfig', version: 'v1', data: { gitConfig: cfg, clientRequestId: nextReqId() }, receiver: room }); },
      //? Module gating: optimistically flip the active workspace's enabledSections (instant
      //? nav re-render) then persist via the [save-sections] control-op; the broadcast
      //? reconciles idempotently.
      saveSections: (enabledSections) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        setSnap((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === room ? { ...w, enabledSections } : w)) }));
        void syncRequest({ name: 'workspaces/saveSections', version: 'v1', data: { enabledSections, clientRequestId: nextReqId() }, receiver: room });
      },
      //? E5 — user-defined AI tasks (create/update, delete, run). Run stays propose/generate (output only).
      saveCustomTask: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'save-custom-task', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteCustomTask: (taskId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'delete-custom-task', taskId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      runCustomTask: (taskId, vars) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'run-custom-task', taskId, vars, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? O5 — reusable output specs (save/delete).
      outputTemplates: snap.outputTemplates,
      saveOutputTemplate: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/outputTemplate', version: 'v1', data: { op: 'save-output-template', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteOutputTemplate: (templateId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/outputTemplate', version: 'v1', data: { op: 'delete-output-template', templateId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? A4 — the workspace autonomy level (optimistic flip + persist).
      saveAutonomy: (autonomyLevel) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        setSnap((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === room ? { ...w, autonomyLevel } : w)) }));
        void syncRequest({ name: 'workspaces/saveAutonomy', version: 'v1', data: { autonomyLevel, clientRequestId: nextReqId() }, receiver: room });
      },
      //? Q4 + K4 + P2 — the workspace-wide AI-behaviour settings (optimistic flip + persist).
      saveAiInstruction: (aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        setSnap((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === room ? { ...w, aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl } : w)) }));
        void syncRequest({ name: 'workspaces/saveAiInstruction', version: 'v1', data: { aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl, clientRequestId: nextReqId() }, receiver: room });
      },
      //? P1 — set which provider runs a feature ('default' clears the override).
      aiOverrides: snap.aiOverrides,
      customTasks: snap.customTasks,
      saveAiProvider: (feature, providerId) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/saveAiProvider', version: 'v1', data: { feature, providerId, clientRequestId: nextReqId() }, receiver: room });
      },
      workspacePaused: snap.workspacePaused,
      pauseTicket: (ticketKey) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/agentControl', version: 'v1', data: { op: 'pause', ticketKey, clientRequestId: nextReqId() }, receiver: room }); },
      resumeTicket: (ticketKey) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/agentControl', version: 'v1', data: { op: 'resume', ticketKey, clientRequestId: nextReqId() }, receiver: room }); },
      killTicket: (ticketKey) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/agentControl', version: 'v1', data: { op: 'kill', ticketKey, clientRequestId: nextReqId() }, receiver: room }); },
      pauseAll: () => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/agentControl', version: 'v1', data: { op: 'pause-all', clientRequestId: nextReqId() }, receiver: room }); },
      resumeAll: () => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/agentControl', version: 'v1', data: { op: 'resume-all', clientRequestId: nextReqId() }, receiver: room }); },
      openPreview: async (ticketKey) => {
        const room = snap.activeWorkspaceId;
        if (!room) return { ok: false };
        const res = await apiRequest({ name: 'workspaces/openPreview', version: 'v1', data: { workspaceId: room, ticketKey } });
        if (res.status !== 'success') return { ok: false, error: res.errorCode };
        return res.result;
      },
      closePreview: (ticketKey) => { const room = snap.activeWorkspaceId; if (room) void apiRequest({ name: 'workspaces/closePreview', version: 'v1', data: { workspaceId: room, ticketKey } }); },
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
      usage: snap.usage,
      insights: snap.insights,
      analytics: snap.analytics,
      triggers: snap.triggers,
      agentRoles: snap.agentRoles,
      aiRuns: snap.aiRuns,
      studioBriefs: snap.studioBriefs,
      studioArtifacts: snap.studioArtifacts,
      studioBrand: snap.studioBrand,
      designArtifacts: snap.designArtifacts,
      interviewFindings: snap.interviewFindings,
      ticketArtifactLinks: snap.ticketArtifactLinks,
      makeTicketFromFinding: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/findingAction', version: 'v1', data: { op: 'finding-to-ticket', findingId: id, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      dismissFinding: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/findingAction', version: 'v1', data: { op: 'finding-dismiss', findingId: id, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      linkArtifact: (ticketKey, artifactId, artifactKind, label) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/ticketArtifact', version: 'v1', data: { op: 'ticket-link-artifact', ticketId: ticketKey, artifactId, artifactKind, ...(label ? { label } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      unlinkArtifact: (linkId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/ticketArtifact', version: 'v1', data: { op: 'ticket-unlink-artifact', linkId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      saveBrand: async (b) => { const ws = snap.activeWorkspaceId; if (!ws) return; await apiRequest({ name: 'workspaces/studioBrand', version: 'v1', data: { workspaceId: ws, op: 'save', ...b } }); refetch(); },
      promoteBrand: async (artifactId) => { const ws = snap.activeWorkspaceId; if (!ws) return; await apiRequest({ name: 'workspaces/studioBrand', version: 'v1', data: { workspaceId: ws, op: 'promote', artifactId } }); refetch(); },
      saveBrief: async (b) => {
        const ws = snap.activeWorkspaceId; if (!ws) return;
        await apiRequest({ name: 'workspaces/studioSaveBrief', version: 'v1', data: { workspaceId: ws, ...b } });
        refetch();
      },
      generateArtifact: async (briefId, kind, tweak) => {
        const ws = snap.activeWorkspaceId; if (!ws) return { ok: false };
        const res = await apiRequest({ name: 'workspaces/studioGenerate', version: 'v1', data: { workspaceId: ws, briefId, kind, ...(tweak ? { tweak } : {}) } });
        refetch();
        return { ok: res.status === 'success', ...(res.status === 'success' ? { artifactId: res.result.artifactId } : { error: res.errorCode }) };
      },
      deleteBrief: (briefId) => { const ws = snap.activeWorkspaceId; if (ws) void apiRequest({ name: 'workspaces/studioDelete', version: 'v1', data: { workspaceId: ws, briefId } }).then(() => { refetch(); }); },
      deleteArtifact: (artifactId) => { const ws = snap.activeWorkspaceId; if (ws) void apiRequest({ name: 'workspaces/studioDelete', version: 'v1', data: { workspaceId: ws, artifactId } }).then(() => { refetch(); }); },
      saveTrigger: (t) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-save', clientRequestId: nextReqId(), ...t }, receiver: room }).then(() => { refetch(); }); },
      toggleTrigger: (id, enabled) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-toggle', triggerId: id, enabled, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteTrigger: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-delete', triggerId: id, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      runTrigger: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-run', triggerId: id, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Fire a content-generation control-op (U2) — Conductor executes (B-23); the snapshot refetch brings the new asset/state back.
      runContentOp: (op, contentProjectId, payload) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op, contentProjectId, ...payload, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Media €-budget settings (U3) — cap/alert/enabled via edit-media-budget (B-23).
      editMediaBudget: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'edit-media-budget', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Save an ENCRYPTED media provider API key / per-feature override (U3) via save-media-provider (B-23).
      saveMediaProvider: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'save-media-provider', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Edit a channel's brand voice (U4) → updates the channel + re-indexes brand-RAG (B-23).
      editChannelBrand: (channelId, brandVoice) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'content-edit-brand', channelId, brandVoice, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      saveProductContext: (productContext) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'content-edit-product', productContext, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      saveStyle: (feature, key, label, systemPrompt) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'save-style', feature, key, label, systemPrompt, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteStyle: (feature, key) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'delete-style', feature, key, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      docs: snap.docs,
      skills: snap.skills,
      invites: snap.invites,
      activityEvents: snap.events,
      ticketNotes: snap.notes,
    };
  }, [view, navStack, recent, openTabs, isMobile, theme, setTheme, activeSuggestions, navigate, currentUser, sshKeys, sshUserId, addSshKey, removeSshKey, aiOpen, chat, sendChat, acceptChatProposal, acceptChatPlan, snap, afterWrite, quickAddApi, sprintCreateApi, createProjectApi, createFromTemplateApi, createServiceApi, deleteServiceApi, connectForgeApi, deployEnvApi, teardownEnvApi, promoteEnvApi, exportBuildApi, scanIndexApi, ragIndex, mrActionApi, mrByBranch, presence, setTicketPresence, claimTicketApi, membersById, stageOverrides, loading, refetch, signOut]);

  return <WorkspacesContextProvider value={ctx}>{children}</WorkspacesContextProvider>;
}
