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

//? F45 — identifies WHICH question is being answered: a ticket's needs-input banner, or one specific
//? advisory on it. Used as the pending-state key.
import { useLocation, useNavigate } from 'react-router-dom';

import { apiRequest, tryCatch, i18nNotify as notify, useSession, useTheme, useTranslator } from '@luckystack/core/client';

import { useSocketStatus } from 'src/_providers/socketStatusProvider';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

import { backendUrl, loginPageUrl } from '../../../config';
import type { SessionLayout } from '../../../config';
import { menuHandler } from 'src/_functions/menuHandler';
import { isChatEnabledOp } from '../_data/chatOps';
import { VIEW_CATEGORY, TRAIL_ROOTS } from '../_data/nav';
import { executeTrackedChatDispatch, isChatProposalForProject } from '../_functions/chatDispatch';
import type {
  ActivityEvent, AiSuggestion, ChatMessage, ChatPlan, ChatProposal, EnvVar, GitConfig, InfoDoc, IntegrationTool, InviteEntry,
  Member, MrActionFields, MrActionKind, MrActionResult, MrView, MyInvite, NotificationItem, PermRole, PipelineStage,
  PipelineStageCfg, RagIndexStatus, RepoInfo, AiSkillEntry, DocumentEntry, DocumentTemplateEntry, SkillEntry, Sprint,
  SshKeyEntry, Ticket, TicketNote, TicketPriority, Workspace, WorkspaceBudget, WorkspaceUsage, WorkspaceInsights, WorkspaceAnalytics, WorkspaceTrigger,
  StudioBrief, StudioArtifact, StudioBrandLibrary, AiRun, DesignArtifact, InterviewFinding, TicketArtifactLink, UiReviewSummary,
  ProjectSummary, ServiceSummary, ServiceStackSummary, DbConnectionSummary, MigrationSummary, EnvironmentSummary, BuildArtifactSummary, ContentSnapshot,
  WorkspaceReadiness, PatSummary, AiConnection, AiProviderOption,
} from '../_data/types';
import { isTicketView, WorkspacesContextProvider, type WorkspacesCtx, type WsView } from './WorkspacesContext';
import { shouldApplySnapshotResponse, snapshotTargetsMatch, type SnapshotTarget } from './snapshotRequest';

const BASE = '/workspaces';

interface Snap {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  //? Multi-project (ADR 0035): the workspace's projects + selected one + its services.
  projects: ProjectSummary[];
  activeProjectId: string | null;
  services: ServiceSummary[];
  serviceStacks: ServiceStackSummary[];
  //? ADR 0043 — the active project's DB connections + migrations (DB panel).
  dbConnections: DbConnectionSummary[];
  migrations: MigrationSummary[];
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
  //? #103 — all spend caps (multi-cap editor).
  budgets: WorkspaceBudget[];
  capacity?: { active: number; queued: number; limit: number }; // #105/#19
  docs: InfoDoc[];
  skills: SkillEntry[];
  roles: PermRole[];
  envVars: EnvVar[];
  integrations: IntegrationTool[];
  invites: InviteEntry[];
  events: ActivityEvent[];
  notifications: NotificationItem[];
  stageConfigs: PipelineStageCfg[];
  aiOverrides: { feature: string; providerId: string; model?: string }[];
  //? ADR 0007 — the connected AIs + what can be connected. `hasKey` is presence only.
  aiConnections: AiConnection[];
  aiProviderCatalog: AiProviderOption[];
  //? P4-7 — built-in feature → backend defaults (what "Default" resolves to).
  aiFeatureDefaults: Record<string, string>;
  customTasks: { id: string; name: string; promptTemplate: string; lastOutput: string | null; lastRunAt: number | null }[];
  outputTemplates: { id: string; name: string; format: string; watermarkPosition: string }[];
  //? SK1 — the universal AI-skills layer.
  aiSkills: AiSkillEntry[];
  //? DOC1 — the Documents module.
  documents: DocumentEntry[];
  documentTemplates: DocumentTemplateEntry[];
  myInvites: MyInvite[];
  notes: TicketNote[];
  repo: RepoInfo;
  gitConfig: GitConfig;
  workspacePaused: boolean;
  usage: WorkspaceUsage;
  insights: WorkspaceInsights;
  analytics: WorkspaceAnalytics;
  content: ContentSnapshot;
  triggers: WorkspaceTrigger[];
  agentRoles: { key: string; label: string; description: string; mutates: boolean }[];
  aiRuns: AiRun[];
  studioBriefs: StudioBrief[];
  studioArtifacts: StudioArtifact[];
  studioBrand: StudioBrandLibrary | null;
  designArtifacts: DesignArtifact[];
  interviewFindings: InterviewFinding[];
  uiReviews: UiReviewSummary[];
  ticketArtifactLinks: TicketArtifactLink[];
  //? #111 — the user's persisted Workspace-AI chat history (per-user), chronological.
  chat: ChatMessage[];
  //? #76 — the user's persisted SSH keys (account-global).
  sshKeys: SshKeyEntry[];
  //? Setup readiness + the caller's resolved capabilities (new-user UX): drives the "what's missing / who can
  //? fix it" notices. `myPerms` is positional over CAP; `myRoleKey` is the raw (non-flattened) role key.
  readiness: WorkspaceReadiness;
  myPerms: boolean[];
  myRoleKey: string;
  //? Preload gap-fix (X3) — the caller's own Personal Access Tokens (metadata only).
  pats: PatSummary[];
}
//? The `gitConfig` here is just the pre-load placeholder (the server always sends the real
//? one in the snapshot); the canonical default lives in server/git/branchStrategy.ts.
const EMPTY_SNAP: Snap = {
  workspaces: [], activeWorkspaceId: null, projects: [], activeProjectId: null, services: [], serviceStacks: [], dbConnections: [], migrations: [], environments: [], buildArtifacts: [],
  templates: [],
  members: [], tickets: [], stages: [], sprints: [],
  suggestions: [], budget: null, budgets: [], docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [],
  notifications: [], stageConfigs: [], aiOverrides: [], aiConnections: [], aiProviderCatalog: [], aiFeatureDefaults: {}, customTasks: [], outputTemplates: [], aiSkills: [], documents: [], documentTemplates: [], myInvites: [], notes: [], repo: { linked: false },
  gitConfig: { branchStrategy: 'ticket-prefix', defaultBranchType: 'feature', branchTemplate: '{{type}}/{{key}}-{{slug}}', pushPolicy: 'local-only', targetBranch: 'main', protectedBranches: ['main', 'master'], commitSigning: false },
  workspacePaused: false,
  usage: { byTicket: [], activity: [], totalTokens: 0, totalTurns: 0, byAi: [], byUser: [] },
  insights: { avgCycleHours: 0, throughput7d: 0, avgTokensPerTicket: 0, doneCount: 0, openCount: 0 },
  analytics: { cycleP50Hours: 0, cycleP85Hours: 0, throughputByWeek: [], stuckCount: 0, doneCount: 0, openCount: 0, tokensByLabel: [], totalTokens: 0 },
  content: { pieces: [], mediaBudget: { enabled: false, capCents: 0, spentCents: 0, alertPct: 80, overAlert: false }, analytics: { totalPieces: 0, doneCount: 0, publishedCount: 0, byStage: [], byFormat: [], totalCostCents: 0, costByFeature: [] }, styles: [], references: [], channels: [], publishTargets: [], channelHealth: [], platformCredentials: [], assetLibrary: [], mediaCosts: [], mediaModels: [], mediaPrefs: { cheap: false, sceneContinuity: false, voiceId: '' }, shortLinks: [], comments: [], unreadComments: 0, trash: [], storage: { liveBytes: 0, trashBytes: 0, files: 0 } },
  triggers: [],
  agentRoles: [],
  aiRuns: [],
  studioBriefs: [],
  studioArtifacts: [],
  studioBrand: null,
  designArtifacts: [],
  interviewFindings: [],
  uiReviews: [],
  ticketArtifactLinks: [],
  chat: [],
  sshKeys: [],
  readiness: { repoLinked: false, aiText: false, media: { fal: false, elevenlabs: false, suno: false }, publishing: false, docker: false, push: false, secretManager: false },
  myPerms: [], myRoleKey: 'member',
  pats: [],
};

//? URLs mirror the category folder structure (/workspaces/<category>/<view>, see ../_data/nav.ts).
//? The Content overview doubles as its category index (/workspaces/content); category-less views
//? (ai, settings, workspace) keep flat /workspaces/<view> URLs.
function pathForView(view: WsView): string {
  if (isTicketView(view)) return `${BASE}/develop/board/${view}`;
  if (view === 'content') return `${BASE}/content`;
  const cat = VIEW_CATEGORY[view];
  return cat ? `${BASE}/${cat}/${view}` : `${BASE}/${view}`;
}

//? ADR 0312 — a view's sub-navigation as URL segments, so a tab/section is a real address: linkable,
//? bookmarkable, survives a refresh, and the back button walks it. Only allowlisted views (nav.ts)
//? get one; everywhere else the extra segments belong to a nested ROUTE and must be left alone.
const relativePath = (pathname: string): string => pathname.replace(/^\/workspaces\/?/, '').replace(/\/+$/, '');

function pathForTrail(view: WsView, trail: readonly string[] = []): string {
  const base = pathForView(view);
  if (view === 'terminals' && trail[0]) return `${base}?ticket=${encodeURIComponent(trail[0])}`;
  if (!TRAIL_ROOTS.includes(relativePath(base))) return base;
  const clean = trail.filter((s) => s.length > 0).map((s) => encodeURIComponent(s));
  return clean.length > 0 ? `${base}/${clean.join('/')}` : base;
}
//? The trail root the CURRENT path sits under, or undefined when it has none.
//?
//? `setTrail` used to rebuild its URL from the derived VIEW, and that is wrong wherever a page's path
//? is not its view's path. /workspaces/content/settings derives the view `content` (viewFromPath sends
//? every unrecognised content sub-path to the overview), so `pathForView('content')` returned
//? /workspaces/content — not a trail root — and every tab click on the Content settings page silently
//? navigated the user OFF the page to the Content overview. The deep links into it worked, because
//? focusSetup passes the literal 'content/settings', which is why nothing ever caught this.
//? A trail belongs to the PATH you are on, not to the view that path resolves to.
function trailRootOf(pathname: string): string | undefined {
  const rest = relativePath(pathname);
  return TRAIL_ROOTS.find((root) => rest === root || rest.startsWith(`${root}/`));
}

function trailFromPath(pathname: string): string[] {
  const rest = relativePath(pathname);
  for (const root of TRAIL_ROOTS) {
    if (rest === root) return [];
    if (rest.startsWith(`${root}/`)) return rest.slice(root.length + 1).split('/').map((s) => decodeURIComponent(s));
  }
  return [];
}
function viewFromPath(pathname: string): WsView {
  const rest = pathname.replace(/^\/workspaces\/?/, '').replace(/\/+$/, '');
  if (!rest) return 'board';
  const segs = rest.split('/');
  const first = segs[0] ?? '';
  if (first === 'develop') {
    if (segs[1] === 'board' && segs[2] && isTicketView(segs[2])) return segs[2];
    return segs[1] && VIEW_CATEGORY[segs[1]] === 'develop' ? segs[1] : 'board';
  }
  if (first === 'content') {
    //? /workspaces/content/<sub> is a sibling page only when <sub> is a nav view of the content
    //? category; every other sub-path ([pieceId], insights, settings) belongs to the overview page.
    return segs[1] && segs[1] !== 'content' && VIEW_CATEGORY[segs[1]] === 'content' ? segs[1] : 'content';
  }
  if (first === 'insights') {
    return segs[1] && VIEW_CATEGORY[segs[1]] === 'insights' ? segs[1] : 'activity';
  }
  //? pre-restructure flat paths (old bookmarks/push links) still resolve to their view
  if (first === 'board' && segs[1] && isTicketView(segs[1])) return segs[1];
  return first || 'board';
}
const VIEW_LABELS: Record<string, string> = {
  board: 'Board', backlog: 'Backlog', terminals: 'Terminals', code: 'Code', activity: 'Activity',
  sources: 'Sources', pipeline: 'Pipeline', automations: 'Automations', components: 'Components', usage: 'Usage', studio: 'Studio',
  designer: 'Designer', interviewer: 'Interviewer', marketing: 'Marketing', scheduled: 'Scheduled',
  knowledge: 'Knowledge', content: 'Content', 'scheduled-posts': 'Scheduled posts', settings: 'Account', workspace: 'Workspace',
  documents: 'Documents', answers: 'Answers', ai: 'AI',
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

function reportRequestFailure(response: unknown): boolean {
  if (response !== null && typeof response === 'object' && 'status' in response && response.status === 'error') {
    const errorCode = 'errorCode' in response && typeof response.errorCode === 'string' ? response.errorCode : 'workspaces.syncFailed';
    notify.error({ key: errorCode });
    return true;
  }
  return false;
}

function observeSync(request: Promise<unknown>): void {
  void request.then((response) => { reportRequestFailure(response); }, () => { notify.error({ key: 'workspaces.syncFailed' }); });
}

//? A local counter for UI-only ids (chat messages) — never sent to the server.
let reqCounter = 0;

//? A short, stable fingerprint of the question text, so the idempotency id changes when the QUESTION does.
//? Not cryptographic — it only has to distinguish one open question from the next on the same ticket.
const shortHash = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.trunc(Math.imul(31, hash) + (value.codePointAt(index) ?? 0));
  return (hash >>> 0).toString(36);
};

const answerKey = (ticketId: string, advisoryIndex?: number): string => `${ticketId}:${typeof advisoryIndex === 'number' ? String(advisoryIndex) : 'main'}`;

//? The snapshot cache key: a workspace's data is scoped to ONE active project, so an entry is keyed by both
//? (an empty project segment = the workspace's default / no-project state).
const snapKey = (workspaceId: string | null | undefined, projectId: string | null | undefined): string => `${workspaceId ?? ''}::${projectId ?? ''}`;

//? LRU bound on the snapshot cache: each cached Snap is one workspace-project's small data, so N of them for a
//? user in very many workspaces would grow memory unbounded. Keep the most-recently-used entries; an evicted
//? one simply reloads on its next visit. Generous enough that a typical user's whole set stays cached.
const SNAP_CACHE_MAX = 20;

export function WorkspacesProvider({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const { session } = useSession<SessionLayout>();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const view = viewFromPath(location.pathname);
  //? The view's sub-navigation, read straight off the URL — there is no second copy in state to keep
  //? in sync, which is the whole point (ADR 0312).
  const trail = useMemo(() => trailFromPath(location.pathname), [location.pathname]);

  const [snap, setSnap] = useState<Snap>(EMPTY_SNAP);
  const [loading, setLoading] = useState(true);
  const [wantWorkspaceId, setWantWorkspaceId] = useState<string | undefined>();
  //? Multi-project (ADR 0035): the client-selected project (mirrors wantWorkspaceId). A
  //? stale id from another workspace is harmless — the server validates it strictly and
  //? returns no active project instead of falling through to project #1. Cleared on switch.
  const [wantProjectId, setWantProjectId] = useState<string | undefined>();
  //? Snapshot reads can overlap while switching workspace/project. The request sequence
  //? makes completion monotonic; the desired-target ref closes the window before React
  //? commits the switch render, so a late A response cannot replace B.
  const snapshotRequestSequence = useRef(0);
  const desiredSnapshotTarget = useRef<SnapshotTarget>({ workspaceId: wantWorkspaceId, projectId: wantProjectId });
  desiredSnapshotTarget.current = { workspaceId: wantWorkspaceId, projectId: wantProjectId };
  const latestSnap = useRef(snap);
  latestSnap.current = snap;
  //? Client snapshot cache (stale-while-revalidate): every workspace/project we've loaded is kept in memory
  //? keyed by `${workspaceId}::${projectId}`, so switching BACK renders instantly from cache while a
  //? background refetch reconciles. Only the ACTIVE workspace has live delta hooks — a cached non-active one
  //? goes stale until re-selected, then the switch's background refetch freshens it. `lastProjectByWs` lets a
  //? bare workspace switch return to the project you were last on (no flip to the default).
  const snapCacheRef = useRef<Map<string, Snap>>(new Map());
  const lastProjectByWsRef = useRef<Map<string, string>>(new Map());
  const cacheEntry = useCallback((entry: Snap) => {
    if (!entry.activeWorkspaceId) return;
    const key = snapKey(entry.activeWorkspaceId, entry.activeProjectId);
    const cache = snapCacheRef.current;
    //? LRU touch: delete + re-insert so this key becomes the most-recently-used (Map preserves insertion order).
    cache.delete(key);
    cache.set(key, entry);
    lastProjectByWsRef.current.set(entry.activeWorkspaceId, entry.activeProjectId ?? '');
    //? Evict the least-recently-used beyond the cap. Never the just-written key — it's the ACTIVE workspace
    //? (re-cached on every delta via the mirror effect), so it can't be the oldest anyway; the guard is belt-
    //? and-braces. An evicted entry just reloads on its next visit (no correctness impact).
    if (cache.size > SNAP_CACHE_MAX) {
      //? Iterate in insertion order (oldest first); deleting an already-yielded key is safe on a Map iterator.
      for (const oldKey of cache.keys()) {
        if (cache.size <= SNAP_CACHE_MAX) break;
        if (oldKey !== key) cache.delete(oldKey);
      }
    }
  }, []);
  //? Writes must target the snapshot the user still wants. During a switch the old
  //? snapshot remains rendered briefly, but it is no longer a valid write scope.
  const currentProjectScope = useCallback(() => {
    const current = latestSnap.current;
    const desired = desiredSnapshotTarget.current;
    const workspaceId = current.activeWorkspaceId;
    const projectId = current.activeProjectId;
    if (!workspaceId || !projectId) return null;
    if (desired.workspaceId !== undefined && desired.workspaceId !== workspaceId) return null;
    if (desired.projectId !== undefined && desired.projectId !== projectId) return null;
    return { workspaceId, projectId, gitConfig: current.gitConfig };
  }, []);
  //? RAG code-index status — hydrated live by the `scanIndex` delta (kept lazy/on-demand: a status read runs
  //? a distinct-file query over the index, too heavy to recompute on every snapshot build). `mrByBranch`
  //? (built-in MR review) is likewise a pure realtime side-channel, hydrated only by its `_sync` delta below.
  const [ragIndex, setRagIndex] = useState<RagIndexStatus | null>(null);
  const [mrByBranch, setMrByBranch] = useState<Record<string, MrView>>({});
  //? Realtime presence (#17): userId → who they're viewing + when last seen. Fed by the
  //? `workspaces/presence` relay; a `tick` state prunes stale entries so a crashed viewer drops.
  const [presence, setPresence] = useState<Record<string, { ticketKey: string; lastSeen: number; claiming?: boolean }>>({});
  //? #119 — per-VIEW presence (who is on which nav page now), kept SEPARATE from ticket presence above
  //? so the two never clobber each other's fields. Pruned by the same 25s ticker.
  const [viewPresence, setViewPresence] = useState<Record<string, { view: string; lastSeen: number }>>({});
  const [, setPresenceTick] = useState(0);
  //? #20 — the live agent-terminal tail per ticket (a rolling buffer, capped). Fed by the agentTerm broadcast.
  const [agentTerm, setAgentTerm] = useState<Record<string, string>>({});
  //? #109 — the pending copilot form pre-fill (field→value) the AI-drives-UI directive dropped; the target
  //? page reads + consumes it. null between directives.
  const [copilotPrefill, setCopilotPrefill] = useState<Record<string, string> | null>(null);
  const refetch = useCallback(() => {
    const target = { workspaceId: wantWorkspaceId, projectId: wantProjectId };
    //? A timer/callback from the previous render may still hold an old refetch closure.
    //? Do not let that stale target supersede the newest desired request sequence.
    if (!snapshotTargetsMatch(target, desiredSnapshotTarget.current)) return;
    const request = { ...target, sequence: snapshotRequestSequence.current + 1 };
    snapshotRequestSequence.current = request.sequence;
    void (async () => {
      const res = await apiRequest({ name: 'workspaces/snapshot', version: 'v1', data: { workspaceId: request.workspaceId, projectId: request.projectId } });
      if (!shouldApplySnapshotResponse(request, snapshotRequestSequence.current, desiredSnapshotTarget.current)) return;
      //? Not logged in → go to the login page instead of leaking the onboarding UI
      //? (a logged-out visitor otherwise sees the "Create a workspace" form + only
      //? gets "you need to be logged in" after acting).
      if (res.status === 'error' && res.errorCode === 'auth.required') { globalThis.location.href = loginPageUrl; return; }
      if (res.status === 'success') setSnap(res.result);
      setLoading(false);
    })();
  }, [wantWorkspaceId, wantProjectId]);
  useEffect(() => { refetch(); }, [refetch]);

  //? Mirror the live (delta-updated) active snapshot into the cache on every change, so switching away and
  //? back returns the LATEST state, not the load-time snapshot.
  useEffect(() => { cacheEntry(snap); }, [snap, cacheEntry]);

  //? Background prefetch (idle): once the active workspace has loaded, fill the cache with every OTHER
  //? workspace's default-project snapshot — sequentially + throttled so login stays fast and the server
  //? isn't hammered — so even the FIRST switch to any workspace is instant. Runs once per session; skips
  //? workspaces already cached (incl. the active one). New workspaces created later just lazy-cache on visit.
  const prefetchedRef = useRef(false);
  useEffect(() => {
    if (prefetchedRef.current || !snap.activeWorkspaceId || snap.workspaces.length <= 1) return;
    prefetchedRef.current = true;
    const others = snap.workspaces.filter((w) => w.id !== snap.activeWorkspaceId).map((w) => w.id);
    void (async () => {
      for (const wsId of others) {
        //? Stop once the cache is full — prefetching more would just churn the LRU (fetch then evict). The
        //? remaining workspaces lazy-load (still cached) on their first visit.
        if (snapCacheRef.current.size >= SNAP_CACHE_MAX) break;
        if (lastProjectByWsRef.current.has(wsId)) continue;
        const res = await apiRequest({ name: 'workspaces/snapshot', version: 'v1', data: { workspaceId: wsId } });
        if (res.status === 'success') cacheEntry(res.result);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    })();
  }, [snap.activeWorkspaceId, snap.workspaces, cacheEntry]);

  //? #121 — deep-link from an OS push / shortcut: `/?ticket=DEV-####` opens that ticket once the
  //? snapshot has loaded it, then strips the param so a reload/back doesn't re-trigger.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const ticketKey = new URLSearchParams(globalThis.location.search).get('ticket');
    if (!ticketKey) { deepLinkHandled.current = true; return; }
    if (!snap.tickets.some((t) => t.id === ticketKey)) return; // wait for the snapshot to load it
    deepLinkHandled.current = true;
    void navigate(pathForView(ticketKey));
    globalThis.history.replaceState({}, '', globalThis.location.pathname);
  }, [snap.tickets, navigate]);

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
  //? GAP_SCAN B1 — the phone-first loop is approve/answer, and a tap made while the socket is down used to
  //? vanish silently (fire-and-forget `syncRequest`). Those two writes are now PARKED in an offline queue,
  //? surfaced by the shell banner, and replayed the moment the socket is back (or when the user taps retry).
  //? The ops are idempotent on `clientRequestId`, so a replay can never double-apply.
  const offline = socketStatusValue !== 'CONNECTED' && socketStatusValue !== 'STARTUP';
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  //? F45 — which answers are in flight. Every write here is enqueued for the Conductor and only becomes
  //? visible when the ticket delta broadcasts back, so without this the Approve button looked like it did
  //? nothing: it stayed live and re-clickable for the whole round trip, and a second tap queued a SECOND
  //? answer. The key is the surface the user clicked, so the button that is waiting is the one that dims.
  const [pendingAnswers, setPendingAnswers] = useState<Record<string, true>>({});
  const offlineQueueRef = useRef<(() => void)[]>([]);
  const [queuedWrites, setQueuedWrites] = useState(0);
  const parkWrite = useCallback((run: () => void) => {
    offlineQueueRef.current.push(run);
    setQueuedWrites(offlineQueueRef.current.length);
  }, []);
  const retryQueuedWrites = useCallback(() => {
    const pending = offlineQueueRef.current;
    offlineQueueRef.current = [];
    setQueuedWrites(0);
    for (const run of pending) run();
  }, []);
  useEffect(() => {
    const prev = prevSocketStatus.current;
    prevSocketStatus.current = socketStatusValue;
    if (socketStatusValue === 'CONNECTED' && prev !== 'CONNECTED' && prev !== 'STARTUP') {
      const room = snap.activeWorkspaceId;
      if (room) void joinRoom(room);
      refetch();
      retryQueuedWrites();
    }
  }, [socketStatusValue, snap.activeWorkspaceId, refetch, retryQueuedWrites]);

  //? Shared realtime reducer: UPSERT the broadcast ticket(s) by id (an archive is
  //? just an upsert with `archived:true` — the board/backlog derive visibility from
  //? it). Every ticket-mutation `_sync` event routes its delta through here.
  const mergeTickets = useCallback((incoming: Ticket[]) => {
    if (incoming.length === 0) return;
    setSnap((s) => {
      const scoped = incoming.filter((ticket) => ticket.projectId === s.activeProjectId);
      if (scoped.length === 0) return s;
      const byId = new Map(s.tickets.map((ticket) => [ticket.id, ticket]));
      for (const ticket of scoped) {
        const previous = byId.get(ticket.id);
        byId.set(ticket.id, { ...ticket, ...(ticket.costLabel === undefined && previous?.costLabel !== undefined ? { costLabel: previous.costLabel } : {}) });
      }
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
      setSnap((s) => (ticket.projectId !== s.activeProjectId || s.tickets.some((t) => t.id === ticket.id) ? s : { ...s, tickets: [...s.tickets, ticket] }));
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
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      mergeTickets(serverOutput.tickets);
      //? F45 — THIS is the real acknowledgement: the Conductor has applied the answer and the ticket that
      //? comes back no longer asks the question. Releasing the pending flag here rather than on the socket
      //? reply is what makes the button stay locked for the whole round trip instead of un-dimming early.
      const acked = new Set(serverOutput.tickets.map((t) => t.id));
      setPendingAnswers((prev) => Object.fromEntries(
        Object.entries(prev).filter(([key]) => !acked.has(key.slice(0, key.lastIndexOf(':')))),
      ));
    },
  }), [upsertSyncEventCallback, mergeTickets]);
  //? #20 — live agent tail: append each broadcast PTY chunk to that ticket's rolling buffer (capped 40k).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/agentTerm', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.ticketKey || !serverOutput.chunk) return;
      const { ticketKey, chunk } = serverOutput;
      setAgentTerm((s) => ({ ...s, [ticketKey]: (`${s[ticketKey] ?? ''}${chunk}`).slice(-40_000) }));
    },
  }), [upsertSyncEventCallback]);
  //? presence (#17): update who's viewing what. A `viewing:false` (clean leave) removes the entry;
  //? otherwise stamp lastSeen. Stale entries are pruned by the ticker below.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/presence', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      const p = serverOutput.presence;
      //? #119 — a view-ping (carries `view`, no ticketKey) updates the per-view map only; it never
      //? touches the ticket-presence map, so viewer avatars + question-claims stay exactly as before.
      if (p.view.length > 0 && p.ticketKey.length === 0) {
        setViewPresence((prev) => ({ ...prev, [p.userId]: { view: p.view, lastSeen: Date.now() } }));
        return;
      }
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
      //? #119 — prune stale per-view presence on the same cadence.
      setViewPresence((prev) => {
        const next: typeof prev = {};
        let changed = false;
        for (const [uid, v] of Object.entries(prev)) { if (v.lastSeen >= cutoff) next[uid] = v; else changed = true; }
        return changed ? next : prev;
      });
      setPresenceTick((n) => n + 1);
    }, 8000);
    return () => { clearInterval(t); };
  }, []);
  //? #119 — announce which nav VIEW this user is on (ticket views fold into 'board') on view-change +
  //? a 15s heartbeat, so other clients render per-view presence badges. Ephemeral via the same relay.
  //? The FIRST ping after switching workspace must wait for the room JOIN to be CONFIRMED — otherwise it
  //? races the async `joinRoom` (the room-join effect above) and the server rejects a ping to a room we have
  //? not joined yet (a `sync.failedRequest` toast on every switch, amplified once switching became instant).
  //? A ref tracks the joined room so a mere VIEW change (same room, already joined) still pings immediately
  //? without a redundant re-join; the cancelled flag drops a stale join-resolution after a rapid re-switch.
  const joinedPresenceRoomRef = useRef<string | null>(null);
  useEffect(() => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    let cancelled = false;
    const topView = isTicketView(view) ? 'board' : view;
    const ping = () => { void syncRequest({ name: 'workspaces/presence', version: 'v1', data: { view: topView, viewing: true, clientRequestId: nextReqId() }, receiver: room }); };
    if (joinedPresenceRoomRef.current === room) {
      ping();
    } else {
      void joinRoom(room).then((joined) => { if (!cancelled && joined) { joinedPresenceRoomRef.current = room; ping(); } });
    }
    const t = setInterval(ping, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [view, snap.activeWorkspaceId]);

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
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/unarchive', version: 'v1',
    callback: ({ serverOutput }) => { if (serverOutput.status === 'success') mergeTickets(serverOutput.tickets); },
  }), [upsertSyncEventCallback, mergeTickets]);

  //? add-comment delta → merge the new note into the ticket's thread (dedupe by id).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/addComment', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.note) return;
      const note = serverOutput.note;
      setSnap((s) => (!s.tickets.some((ticket) => ticket.id === note.ticketId) || s.notes.some((n) => n.id === note.id) ? s : { ...s, notes: [...s.notes, note] }));
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

  //? content-piece delta → UPSERT the whole piece by id (advance/archive/unarchive) — the granular
  //? alternative to a contentDirty full refetch for single-piece structural ops. Same idempotent shape as
  //? the snapshot (broadcastContentPieceDelta shares its mapper), so a re-delivered delta is safe.
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/contentPieceDelta', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success' || !serverOutput.piece) return;
      const piece = serverOutput.piece;
      setSnap((s) => ({
        ...s,
        content: {
          ...s.content,
          pieces: s.content.pieces.some((p) => p.id === piece.id)
            ? s.content.pieces.map((p) => (p.id === piece.id ? piece : p))
            : [piece, ...s.content.pieces],
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

  //? workspace-dirty nudge → the GENERAL convergence signal: any cold settings/infra write (projects,
  //? services, environments, DBs, budget, gitlab, documents, skills, triggers, sprints, stages, …) now
  //? reaches EVERY member here, not just the initiator that refetched. Reuses the SAME debounce timer as
  //? contentDirty, so a burst of mixed writes coalesces into ONE refetch. A `gone` payload is the
  //? workspace-DELETED lifecycle signal: if it's OUR active workspace, drop the target so the refetch falls
  //? back to the picker / another workspace instead of operating on a dead tenant (mirrors the initiator's
  //? own eviction in deleteWorkspace).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/workspaceDirty', version: 'v1',
    callback: ({ serverOutput }) => {
      if (serverOutput.status !== 'success') return;
      if (serverOutput.gone) {
        if (serverOutput.workspaceId.length > 0 && latestSnap.current.activeWorkspaceId === serverOutput.workspaceId) {
          desiredSnapshotTarget.current = { workspaceId: undefined, projectId: undefined };
          setWantWorkspaceId(undefined);
          setWantProjectId(undefined);
          setLoading(true);
          refetch();
        }
        return;
      }
      if (dirtyTimer.current) clearTimeout(dirtyTimer.current);
      dirtyTimer.current = setTimeout(() => { refetch(); }, 400);
    },
  }), [upsertSyncEventCallback, refetch]);

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
      const { memberId, role, roleKey } = serverOutput;
      setSnap((s) => ({ ...s, members: s.members.map((m) => (m.id === memberId ? { ...m, role, roleKey } : m)) }));
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
        members: s.members.map((m) => (m.id === newOwnerId ? { ...m, role: 'owner', roleKey: 'owner' } : (m.id === previousOwnerId ? { ...m, role: 'admin', roleKey: 'admin' } : m))),
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
      if (!('acceptedSuggestionId' in serverOutput) && !('dismissedSuggestionId' in serverOutput)) return;
      const id = 'acceptedSuggestionId' in serverOutput ? serverOutput.acceptedSuggestionId : serverOutput.dismissedSuggestionId;
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

  //? archive/restore/delete of a context doc returns the same full doc list, so the delta is
  //? handled identically to addInfoDoc — every client in the room replaces its list (ADR 0310).
  useEffect(() => upsertSyncEventCallback({
    name: 'workspaces/infoDocAdmin', version: 'v1',
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
      setSnap((s) => cfg.projectId === s.activeProjectId
        ? ({ ...s, stageConfigs: s.stageConfigs.some((stage) => stage.id === cfg.id) ? s.stageConfigs.map((stage) => (stage.id === cfg.id ? cfg : stage)) : [...s.stageConfigs, cfg] })
        : s);
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
    const scope = currentProjectScope();
    if (!scope) { notify.warning({ key: 'workspaces.board.needsProject' }); return; }
    const { workspaceId: room, projectId } = scope;
    void syncRequest({
      name: 'workspaces/quickAdd', version: 'v1',
      data: {
        title: input.title,
        //? Multi-project (ADR 0035): no active project means no write — never project #1 fallback.
        projectId,
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
  }, [currentProjectScope]);
  //? Multi-project / multi-service admin writes (ADR 0035) → the projectAdmin `_sync`
  //? route; the client refetches on success (these change rarely). project-create
  //? switches to the new project once the refetch lands it.
  const createProjectApi = useCallback((input: { name: string; gitUrl?: string; gitlabPath?: string; preset?: string }) => {
    const scope = currentProjectScope();
    if (!scope || input.name.trim().length === 0) return;
    const room = scope.workspaceId;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'project-create', name: input.name, ...(input.gitUrl ? { gitUrl: input.gitUrl } : {}), ...(input.gitlabPath ? { gitlabPath: input.gitlabPath } : {}), ...(input.preset ? { preset: input.preset } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [currentProjectScope, refetch]);
  //? Greenfield scaffolding (ADR 0046): create a fresh project from a curated stack template.
  const applyDesignTokensApi = useCallback((projectId?: string, serviceId?: string): Promise<string | null> => {
    const room = snap.activeWorkspaceId;
    const targetProjectId = projectId ?? snap.activeProjectId;
    if (!room || !targetProjectId) return Promise.resolve('sync.missingReceiver');
    return tryCatch(() => syncRequest({
      name: 'workspaces/projectAdmin', version: 'v1',
      data: { op: 'apply-design-tokens', projectId: targetProjectId, ...(serviceId ? { serviceId } : {}), clientRequestId: nextReqId() },
      receiver: room,
    })).then(([error, response]) => {
      if (error || !response) return 'design.applyFailed';
      if (response.status !== 'success') return response.errorCode;
      if (response.result.status !== 'success') return response.result.errorCode;
      refetch();
      return null;
    });
  }, [snap.activeWorkspaceId, snap.activeProjectId, refetch]);
  const createFromTemplateApi = useCallback((input: { name: string; template: string; brief?: string; preset?: string }) => {
    const scope = currentProjectScope();
    if (!scope || input.name.trim().length === 0) return;
    const room = scope.workspaceId;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'project-from-template', name: input.name, template: input.template, ...(input.brief && input.brief.trim().length > 0 ? { brief: input.brief.trim() } : {}), ...(input.preset ? { preset: input.preset } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [currentProjectScope, refetch]);
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
  //? K1/K3 — provision a third-party service stack (a K2 preset or a bring-your-own compose) + teardown.
  //? The compose is sanitized + namespaced server-side; a preset also publishes its connection-string env.
  const provisionServiceStackApi = useCallback((input: { name: string; preset?: string; compose?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || input.name.trim().length === 0) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/serviceProvision', version: 'v1', data: { name: input.name.trim(), ...(input.preset ? { preset: input.preset } : {}), ...(input.compose ? { compose: input.compose } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  const teardownServiceStackApi = useCallback((stackName: string) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/serviceTeardown', version: 'v1', data: { name: stackName, clientRequestId: nextReqId() }, receiver: room });
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
  const disconnectForgeApi = useCallback((projectId: string) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'forge-connect', projectId, disconnect: true, clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  //? Environments (ADR 0037): deploy the active project (or a service) to a dev/staging/prod env,
  //? or tear one down. Deploy is slow (container launch + readiness) → refetch after it settles.
  const deployEnvApi = useCallback((input: { kind: string; serviceId?: string; pinnedCommit?: string; autoRedeploy?: boolean; subdomain?: string; customDomain?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || !snap.activeProjectId) return;
    void (async () => {
      //? D1/D3 — a `demo` env can pin a specific commit ("commit X at a stable URL") and/or auto-redeploy on
      //? branch move. D2/D4 — a chosen subdomain or D3 custom domain sets the DNS in the same deploy call.
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-deploy', projectId: snap.activeProjectId ?? '', kind: input.kind, ...(input.serviceId ? { serviceId: input.serviceId } : {}), ...(input.pinnedCommit ? { pinnedCommit: input.pinnedCommit } : {}), ...(typeof input.autoRedeploy === 'boolean' ? { autoRedeploy: input.autoRedeploy } : {}), ...(input.subdomain ? { subdomain: input.subdomain } : {}), ...(input.customDomain ? { customDomain: input.customDomain } : {}), clientRequestId: nextReqId() }, receiver: room });
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
  //? GAP_SCAN D3 — roll an environment back to its last LIVE commit (the Conductor refuses when there is
  //? no earlier good deploy). Destructive → the caller confirms first.
  const rollbackEnvApi = useCallback((envId: string) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-rollback', envId, clientRequestId: nextReqId() }, receiver: room });
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
  //? ADR 0043 — DB panel: connect a user-app database, create + apply a migration, or introspect a
  //? connection's schema. All go through the projectAdmin control-op → Conductor (the only writer, B-23).
  const dbConnectApi = useCallback((input: { name: string; kind: string; url: string; envKind?: string; serviceId?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || !snap.activeProjectId) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-connect', projectId: snap.activeProjectId ?? '', name: input.name, kind: input.kind, url: input.url, ...(input.envKind ? { envKind: input.envKind } : {}), ...(input.serviceId ? { serviceId: input.serviceId } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, snap.activeProjectId, refetch]);
  const dbMigrateCreateApi = useCallback((input: { name: string; sql: string; rollbackSql?: string; envKind?: string }) => {
    const room = snap.activeWorkspaceId;
    if (!room || !snap.activeProjectId) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-migrate-create', projectId: snap.activeProjectId ?? '', name: input.name, sql: input.sql, ...(input.rollbackSql ? { rollbackSql: input.rollbackSql } : {}), ...(input.envKind ? { envKind: input.envKind } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, snap.activeProjectId, refetch]);
  const dbMigrateApplyApi = useCallback((input: { migrationId: string; approved?: boolean }) => {
    const room = snap.activeWorkspaceId;
    if (!room) return;
    void (async () => {
      await syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-migrate-apply', migrationId: input.migrationId, ...(input.approved ? { approved: true } : {}), clientRequestId: nextReqId() }, receiver: room });
      refetch();
    })();
  }, [snap.activeWorkspaceId, refetch]);
  const dbIntrospectApi = useCallback((connectionId: string) => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-introspect', connectionId, clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);
  const sprintCreateApi = useCallback((sprintName: string) => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/sprintCreate', version: 'v1', data: { name: sprintName, active: false, clientRequestId: nextReqId() }, receiver: room });
  }, [snap.activeWorkspaceId]);
  //? #1 — activate / rename / (re)date a sprint (only the provided fields are sent).
  const editSprintApi = useCallback((input: { sprintId: string; name?: string; active?: boolean; startAt?: string; endAt?: string }) => {
    const room = snap.activeWorkspaceId;
    if (room) void syncRequest({ name: 'workspaces/sprintEdit', version: 'v1', data: { ...input, clientRequestId: nextReqId() }, receiver: room });
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
  const afterWrite = useCallback((p: Promise<unknown>) => {
    void p.then((response) => { if (!reportRequestFailure(response)) refetch(); }, () => { notify.error({ key: 'workspaces.syncFailed' }); });
  }, [refetch]);

  const translate = useTranslator();
  //? Memoised on the translated STRING, not on `translate`: the translator is a fresh function every
  //? render, so keying on it re-created the welcome array each render, which re-ran the hydrate effect
  //? below, which set state, which rendered — an infinite update loop that blanked every page.
  const welcomeText = translate({ key: 'workspaces.shell.aiWelcome' });
  const welcomeChat = useMemo<ChatMessage[]>(() => [{ id: 'm0', role: 'ai', text: welcomeText }], [welcomeText]);

  // UI-only state (not yet server-backed).
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(true);
  //? #76 — SSH keys now come from the snapshot (persisted per-account), not client seed state.
  const sshKeys = snap.sshKeys;
  const [navStack, setNavStack] = useState<WsView[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const interviewerChat = useMemo(() => snap.chat.filter((message) => message.source === 'interviewer'), [snap.chat]);
  //? #111 — hydrate the chat pane from the persisted per-user history on workspace switch
  //? (and initial load). The ref holds the latest snapshot chat so that board-write refetches
  //? don't clobber in-session turns (proposals/plans aren't persisted server-side); only an
  //? actual workspace switch re-seeds. Empty history falls back to the client welcome greeting.
  const snapChatRef = useRef<ChatMessage[]>(snap.chat);
  snapChatRef.current = snap.chat;
  useEffect(() => {
    const persisted = snapChatRef.current.filter((message) => message.source !== 'interviewer');
    setChat(persisted.length > 0 ? persisted : welcomeChat);
  }, [snap.activeWorkspaceId, welcomeChat]);
  const [stageOverrides, setStageOverrides] = useState<Record<string, string>>({});
  //? P4 — the optimistic AI-move override (moveTicket) is TRANSIENT: once the authoritative ticket delta
  //? lands with the server's `stageId`, drop any override that now matches it so the server stage wins. A
  //? full refetch replaces `snap.tickets` but leaves this separate map untouched, so without this an
  //? AI-move override could keep masking another user's real move — the two boards would diverge on the same
  //? ticket's column. Match-based drop avoids flicker (the override holds until the move is confirmed).
  useEffect(() => {
    setStageOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, stage] of Object.entries(prev)) {
        const ticket = snap.tickets.find((t) => t.id === id);
        if (ticket?.stageId === stage) { changed = true; continue; }
        next[id] = stage;
      }
      return changed ? next : prev;
    });
  }, [snap.tickets]);
  const [localSuggestionsDismissed, setLocalSuggestionsDismissed] = useState<string[]>([]);

  //? #76 — persist to the account via the ssh-key routes, then refetch. The key authenticates as the
  //? logged-in user (the server sets userId from the session), so there is no client-side user resolution.
  const addSshKey = useCallback((input: { name: string; type: string; fingerprint: string; publicKey: string }) => { void apiRequest({ name: 'workspaces/sshKeyAdd', version: 'v1', data: input }).then(() => { refetch(); }); }, [refetch]);
  const removeSshKey = useCallback((id: string) => { void apiRequest({ name: 'workspaces/sshKeyRemove', version: 'v1', data: { id } }).then(() => { refetch(); }); }, [refetch]);
  const sshUserId = sshKeys.at(-1)?.userId ?? null;

  //? currentUser = the logged-in session user (falls back to the owner member).
  const currentUser: Member = useMemo(() => {
    const s = session;
    const inMembers = s ? snap.members.find((m) => m.id === s.id) : undefined;
    if (inMembers) return inMembers;
    if (s) return { id: s.id, name: s.name ?? s.email, email: s.email, avatar: s.avatar.length > 0 ? s.avatar : undefined, avatarFallback: s.avatarFallback.length > 0 ? s.avatarFallback : '#6366F1', role: 'owner', roleKey: 'owner' };
    return { id: '', name: '', email: '', avatarFallback: '#6366F1', role: 'member', roleKey: 'member' };
  }, [session, snap.members]);

  const membersById = useMemo(() => Object.fromEntries(snap.members.map((m) => [m.id, m])), [snap.members]);

  //? #119 — per-view presence counts (OTHER members currently on each nav view), for the nav badges.
  //? Self is excluded so your own view doesn't always show a "1".
  const viewCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [uid, v] of Object.entries(viewPresence)) { if (uid === currentUser.id) continue; counts[v.view] = (counts[v.view] ?? 0) + 1; }
    return counts;
  }, [viewPresence, currentUser.id]);

  //? Send a chat message to the live Workspace-AI: echo the user turn + a pending AI
  //? bubble immediately, then resolve it with the AI's reply and (if any) a VALIDATED
  //? action proposal the user can accept. The AI never writes — acceptChatProposal does.
  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    const scope = currentProjectScope();
    if (!trimmed || !scope) return;
    const stamp = String(reqCounter + 1); reqCounter += 1;
    const aiId = `a${stamp}`;
    //? #112 — send the recent conversation so the AI can follow up ("do that for the other ticket too").
    const history = chat.filter((m) => !m.pending && m.text.length > 0).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setChat((prev) => [...prev, { id: `u${stamp}`, role: 'user', text: trimmed }, { id: aiId, role: 'ai', text: '', pending: true }]);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/aiChat', version: 'v1', data: { workspaceId: scope.workspaceId, projectId: scope.projectId, message: trimmed, ...(history.length > 0 ? { history } : {}), clientRequestId: nextReqId() } }));
      setChat((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        if (error || res?.status !== 'success' || res.result.error) {
          return { ...m, pending: false, text: translate({ key: 'workspaces.shell.aiError' }) };
        }
        const { reply, proposal, plan, copilot } = res.result;
        return { ...m, pending: false, text: reply, ...(proposal ? { proposal } : {}), ...(plan ? { plan } : {}), ...(copilot ? { copilot } : {}) };
      }));
    })();
  }, [chat, currentProjectScope, translate]);

  //? Accept an AI proposal → dispatch the matching control-op via the same `_sync` routes
  //? the manual UI uses (so execution stays under the Conductor + OP_CAPABILITY RBAC) and
  //? mark the bubble consumed so its Accept button can't re-fire.
  //? Dispatch a SINGLE proposal to the existing `_sync` verb (never a new verb; Conductor stays the writer).
  //? Shared by acceptChatProposal (one op) and acceptChatPlan (O-A, each step in order).
  const dispatchProposal = useCallback(async (p: ChatProposal): Promise<boolean> => {
    const scope = currentProjectScope();
    if (!scope || !isChatProposalForProject(p, scope.projectId)) return false;
    const room = scope.workspaceId;
    if (p.op === 'bulk-move' && p.ticketKeys && p.stageId) {
      const { ticketKeys, stageId } = p;
      const receipt = await syncRequest({ name: 'workspaces/bulkMove', version: 'v1', data: { ticketIds: ticketKeys, stageId, projectId: p.projectId, clientRequestId: nextReqId() }, receiver: room });
      if (receipt.status === 'success') {
        setStageOverrides(() => Object.fromEntries(ticketKeys.map((ticketId) => [ticketId, stageId])));
      }
      return receipt.status === 'success';
    }
    if (p.op === 'assign' && p.ticketKeys && p.assigneeId) {
      const receipt = await syncRequest({ name: 'workspaces/bulkAssign', version: 'v1', data: { ticketIds: p.ticketKeys, assigneeId: p.assigneeId, clientRequestId: nextReqId() }, receiver: room });
      return receipt.status === 'success';
    }
    if (p.op === 'add-comment' && p.ticketKeys?.[0] && p.body) {
      const receipt = await syncRequest({ name: 'workspaces/addComment', version: 'v1', data: { ticketId: p.ticketKeys[0], body: p.body, clientRequestId: nextReqId() }, receiver: room });
      return receipt.status === 'success';
    }
    //? O-B — create ops route to the EXISTING verbs (quick-add / content-from-brief), not a new one.
    if (p.op === 'create-ticket' && p.title) {
      const receipt = await syncRequest({ name: 'workspaces/quickAdd', version: 'v1', data: { title: p.title, projectId: p.projectId, ...(p.description ? { description: p.description } : {}), clientRequestId: nextReqId() }, receiver: room });
      if (receipt.status === 'success') refetch();
      return receipt.status === 'success';
    }
    if (p.op === 'create-content' && p.title && p.brief) {
      const receipt = await syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-from-brief', title: p.title, brief: p.brief, format: p.format ?? 'faceless', clientRequestId: nextReqId() }, receiver: room });
      if (receipt.status === 'success') refetch();
      return receipt.status === 'success';
    }
    //? X1 — generic catalog ops: the CHAT_DISPATCH tranche routes each op through the same `_sync`
    //? route its manual UI (would) use — RBAC + Conductor single-writer intact.
    if (isChatEnabledOp(p.op)) {
      //? Parity wave — merge sources for the full-payload routes (saveAiInstruction writes all five
      //? fields; saveStageConfig wants the complete cfg) + the provider's own delete-workspace flow.
      const ws = latestSnap.current.workspaces.find((w) => w.id === room);
      return executeTrackedChatDispatch(p.op, p, {
        room, activeProjectId: scope.projectId, gitConfig: scope.gitConfig,
        aiSettings: {
          aiInstruction: ws?.aiInstruction ?? '', outputLanguage: ws?.outputLanguage ?? '',
          geminiModel: ws?.geminiModel ?? '', geminiTemperature: ws?.geminiTemperature ?? '', geminiBaseUrl: ws?.geminiBaseUrl ?? '',
        },
        stageConfigs: latestSnap.current.stageConfigs,
        deleteWorkspace: async () => {
          //? Same flow as the settings UI's deleteWorkspace: fire the `_api`, then leave the dead
          //? workspace (reset the desired snapshot target so the refetch lands on a valid one).
          const receipt = await apiRequest({ name: 'workspaces/deleteWorkspace', version: 'v1', data: { workspaceId: room, clientRequestId: nextReqId() } });
          if (receipt.status === 'success') {
            desiredSnapshotTarget.current = { workspaceId: undefined, projectId: undefined };
            setWantWorkspaceId(undefined);
            setWantProjectId(undefined);
            setLoading(true);
          }
          return receipt;
        },
        nextReqId, refetch,
      });
    }
    return false;
  }, [currentProjectScope, refetch]);

  const acceptChatProposal = useCallback((messageId: string, p: ChatProposal) => {
    const run = async (): Promise<void> => {
      setChat((prev) => prev.map((m) => (m.id === messageId ? { ...m, executing: true, executionError: false } : m)));
      const [executionError, accepted] = await tryCatch(() => dispatchProposal(p));
      const succeeded = !executionError && accepted === true;
      setChat((prev) => prev.map((m) => (m.id === messageId ? { ...m, executing: false, ...(succeeded ? { accepted: true, executionError: false } : { executionError: true }) } : m)));
    };
    //? X1 — destructive generic ops get an EXPLICIT extra confirm before dispatch (B-23
    //? confirm-on-important; user decision 2026-07-09). The project is rechecked AFTER
    //? the confirm resolves, closing the switch-while-dialog-open race.
    if (p.destructive) {
      void menuHandler.confirm({
        title: translate({ key: 'workspaces.shell.confirmDestructiveTitle' }),
        content: translate({ key: 'workspaces.shell.confirmDestructiveContent', params: [{ key: 'summary', value: p.summary }] }),
      }).then((ok) => { if (ok) void run(); });
      return;
    }
    void run();
  }, [dispatchProposal, translate]);

  //? J5 — REJECT a proposal/plan: dismiss it (mark declined) WITHOUT dispatching anything. The AI proposes,
  //? the user disposes — declining is a first-class outcome, not just "ignore the bubble". No server write.
  const rejectChatProposal = useCallback((messageId: string) => {
    setChat((prev) => prev.map((m) => (m.id === messageId ? { ...m, declined: true } : m)));
  }, []);

  //? O-A — approve a whole intake plan: dispatch each step in order (single-writer intact; each step is an
  //? existing verb). One approval → the Conductor materializes every ticket/piece the plan proposed.
  const acceptChatPlan = useCallback((messageId: string, plan: ChatPlan) => {
    const run = async (): Promise<void> => {
      const scope = currentProjectScope();
      const current = scope !== null && plan.steps.length > 0 && plan.steps.every((step) => isChatProposalForProject(step, scope.projectId));
      setChat((prev) => prev.map((m) => (m.id === messageId ? { ...m, executing: current, executionError: !current } : m)));
      let accepted = current;
      if (current) {
        //? Plans execute in order and stop at the first failed receipt, so dependent later steps cannot
        //? materialize on top of a rejected/failed prerequisite.
        for (const step of plan.steps) {
          const [executionError, stepAccepted] = await tryCatch(() => dispatchProposal(step));
          if (executionError || stepAccepted !== true) { accepted = false; break; }
        }
      }
      setChat((prev) => prev.map((m) => (m.id === messageId ? { ...m, executing: false, ...(accepted ? { accepted: true, executionError: false } : { executionError: true }) } : m)));
    };
    //? X1 — a plan containing destructive steps gets ONE explicit confirm listing them (the plan
    //? approval itself covers the rest — B-23 confirm-on-important). Scope is rechecked on resolve.
    const destructive = plan.steps.filter((s) => s.destructive === true);
    if (destructive.length > 0) {
      void menuHandler.confirm({
        title: translate({ key: 'workspaces.shell.confirmDestructiveTitle' }),
        content: translate({ key: 'workspaces.shell.confirmDestructiveContent', params: [{ key: 'summary', value: destructive.map((s) => s.summary).join(' · ') }] }),
      }).then((ok) => { if (ok) void run(); });
      return;
    }
    void run();
  }, [currentProjectScope, dispatchProposal, translate]);

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
      trail,
      navigate: (v, t) => { void navigate(pathForTrail(v, t)); },
      //? Replaces the trail on the CURRENT view — a tab/section change. It pushes rather than
      //? replaces, so "back" walks out of a sub-section the way a user expects it to.
      setTrail: (t) => {
        //? Anchored on the current PATH's trail root, falling back to the view only when the path has
        //? none (the very first navigation onto a rooted page).
        const root = trailRootOf(location.pathname);
        if (root === undefined) { void navigate(pathForTrail(view, t)); return; }
        const clean = t.filter((seg) => seg.length > 0).map((seg) => encodeURIComponent(seg));
        void navigate(clean.length > 0 ? `${BASE}/${root}/${clean.join('/')}` : `${BASE}/${root}`);
      },
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
      offline,
      queuedWrites,
      retryQueuedWrites,
      suggestions: activeSuggestions,
      dismissSuggestion: (id) => {
        setLocalSuggestionsDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]));
        const room = snap.activeWorkspaceId;
        if (room) {
          const reqId = nextReqId();
          const send = () => { void syncRequest({ name: 'workspaces/acceptSuggestion', version: 'v1', data: { suggestionId: id, action: 'dismiss', clientRequestId: reqId }, receiver: room }); };
          if (offlineRef.current) parkWrite(send); else send();
        }
      },
      acceptSuggestion: (id) => {
        const room = snap.activeWorkspaceId;
        if (room) {
          //? B1 — park instead of dropping when the socket is down; the reqId is minted NOW so the replay
          //? stays idempotent.
          const reqId = nextReqId();
          const send = () => { void syncRequest({ name: 'workspaces/acceptSuggestion', version: 'v1', data: { suggestionId: id, clientRequestId: reqId }, receiver: room }); };
          if (offlineRef.current) parkWrite(send); else send();
        }
        //? #109 — a COPILOT suggestion ("AI drives the UI") carries a { navigate } directive in its patch:
        //? on accept, drive the client there (the accept-suggestion op above flips its status server-side).
        const sug = snap.suggestions.find((s) => s.id === id);
        if (sug?.type === 'copilot' && sug.patch !== null && typeof sug.patch === 'object') {
          const target = (sug.patch as Record<string, unknown>).navigate;
          if (typeof target === 'string' && target.length > 0) void navigate(pathForView(target));
        }
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
      interviewerChat,
      sendChat,
      //? #109 — apply an AI-drives-UI copilot directive: drop the prefill for the target page, then navigate there.
      applyCopilot: (d) => { setCopilotPrefill(d.prefill ?? null); void navigate(pathForView(d.navigate)); },
      copilotPrefill,
      consumeCopilotPrefill: () => { setCopilotPrefill(null); },
      //? Setup readiness + permission-aware fix routing (new-user UX).
      readiness: snap.readiness,
      myPerms: snap.myPerms,
      can: (cap) => snap.myPerms[cap] === true,
      //? ADR 0312 — a deep-link is now just a URL. It used to navigate AND push a separate focus
      //? request through context, which the target page had to consume and clear; the destination was
      //? therefore unlinkable and lost on refresh, and "fix it over there" landed on the default tab
      //? whenever the two mechanisms disagreed.
      focusSetup: (target) => {
        void navigate(pathForTrail(target.view, [target.tab ?? '', target.section ?? '']));
      },
      acceptChatProposal,
      acceptChatPlan,
      rejectChatProposal,
      workspaces: snap.workspaces,
      activeWorkspace,
      setActiveWorkspace: (id) => {
        //? Return to the project we were last on in this workspace (no flip to the default), and — if that
        //? entry is cached — render it INSTANTLY while the refetch effect (fired by the want* change) freshens
        //? it in the background. Uncached → the normal loading path.
        const projId = lastProjectByWsRef.current.get(id);
        //? An empty stored project (a no-project workspace) targets undefined so the server picks; a real id
        //? returns us to that exact project.
        const targetProject = projId === undefined || projId.length === 0 ? undefined : projId;
        desiredSnapshotTarget.current = { workspaceId: id, projectId: targetProject };
        setWantWorkspaceId(id);
        setWantProjectId(targetProject);
        const cached = projId === undefined ? undefined : snapCacheRef.current.get(snapKey(id, projId));
        if (cached) { setSnap(cached); setLoading(false); } else { setLoading(true); }
      },
      //? GAP_SCAN F5 — post the reply the user approved (the AI only ever drafted it). Conductor writes.
      replyToComment: (commentId, replyText) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-reply-comment', commentId, replyText, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? G4 — star/unstar an asset for the workspace-wide library (B-23 via contentControl).
      restoreTrashed: (trashId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'media-trash-restore', trashId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      purgeTrashed: (trashId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'media-trash-purge', trashId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      setAssetStarred: (assetId, starred) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'asset-star', assetId, starred, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? G2 — clone this workspace's SETUP into a new one (no tickets, content, credentials or members).
      cloneWorkspace: (name) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/cloneWorkspace', version: 'v1', data: { name, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? G5 — `presetKey` picks how heavy the seeded pipeline is (simple/advanced/professional).
      createWorkspace: (name, enabledSections, presetKey, packId) => { afterWrite(apiRequest({ name: 'workspaces/createWorkspace', version: 'v1', data: { name, ...(enabledSections ? { enabledSections } : {}), ...(presetKey ? { presetKey } : {}), ...(packId ? { packId } : {}), clientRequestId: nextReqId() } })); },
      //? Multi-project / multi-service (ADR 0035).
      projects: snap.projects,
      activeProject: snap.projects.find((project) => project.id === snap.activeProjectId) ?? null,
      activeProjectId: snap.activeProjectId,
      setActiveProject: (id) => {
        //? Same instant-cache path as workspace switch: render a cached project immediately, refetch to freshen.
        desiredSnapshotTarget.current = { workspaceId: wantWorkspaceId, projectId: id };
        setWantProjectId(id);
        const wsId = latestSnap.current.activeWorkspaceId;
        const cached = wsId ? snapCacheRef.current.get(snapKey(wsId, id)) : undefined;
        if (cached) { setSnap(cached); setLoading(false); } else { setLoading(true); }
      },
      services: snap.services,
      templates: snap.templates,
      createProject: createProjectApi,
      createFromTemplate: createFromTemplateApi,
      applyDesignTokens: applyDesignTokensApi,
      createService: createServiceApi,
      deleteService: deleteServiceApi,
      serviceStacks: snap.serviceStacks,
      provisionServiceStack: provisionServiceStackApi,
      teardownServiceStack: teardownServiceStackApi,
      dbConnections: snap.dbConnections,
      migrations: snap.migrations,
      dbConnect: dbConnectApi,
      dbMigrateCreate: dbMigrateCreateApi,
      dbMigrateApply: dbMigrateApplyApi,
      dbIntrospect: dbIntrospectApi,
      connectForge: connectForgeApi,
      disconnectForge: disconnectForgeApi,
      environments: snap.environments,
      deployEnv: deployEnvApi,
      teardownEnv: teardownEnvApi,
      rollbackEnv: rollbackEnvApi,
      promoteEnv: promoteEnvApi,
      buildArtifacts: snap.buildArtifacts,
      exportBuild: exportBuildApi,
      myInvites: snap.myInvites,
      acceptInvite: (token) => { afterWrite(apiRequest({ name: 'workspaces/acceptInvite', version: 'v1', data: { inviteToken: token, clientRequestId: nextReqId() } })); },
      sprintCreate: sprintCreateApi,
      editSprint: editSprintApi,
      renameWorkspace: (name) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/renameWorkspace', version: 'v1', data: { name, clientRequestId: nextReqId() }, receiver: room })); },
      deleteWorkspace: () => {
        void apiRequest({ name: 'workspaces/deleteWorkspace', version: 'v1', data: { workspaceId: snap.activeWorkspaceId ?? '', clientRequestId: nextReqId() } }).then((response) => {
          if (reportRequestFailure(response)) return;
          desiredSnapshotTarget.current = { workspaceId: undefined, projectId: undefined };
          setWantWorkspaceId(undefined);
          setWantProjectId(undefined);
          setLoading(true);
          refetch();
        }, () => { notify.error({ key: 'workspaces.syncFailed' }); });
      },
      saveGitlab: (baseUrl, token, forgeType) => {
        const room = snap.activeWorkspaceId;
        if (room) observeSync(syncRequest({ name: 'workspaces/gitlabSettings', version: 'v1', data: { baseUrl, ...(token ? { token } : {}), ...(forgeType ? { forgeType } : {}), clientRequestId: nextReqId() }, receiver: room }));
      },
      //? #27 — only the initiating browser receives this write-once value. The snapshot keeps
      //? `webhookConfigured` metadata, so neither a refetch nor room broadcast can leak it.
      rotateWebhookSecret: async () => {
        const workspaceId = snap.activeWorkspaceId;
        if (!workspaceId) return null;
        const [requestError, response] = await tryCatch(() => apiRequest({
          name: 'workspaces/rotateWebhookSecret', version: 'v1', data: { workspaceId, clientRequestId: nextReqId() },
        }));
        if (requestError || response?.status !== 'success' || response.result.webhookSecret.length === 0) return null;
        const secret = response.result.webhookSecret;
        setSnap((current) => ({ ...current, workspaces: current.workspaces.map((workspace) => (workspace.id === workspaceId ? { ...workspace, webhookConfigured: true } : workspace)) }));
        return secret;
      },
      //? R2 — copy the user-authored styles + brand kit from another workspace INTO the active one (server route
      //? existed; this wires the client dispatch). The Conductor authorizes source membership (B-23).
      copyWorkspaceAssets: (sourceWorkspaceId) => {
        const room = snap.activeWorkspaceId;
        if (room && sourceWorkspaceId) observeSync(syncRequest({ name: 'workspaces/copyWorkspaceAssets', version: 'v1', data: { sourceWorkspaceId, clientRequestId: nextReqId() }, receiver: room }));
      },
      //? Reindex the workspace's institutional memory (RAG). One-click via the existing projectAdmin op-router.
      indexMemory: () => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'index-memory', clientRequestId: nextReqId() }, receiver: room });
      },
      //? AI plan-critique (ADR 0044): attack a ticket's plan before implement → a WorkspaceSuggestion the user
      //? accepts. One-click via the projectAdmin op-router; the result surfaces in the suggestions feed.
      planCritique: (ticketKey) => {
        const room = snap.activeWorkspaceId;
        if (room && ticketKey) void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'plan-critique', ticketKey, clientRequestId: nextReqId() }, receiver: room });
      },
      //? AI/token budget editor (D81): set the cap (+ alert %). The first edit creates the budget (no create-op).
      //? #103 — multi-cap: `budgetId` edits a specific cap (or enabled:false retires it), `create` adds a new
      //? cap; no id/create = the legacy first-cap edit/create. Only the provided fields are sent.
      editBudget: (input) => {
        const room = snap.activeWorkspaceId;
        if (room) observeSync(syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'edit-budget', ...input, clientRequestId: nextReqId() }, receiver: room }));
      },
      //? Resume spending after a budget freeze (resets the window's spent to 0).
      resumeSpend: () => {
        const room = snap.activeWorkspaceId;
        if (room) observeSync(syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'resume-spend', clientRequestId: nextReqId() }, receiver: room }));
      },
      //? Pull the active project's open forge issues (GitLab|GitHub) + upsert them as tickets (ADR 0036).
      resyncForge: () => {
        const scope = currentProjectScope();
        if (scope) void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'gitlab-resync', projectId: scope.projectId, clientRequestId: nextReqId() }, receiver: scope.workspaceId });
      },
      //? ci-allow-red: let a human merge while CI is red (workspace-level toggle).
      allowCiRed: (enabled) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'ci-allow-red', enabled, clientRequestId: nextReqId() }, receiver: room });
      },
      //? root-cause (ADR 0042): given a symptom + recent merges, rank the likely-culprit merge → a rollback
      //? WorkspaceSuggestion (shown in the AI panel; never reverts directly — B-23).
      diagnoseRootCause: (symptom) => {
        const room = snap.activeWorkspaceId;
        if (room && symptom.trim()) void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'root-cause', symptom: symptom.trim(), clientRequestId: nextReqId() }, receiver: room });
      },
      //? ui-review-create (U1): file a "unfuck the UI" request — screenshots + ticked problems + notes → the
      //? Conductor persists it (B-23), leading to a redesign ticket.
      createUiReview: (input) => {
        const room = snap.activeWorkspaceId;
        const projectId = snap.activeProjectId;
        if (room && projectId && (input.screenshots.length > 0 || input.problems.length > 0 || (input.notes ?? '').trim().length > 0)) {
          void syncRequest({ name: 'workspaces/uiReviewCreate', version: 'v1', data: { projectId, screenshots: input.screenshots, problems: input.problems, ...(input.page ? { page: input.page } : {}), ...(input.notes ? { notes: input.notes } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); });
        }
      },
      //? A persisted review project survives a later UI switch. Legacy null-project reviews use the
      //? explicitly supplied current project; the Conductor never falls back to project #1.
      uiReviews: snap.uiReviews,
      uiReviewAction: (op, reviewId, projectId) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        if (op === 'ui-review-to-ticket') {
          if (!projectId) return;
          void syncRequest({ name: 'workspaces/uiReviewAction', version: 'v1', data: { op, reviewId, projectId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); });
          return;
        }
        void syncRequest({ name: 'workspaces/uiReviewAction', version: 'v1', data: { op, reviewId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); });
      },
      repo: snap.repo,
      linkRepo: (gitUrl, token) => {
        const room = snap.activeWorkspaceId;
        const projectId = snap.activeProjectId;
        if (room && projectId) void syncRequest({ name: 'workspaces/linkRepo', version: 'v1', data: { projectId, gitUrl, ...(token ? { token } : {}), clientRequestId: nextReqId() }, receiver: room });
      },
      unlinkRepo: () => {
        const room = snap.activeWorkspaceId;
        const projectId = snap.activeProjectId;
        if (room && projectId) void syncRequest({ name: 'workspaces/linkRepo', version: 'v1', data: { projectId, disconnect: true, clientRequestId: nextReqId() }, receiver: room });
      },
      scanDocs: () => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/scanDocs', version: 'v1', data: { clientRequestId: nextReqId() }, receiver: room });
      },
      //? K2 — register an uploaded doc (md/txt) as a context-doc InfoSource the AI can use.
      addInfoDoc: (name, content) => {
        const room = snap.activeWorkspaceId;
        if (room) observeSync(syncRequest({ name: 'workspaces/addInfoDoc', version: 'v1', data: { name, content, clientRequestId: nextReqId() }, receiver: room }));
      },
      infoDocAdmin: (docId, action) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/infoDocAdmin', version: 'v1', data: { docId, action, clientRequestId: nextReqId() }, receiver: room });
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
        if (room) observeSync(syncRequest({ name: 'workspaces/roleUpdate', version: 'v1', data: { roleKey: role.key, perms, clientRequestId: nextReqId() }, receiver: room }));
      },
      addRole: (name) => {
        const room = snap.activeWorkspaceId;
        const key = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || `role-${String(snap.roles.length + 1)}`;
        const perms = (snap.roles[0]?.perms ?? []).map(() => false);
        if (room) observeSync(syncRequest({ name: 'workspaces/roleCreate', version: 'v1', data: { key, label: name, perms, clientRequestId: nextReqId() }, receiver: room }));
      },
      memberRoles: Object.fromEntries(snap.members.map((m) => [m.id, m.roleKey ?? m.role])),
      setMemberRole: (mid, role) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/changeRole', version: 'v1', data: { memberId: mid, roleKey: role, clientRequestId: nextReqId() }, receiver: room })); },
      inviteMember: (email, roleKey) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/invite', version: 'v1', data: { email, roleKey, clientRequestId: nextReqId() }, receiver: room })); },
      revokeInvite: (inviteId) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/revokeInvite', version: 'v1', data: { inviteId, clientRequestId: nextReqId() }, receiver: room })); },
      removeMember: (memberId) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/removeMember', version: 'v1', data: { memberId, clientRequestId: nextReqId() }, receiver: room })); },
      transferOwnership: (memberId) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/transferOwnership', version: 'v1', data: { memberId, clientRequestId: nextReqId() }, receiver: room })); },
      envVars: snap.envVars,
      saveEnvVar: (v) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/saveEnv', version: 'v1', data: { key: v.key, value: v.value, secret: v.secret, clientRequestId: nextReqId() }, receiver: room })); },
      removeEnvVar: (id) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/removeEnv', version: 'v1', data: { envId: id, clientRequestId: nextReqId() }, receiver: room })); },
      integrationTools: snap.integrations,
      saveIntegrationTool: (t) => {
        const room = snap.activeWorkspaceId;
        const known = snap.integrations.some((x) => x.id === t.id);
        if (room) observeSync(syncRequest({ name: 'workspaces/saveIntegration', version: 'v1', data: { ...(known ? { integrationId: t.id } : {}), name: t.name, type: t.type, fields: t.fields, mcp: t.mcp, clientRequestId: nextReqId() }, receiver: room }));
      },
      removeIntegrationTool: (id) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/removeIntegration', version: 'v1', data: { integrationId: id, clientRequestId: nextReqId() }, receiver: room })); },
      testIntegrationTool: async (id) => {
        const room = snap.activeWorkspaceId;
        if (!room) return { ok: false };
        const [error, res] = await tryCatch(() => syncRequest({ name: 'workspaces/integrationTest', version: 'v1', data: { integrationId: id, clientRequestId: nextReqId() }, receiver: room }));
        //? Refetch regardless of the verdict: a failed test is still a result worth persisting on the row.
        refetch();
        if (error || res?.status !== 'success') return { ok: false };
        const result = res.result as { status?: string; detail?: string } | undefined;
        return { ok: true, ...(result?.status === undefined ? {} : { status: result.status }), ...(result?.detail === undefined ? {} : { detail: result.detail }) };
      },
      stageOverrides,
      moveTicket: (id, stage) => { setStageOverrides((prev) => ({ ...prev, [id]: stage })); },
      quickAdd: quickAddApi,
      //? Realtime writes — per-action `_sync` event → delta broadcast → client merge.
      editTicket: (id, patch) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/ticketEdit', version: 'v1', data: { ticketId: id, ...patch, clientRequestId: nextReqId() }, receiver: room }); },
      addComment: (ticketId, body) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/addComment', version: 'v1', data: { ticketId, body, clientRequestId: nextReqId() }, receiver: room }); },
      //? B1 — the other half of the phone loop: an answer typed while offline is parked + replayed.
      answerInput: (ticketId, answer, advisoryIndex) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        const key = answerKey(ticketId, advisoryIndex);
        //? F45 — the request id is DERIVED from what is being answered, not random: a double-tap carries the
        //? same id and the Conductor's idempotency drops it instead of queueing a second answer.
        //?
        //? It must key on the QUESTION, not just the ticket. Keying on the ticket alone made the id stable
        //? across DIFFERENT questions on the same ticket, so the next question's answer was silently
        //? swallowed as a replay of the previous one — the ticket stayed parked and the button stayed
        //? spinning. A browser pass caught it; no unit test would have, because the write "succeeded".
        const askedNow = snap.tickets.find((t) => t.id === ticketId)?.needsInput ?? '';
        const reqId = `answer:${key}:${shortHash(askedNow)}`;
        const send = () => {
          setPendingAnswers((prev) => ({ ...prev, [key]: true }));
          void syncRequest({ name: 'workspaces/answerInput', version: 'v1', data: { ticketKey: ticketId, answer, ...(typeof advisoryIndex === 'number' ? { advisoryIndex } : {}), clientRequestId: reqId }, receiver: room })
            .then((response) => {
              //? A refused write used to vanish silently — the banner simply stayed put, which reads as
              //? "the click did nothing" rather than "you are not allowed to do that".
              if (response.status !== 'success') {
                notify.error({ key: response.errorCode });
                setPendingAnswers((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
              }
              //? On success the flag stays until the ticket delta arrives: the Conductor accepting the op
              //? is not the same as the answer having taken effect, and the button must stay locked for
              //? the whole gap. `clearPendingAnswers` below releases it on the real state change.
            });
        };
        if (offlineRef.current) parkWrite(send); else send();
      },
      isAnswerPending: (ticketId: string, advisoryIndex?: number): boolean => pendingAnswers[answerKey(ticketId, advisoryIndex)] === true,
      setTicketPresence,
      viewersOf: (ticketKey: string): string[] => Object.entries(presence).filter(([uid, v]) => v.ticketKey === ticketKey && uid !== currentUser.id).map(([uid]) => uid),
      //? #117 — everyone present in the workspace right now (the presence state is already tick-pruned).
      presentUserIds: Object.keys(presence),
      viewCounts,
      agentTerm,
      //? Review ergonomics (ADR 0048): the cross-ticket answer-queue + soft-claim.
      content: snap.content,
      claimTicket: claimTicketApi,
      //? Who (if anyone) has soft-claimed this ticket's question (is answering it) — null if free.
      claimedBy: (ticketKey: string): string | null => (Object.entries(presence).find(([, v]) => v.ticketKey === ticketKey && v.claiming === true)?.[0]) ?? null,
      archiveTicket: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/archive', version: 'v1', data: { ticketId: id, clientRequestId: nextReqId() }, receiver: room }); },
      bulkMove: (ids, stageId) => { const room = snap.activeWorkspaceId; const projectId = snap.activeProjectId; if (room && projectId) void syncRequest({ name: 'workspaces/bulkMove', version: 'v1', data: { ticketIds: ids, stageId, projectId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkStatus: (ids, status) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkStatus', version: 'v1', data: { ticketIds: ids, status, clientRequestId: nextReqId() }, receiver: room }); },
      bulkAssign: (ids, assigneeId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkAssign', version: 'v1', data: { ticketIds: ids, assigneeId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkSprint: (ids, sprintId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkSprint', version: 'v1', data: { ticketIds: ids, sprintId, clientRequestId: nextReqId() }, receiver: room }); },
      bulkArchive: (ids) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/bulkArchive', version: 'v1', data: { ticketIds: ids, clientRequestId: nextReqId() }, receiver: room }); },
      unarchiveTickets: (ids) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/unarchive', version: 'v1', data: { ticketIds: ids, clientRequestId: nextReqId() }, receiver: room }); },
      toggleSkill: (id, on) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/skillToggle', version: 'v1', data: { sourceId: id, on, clientRequestId: nextReqId() }, receiver: room }); },
      stageConfigs: snap.stageConfigs,
      saveStageConfig: (cfg) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/saveStageConfig', version: 'v1', data: { stageId: cfg.id, projectId: cfg.projectId, cfg, clientRequestId: nextReqId() }, receiver: room }); },
      //? I1 — projectAdmin resolves + executes immutable-ref CI outside the writer, then dispatches its report.
      runCi: (ticketKey, serviceId) => { const room = snap.activeWorkspaceId; const projectId = snap.activeProjectId; if (room && projectId) void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'ci-run', projectId, ticketKey, ...(serviceId === undefined ? {} : { serviceId }), clientRequestId: nextReqId() }, receiver: room }); },
      //? R1 — persist stage add/remove/reorder through the existing stageCreate/Delete/Reorder `_sync` routes
      //? (Conductor single-writer). The editor calls these so structural edits survive a refresh.
      createStage: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/stageCreate', version: 'v1', data: { projectId: input.projectId, key: input.key, name: input.name, ...(input.kind ? { kind: input.kind } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteStage: (projectId, stageKey) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/stageDelete', version: 'v1', data: { stageId: stageKey, projectId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      reorderStages: (projectId, order) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/stageReorder', version: 'v1', data: { order, projectId, clientRequestId: nextReqId() }, receiver: room }); },
      //? Structural in 'switch' mode (stages added/removed/reordered), so this always refetches rather
      //? than merging a single-row delta.
      applyPipelinePreset: (projectId, preset, mode) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/pipelinePreset', version: 'v1', data: { projectId, preset, mode, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      gitConfig: snap.gitConfig,
      saveGitConfig: (cfg) => { const room = snap.activeWorkspaceId; if (room) observeSync(syncRequest({ name: 'workspaces/saveGitConfig', version: 'v1', data: { gitConfig: cfg, clientRequestId: nextReqId() }, receiver: room })); },
      //? Module gating: optimistically flip the active workspace's enabledSections (instant
      //? nav re-render) then persist via the [save-sections] control-op; the broadcast
      //? reconciles idempotently.
      saveSections: (enabledSections) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        setSnap((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === room ? { ...w, enabledSections } : w)) }));
        observeSync(syncRequest({ name: 'workspaces/saveSections', version: 'v1', data: { enabledSections, clientRequestId: nextReqId() }, receiver: room }));
      },
      //? E5 — user-defined AI tasks (create/update, delete, run). Run stays propose/generate (output only).
      saveCustomTask: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'save-custom-task', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteCustomTask: (taskId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'delete-custom-task', taskId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      runCustomTask: (taskId, vars) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'run-custom-task', taskId, vars, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? #167 — invoke an agent-role now (interviewer "Generate ideas now"); refetch to surface new findings.
      runAgentRole: (role, focus) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'run-agent-role', role, ...(focus?.trim() ? { focus: focus.trim() } : {}), ...(snap.activeProjectId ? { projectId: snap.activeProjectId } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? O5 — reusable output specs (save/delete).
      outputTemplates: snap.outputTemplates,
      saveOutputTemplate: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/outputTemplate', version: 'v1', data: { op: 'save-output-template', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteOutputTemplate: (templateId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/outputTemplate', version: 'v1', data: { op: 'delete-output-template', templateId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? DOC — the Documents module (all writes via the documentsControl sync route → Conductor).
      documents: snap.documents,
      documentTemplates: snap.documentTemplates,
      createDocument: (title, content, templateSlug) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-create', title, ...(content ? { content } : {}), ...(templateSlug ? { templateSlug } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      saveDocTemplate: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'doc-template-save', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteDocTemplate: (slug) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'doc-template-delete', slug, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      editDocument: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-edit', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? C7 — archive/restore a document (keeps every revision; the list hides archived by default).
      archiveDocument: (documentId, archived) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: archived ? 'document-archive' : 'document-unarchive', documentId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteDocument: (documentId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-delete', documentId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      runDocumentAi: (documentId, mode, instruction) => {
        const room = snap.activeWorkspaceId;
        if (!room) return Promise.resolve('sync.missingReceiver');
        return syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-ai', documentId, mode, instruction, clientRequestId: nextReqId() }, receiver: room }).then((response) => {
          refetch();
          return response.status === 'success' ? null : response.errorCode;
        });
      },
      applyDocumentDraft: (documentId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-apply-draft', documentId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      discardDocumentDraft: (documentId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-discard-draft', documentId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? C2 — with an assetId this REUSES an approved asset (no generation, no spend); without one it generates.
      genDocumentImage: (documentId, prompt, assetId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-gen-image', documentId, prompt, ...(assetId ? { assetId } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      exportDocument: (documentId, format) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-export', documentId, format, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      restoreDocumentRevision: (documentId, revisionId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-restore-revision', documentId, revisionId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? CI — the read-only comment inbox.
      refreshComments: () => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/commentInbox', version: 'v1', data: { op: 'comments-refresh', clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      markCommentsRead: (commentId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/commentInbox', version: 'v1', data: { op: 'comments-mark-read', ...(commentId ? { commentId } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? SK1 — the universal AI-skills layer (save/toggle/delete/reset via the skillsControl sync route).
      aiSkills: snap.aiSkills,
      saveAiSkill: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/skillsControl', version: 'v1', data: { op: 'ai-skill-save', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteAiSkill: (skillId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/skillsControl', version: 'v1', data: { op: 'ai-skill-delete', skillId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      resetAiSkill: (skillId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/skillsControl', version: 'v1', data: { op: 'ai-skill-reset', skillId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? A4 — the workspace autonomy level (optimistic flip + persist).
      saveAutonomy: (autonomyLevel) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        setSnap((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === room ? { ...w, autonomyLevel } : w)) }));
        observeSync(syncRequest({ name: 'workspaces/saveAutonomy', version: 'v1', data: { autonomyLevel, clientRequestId: nextReqId() }, receiver: room }));
      },
      //? Q4 + K4 + P2 — the workspace-wide AI-behaviour settings (optimistic flip + persist).
      saveAiInstruction: (aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl) => {
        const room = snap.activeWorkspaceId;
        if (!room) return;
        setSnap((s) => ({ ...s, workspaces: s.workspaces.map((w) => (w.id === room ? { ...w, aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl } : w)) }));
        observeSync(syncRequest({ name: 'workspaces/saveAiInstruction', version: 'v1', data: { aiInstruction, outputLanguage, geminiModel, geminiTemperature, geminiBaseUrl, clientRequestId: nextReqId() }, receiver: room }));
      },
      //? P1 — set which provider runs a feature ('default' clears the override).
      aiOverrides: snap.aiOverrides,
      customTasks: snap.customTasks,
      //? Preload gap-fix (X3) — the caller's own PATs for the settings API-tokens panel (metadata only).
      pats: snap.pats,
      saveAiProvider: (feature, providerId, model) => {
        const room = snap.activeWorkspaceId;
        //? P4-2 — `model` only travels when given; the server treats an absent key as "connection's model".
        if (room) observeSync(syncRequest({ name: 'workspaces/saveAiProvider', version: 'v1', data: { feature, providerId, ...(model === undefined ? {} : { model }), clientRequestId: nextReqId() }, receiver: room }));
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
        const res = await apiRequest({ name: 'workspaces/openPreview', version: 'v1', data: { workspaceId: room, ticketKey, clientRequestId: nextReqId() } });
        if (res.status !== 'success') return { ok: false, error: res.errorCode };
        return res.result;
      },
      closePreview: (ticketKey) => { const room = snap.activeWorkspaceId; if (room) void apiRequest({ name: 'workspaces/closePreview', version: 'v1', data: { workspaceId: room, ticketKey, clientRequestId: nextReqId() } }); },
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
      budgets: snap.budgets,
      capacity: snap.capacity,
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
      makeTicketFromFinding: (id) => { const room = snap.activeWorkspaceId; const projectId = snap.activeProjectId; if (room && projectId) void syncRequest({ name: 'workspaces/findingAction', version: 'v1', data: { op: 'finding-to-ticket', findingId: id, projectId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      dismissFinding: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/findingAction', version: 'v1', data: { op: 'finding-dismiss', findingId: id, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      linkArtifact: (ticketKey, artifactId, artifactKind, label) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/ticketArtifact', version: 'v1', data: { op: 'ticket-link-artifact', ticketId: ticketKey, artifactId, artifactKind, ...(label ? { label } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      unlinkArtifact: (linkId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/ticketArtifact', version: 'v1', data: { op: 'ticket-unlink-artifact', linkId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      saveBrand: async (b) => { const ws = snap.activeWorkspaceId; if (!ws) return; await apiRequest({ name: 'workspaces/studioBrand', version: 'v1', data: { workspaceId: ws, op: 'save', ...b } }); refetch(); },
      promoteBrand: async (artifactId) => { const ws = snap.activeWorkspaceId; if (!ws) return; await apiRequest({ name: 'workspaces/studioBrand', version: 'v1', data: { workspaceId: ws, op: 'promote', artifactId } }); refetch(); },
      saveBrief: async (b) => {
        const ws = snap.activeWorkspaceId; if (!ws) return;
        await apiRequest({ name: 'workspaces/studioSaveBrief', version: 'v1', data: { workspaceId: ws, ...b, clientRequestId: nextReqId() } });
        refetch();
      },
      generateArtifact: async (briefId, kind, tweak) => {
        const ws = snap.activeWorkspaceId; if (!ws) return { ok: false };
        const res = await apiRequest({ name: 'workspaces/studioGenerate', version: 'v1', data: { workspaceId: ws, briefId, kind, ...(tweak ? { tweak } : {}), clientRequestId: nextReqId() } });
        refetch();
        return { ok: res.status === 'success', ...(res.status === 'success' ? { artifactId: res.result.artifactId } : { error: res.errorCode }) };
      },
      deleteBrief: (briefId) => { const ws = snap.activeWorkspaceId; if (ws) void apiRequest({ name: 'workspaces/studioDelete', version: 'v1', data: { workspaceId: ws, briefId, clientRequestId: nextReqId() } }).then(() => { refetch(); }); },
      deleteArtifact: (artifactId) => { const ws = snap.activeWorkspaceId; if (ws) void apiRequest({ name: 'workspaces/studioDelete', version: 'v1', data: { workspaceId: ws, artifactId, clientRequestId: nextReqId() } }).then(() => { refetch(); }); },
      saveTrigger: (t) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-save', clientRequestId: nextReqId(), ...t }, receiver: room }).then(() => { refetch(); }); },
      toggleTrigger: (id, enabled) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-toggle', triggerId: id, enabled, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteTrigger: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-delete', triggerId: id, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      runTrigger: (id) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-run', triggerId: id, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Fire a content-generation control-op (U2) — Conductor executes (B-23); the snapshot refetch brings the new asset/state back.
      runContentOp: (op, contentProjectId, payload) => {
        const room = snap.activeWorkspaceId;
        if (room) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op, contentProjectId, ...payload, clientRequestId: nextReqId() }, receiver: room }).then((response) => { if (!reportRequestFailure(response)) refetch(); }, () => { notify.error({ key: 'workspaces.syncFailed' }); });
      },
      //? #125 — create a content piece from a brief (mirrors the chat-proposal create-content path).
      createContentPiece: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-from-brief', title: input.title, brief: input.brief, format: input.format ?? 'faceless', clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Media €-budget settings (U3) — cap/alert/enabled via edit-media-budget (B-23).
      editMediaBudget: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'edit-media-budget', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      aiConnections: snap.aiConnections,
      aiProviderCatalog: snap.aiProviderCatalog,
      aiFeatureDefaults: snap.aiFeatureDefaults,
      //? ADR 0007 — the three connection verbs. Each resolves with the Conductor's own result so the
      //? caller can report what actually happened: a test's pass/fail, and which features a removal
      //? moved. The key travels IN only; nothing key-shaped comes back.
      aiConnectionAction: async (input) => {
        const room = snap.activeWorkspaceId;
        if (!room) return { ok: false };
        const [error, res] = await tryCatch(() => syncRequest({ name: 'workspaces/aiConnection', version: 'v1', data: { ...input, clientRequestId: nextReqId() }, receiver: room }));
        refetch();
        if (error || res?.status !== 'success') return { ok: false, ...(res?.status === 'error' ? { error: res.errorCode } : {}) };
        return { ok: true, result: res.result };
      },
      //? Save an ENCRYPTED media provider API key / per-feature override (U3) via save-media-provider (B-23).
      saveMediaProvider: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'save-media-provider', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? GAP_SCAN G7 — start/update a prompt A/B experiment, or stop measuring one.
      savePromptExperiment: (input) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'prompt-experiment-save', ...input, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      stopPromptExperiment: (experimentId) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'prompt-experiment-stop', experimentId, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? A7 — store this workspace's platform APP credentials (write-only; server-encrypted) via B-23.
      savePlatformCredentials: (platform, clientId, clientSecret) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'save-platform-credentials', platform, clientId, clientSecret, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Edit a channel's brand voice (U4) → updates the channel + re-indexes brand-RAG (B-23).
      editChannelBrand: (channelId, brandVoice) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'content-edit-brand', channelId, brandVoice, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      saveProductContext: (productContext) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'content-edit-product', productContext, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      //? Gap-fix — persist the uploaded brand logo the render watermark overlays.
      saveBrandLogo: (brandLogoUrl) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'content-edit-product', brandLogoUrl, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      saveStyle: (feature, key, label, systemPrompt, preview) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'save-style', feature, key, label, systemPrompt, ...(preview ? { previewAssetUrl: preview.previewAssetUrl, previewKind: preview.previewKind } : {}), clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      deleteStyle: (feature, key) => { const room = snap.activeWorkspaceId; if (room) void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'delete-style', feature, key, clientRequestId: nextReqId() }, receiver: room }).then(() => { refetch(); }); },
      docs: snap.docs,
      skills: snap.skills,
      invites: snap.invites,
      activityEvents: snap.events,
      ticketNotes: snap.notes,
    };
  }, [view, location.pathname, navStack, recent, openTabs, isMobile, theme, setTheme, offline, queuedWrites, retryQueuedWrites, parkWrite, activeSuggestions, navigate, currentUser, sshKeys, sshUserId, addSshKey, removeSshKey, aiOpen, chat, interviewerChat, sendChat, acceptChatProposal, acceptChatPlan, rejectChatProposal, snap, wantWorkspaceId, currentProjectScope, afterWrite, quickAddApi, sprintCreateApi, editSprintApi, createProjectApi, createFromTemplateApi, applyDesignTokensApi, createServiceApi, deleteServiceApi, provisionServiceStackApi, teardownServiceStackApi, dbConnectApi, dbMigrateCreateApi, dbMigrateApplyApi, dbIntrospectApi, connectForgeApi, disconnectForgeApi, deployEnvApi, teardownEnvApi, rollbackEnvApi, promoteEnvApi, exportBuildApi, scanIndexApi, ragIndex, mrActionApi, mrByBranch, presence, viewCounts, agentTerm, copilotPrefill, trail, setTicketPresence, claimTicketApi, membersById, stageOverrides, loading, refetch, signOut, pendingAnswers]);

  return <WorkspacesContextProvider value={ctx}>{children}</WorkspacesContextProvider>;
}
