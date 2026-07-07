//? Workspaces — app-level context. Holds the SPA state the prototype kept in
//? App.jsx (current view, open ticket tabs, AI suggestions) and the navigation
//? helpers, so any screen/card deep in the tree can drive the shell without
//? prop-drilling. State lives in `page.tsx`; this just types + exposes it.

/* eslint-disable react-refresh/only-export-components -- context module: the Provider is co-exported with the useWorkspaces hook + isTicketView guard by design (dev-only fast-refresh rule) */
import { createContext, use } from 'react';

import type {
  ActivityEvent, AiSuggestion, ChatMessage, ChatProposal, EnvVar, GitConfig, InfoDoc, IntegrationTool, InviteEntry,
  Member, MrActionFields, MrActionKind, MrActionResult, MrView, MyInvite, NotificationItem, PermRole, PipelineStage,
  PipelineStageCfg, RagIndexStatus, RepoInfo, SkillEntry, Sprint,
  SshKeyEntry, Ticket, TicketNote, TicketPriority, Workspace, WorkspaceBudget, WorkspaceUsage, WorkspaceInsights, WorkspaceAnalytics, WorkspaceTrigger,
  StudioBrief, StudioArtifact, StudioArtifactKind, StudioBrandLibrary, AiRun, DesignArtifact, InterviewFinding, TicketArtifactLink,
  ProjectSummary, ServiceSummary, EnvironmentSummary, BuildArtifactSummary, AnswerQueueItem, ContentSnapshot,
} from '../_data/types';

export type WsView =
  | 'board' | 'backlog' | 'terminals' | 'activity' | 'sources'
  | 'pipeline' | 'usage' | 'studio' | 'designer' | 'interviewer' | 'marketing' | 'scheduled'
  | 'ai' | 'settings' | 'workspace'
  | (string & {}); // ticket views use the DEV-#### id

export interface WorkspacesCtx {
  view: WsView;
  //? Chrome navigation (nav rail, tab bar, switcher) — does NOT push the back
  //? stack. Use `pushTo`/`openTicket` for reference navigations (clicking a
  //? ticket/link from page content) so only those land in the back history.
  navigate: (view: WsView) => void;
  pushTo: (view: WsView) => void;
  goBack: () => void;
  canGoBack: boolean;
  backLabel: string | null;  // label of the view goBack would return to
  openTabs: string[];        // open ticket ids
  openTicket: (id: string) => void;
  closeTab: (id: string) => void;
  recent: string[];          // recently opened ticket ids (search palette history)
  isMobile: boolean;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  suggestions: AiSuggestion[];
  dismissSuggestion: (id: string) => void;
  acceptSuggestion: (id: string) => void;
  //? Current user's notifications (newest first), from the live snapshot.
  notifications: NotificationItem[];
  unreadNotifications: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  currentUser: Member;   // the account you're using the app as
  //? SSH keys live on the account (Account settings) and are what unlock + drive
  //? the terminals. The active SSH identity = the most recent key's mapped user
  //? (123 → test, 456 → mathijs). No app-level login gate.
  sshKeys: SshKeyEntry[];
  sshUserId: string | null;
  addSshKey: (key: SshKeyEntry) => void;
  removeSshKey: (id: string) => void;
  //? Workspace-AI panel — available on every screen; the nav/bottom-bar entry
  //? toggles it rather than routing.
  aiOpen: boolean;
  toggleAi: () => void;
  chat: ChatMessage[];
  sendChat: (text: string) => void;
  acceptChatProposal: (messageId: string, proposal: ChatProposal) => void;
  //? Workspaces: switch the active one or create a new workspace.
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string, enabledSections?: string[]) => void;
  //? Multi-project / multi-service (ADR 0035): a workspace holds N projects, each
  //? optionally N services. The board/pipeline/sources render the ACTIVE project.
  projects: ProjectSummary[];
  activeProject: ProjectSummary | null;
  activeProjectId: string | null;
  setActiveProject: (id: string) => void;
  services: ServiceSummary[];
  createProject: (input: { name: string; gitUrl?: string; gitlabPath?: string }) => void;
  //? Greenfield scaffolding (ADR 0046): the curated stack templates + create-from-template.
  templates: { key: string; label: string; description: string }[];
  createFromTemplate: (input: { name: string; template: string }) => void;
  createService: (input: { projectId: string; name: string; path?: string; buildCmd?: string; deployUnit?: string }) => void;
  deleteService: (serviceId: string) => void;
  //? Per-project forge connection (ADR 0036): GitLab OR GitHub for a specific project.
  connectForge: (input: { projectId: string; mode: 'gitlab' | 'github'; baseUrl?: string; token?: string; repoPath?: string }) => void;
  //? Environments (ADR 0037): the active project's dev/staging/prod deployments + deploy/teardown.
  environments: EnvironmentSummary[];
  deployEnv: (input: { kind: string; serviceId?: string }) => void;
  teardownEnv: (envId: string) => void;
  //? Deploy/CD (ADR 0038): promote up the ladder + export a downloadable build.
  promoteEnv: (input: { fromKind: string; approved?: boolean }) => void;
  buildArtifacts: BuildArtifactSummary[];
  exportBuild: (kind: string) => void;
  sprintCreate: (name: string) => void;
  //? Onboarding (zero-workspace): the invitations addressed to this user + accept.
  myInvites: MyInvite[];
  acceptInvite: (token: string) => void;
  renameWorkspace: (name: string) => void;
  deleteWorkspace: () => void;
  saveGitlab: (baseUrl: string, token: string, forgeType?: string) => void;
  repo: RepoInfo;
  linkRepo: (gitUrl: string, token?: string) => void;
  scanDocs: () => void;
  //? K2 — register an uploaded doc (md/txt) as a context-doc InfoSource.
  addInfoDoc: (name: string, content: string) => void;
  //? RAG code index (07 §D) — trigger a reindex + the latest index status (null until scanned).
  scanIndex: () => void;
  ragIndex: RagIndexStatus | null;
  //? Built-in MR review (BUILTIN_MR_REVIEW) — fire an MR action (open/refresh, comment, approve,
  //? merge, resolve) and read the latest MR view keyed by source branch. `mrAction` resolves with
  //? whether the sync succeeded so the panel can drive its loading/error state; the fresh MR view
  //? arrives via the realtime delta and lands in `mrByBranch`.
  mrAction: (action: MrActionKind, fields: MrActionFields) => Promise<MrActionResult>;
  mrByBranch: Record<string, MrView>;
  //? Editable per-workspace RBAC + each member's assigned role. Held here so the
  //? edits persist across tab/route changes (would persist server-side for real).
  permRoles: PermRole[];
  togglePerm: (roleIndex: number, capIndex: number) => void;
  addRole: (name: string) => void;
  memberRoles: Record<string, string>;
  setMemberRole: (memberId: string, role: string) => void;
  //? Members / invites lifecycle (16 members & RBAC).
  inviteMember: (email: string, roleKey: string) => void;
  revokeInvite: (inviteId: string) => void;
  removeMember: (memberId: string) => void;
  transferOwnership: (memberId: string) => void;
  //? Workspace env vars + configured integration tools (the Pipeline selects from these).
  envVars: EnvVar[];
  saveEnvVar: (v: EnvVar) => void;
  removeEnvVar: (id: string) => void;
  integrationTools: IntegrationTool[];
  saveIntegrationTool: (t: IntegrationTool) => void;
  removeIntegrationTool: (id: string) => void;
  //? AI-driven board moves: stage overrides on top of the live data, so the
  //? Workspace-AI chat can move a ticket and the board animates it.
  stageOverrides: Record<string, string>;        // ticketId → stage id (free string, 04b §12)
  moveTicket: (id: string, stage: string) => void;
  //? Ticket/board writes (12/13) — the [control-API] `quick-add`/`archive`/`bulk-*` ops.
  //? New tickets always enter at `unrefined` (Conductor-enforced), so creation takes
  //? only a title — no stage/sprint choice at creation time.
  quickAdd: (input: { title: string; sprintId?: string; description?: string; labels?: string[]; assigneeId?: string; priority?: TicketPriority }) => void;
  //? Edit a ticket's title / description / labels / priority (stage + assignee changes
  //? reuse bulkMove / bulkAssign on a single ticket). Only the given fields are written.
  editTicket: (id: string, patch: { title?: string; description?: string; labels?: string[]; priority?: TicketPriority }) => void;
  //? Add a user comment (WorkspaceNote) to a ticket. Read them back via `ticketNotes`.
  addComment: (ticketId: string, body: string) => void;
  //? Answer the AI's open question on a ticket (#17): records the answer + re-fires the parked
  //? turn with it. Clears the needs-input banner. `ticketId` is the DEV-#### key.
  answerInput: (ticketId: string, answer: string) => void;
  //? Realtime presence (#17): announce/retract that this user is viewing a ticket (open + heartbeat
  //? + close), and read the OTHER users currently viewing a ticket (self excluded).
  setTicketPresence: (ticketKey: string, viewing: boolean) => void;
  viewersOf: (ticketKey: string) => string[];
  //? Review ergonomics (ADR 0048): the cross-ticket answer-queue + soft-claim (who's answering).
  answerQueue: AnswerQueueItem[];
  claimTicket: (ticketKey: string, claiming: boolean) => void;
  claimedBy: (ticketKey: string) => string | null;
  archiveTicket: (id: string) => void;
  bulkMove: (ids: string[], stageId: string) => void;
  bulkStatus: (ids: string[], status: string) => void;
  bulkAssign: (ids: string[], assigneeId: string) => void;
  bulkSprint: (ids: string[], sprintId: string) => void;
  bulkArchive: (ids: string[]) => void;
  //? Sources — enable/disable a skill (Fase 2 covers reindex/add/remove).
  toggleSkill: (id: string, on: boolean) => void;
  //? Pipeline (7a.2) — full per-stage config from the DB composites.
  stageConfigs: PipelineStageCfg[];
  saveStageConfig: (cfg: PipelineStageCfg) => void;
  //? Workflow (hosting-proxy plan) — per-workspace git strategy + push policy.
  gitConfig: GitConfig;
  saveGitConfig: (cfg: GitConfig) => void;
  //? Module gating — persist the workspace's enabled nav-section set (modules.ts).
  saveSections: (enabledSections: string[]) => void;
  //? Q4 + K4 + P2 — the workspace AI-behaviour settings: instruction + output language + Gemini model/temperature.
  saveAiInstruction: (aiInstruction: string, outputLanguage: string, geminiModel: string, geminiTemperature: string) => void;
  //? P1 — per-feature AI provider overrides + a setter ('default' clears).
  aiOverrides: { feature: string; providerId: string }[];
  saveAiProvider: (feature: string, providerId: string) => void;
  //? Agent controls (C2) — pause/resume/kill a ticket's autonomous turn; pause/resume all.
  pauseTicket: (ticketKey: string) => void;
  resumeTicket: (ticketKey: string) => void;
  killTicket: (ticketKey: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  //? Whether the workspace is pause-all'd (C2) — the engine provisions no new turns.
  workspacePaused: boolean;
  //? Preview flow (P4) — start the ticket's app dev-server + expose it (returns the URL); stop it.
  openPreview: (ticketKey: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  closePreview: (ticketKey: string) => void;
  //? Sign out of the framework session (not a [control-API] op).
  signOut: () => void;

  //? ----- live tenant data (from the `workspaces/snapshot` read; MIGRATION §4) -----
  //? These replace the screens' old direct `_data/seed` DATA imports. Static
  //? CATALOGS (HOOK_CATALOG, COMMAND_CATALOG, INTEGRATION_TYPES, NETWORK_CATEGORIES,
  //? CARRY_VARS, RBAC_CAPABILITIES, ROLE_DISPLAY, …) stay as `_data/seed` imports.
  loading: boolean;                    // snapshot still loading
  refetch: () => void;                 // re-pull the snapshot (after a control-API write)
  tickets: Ticket[];                   // was TICKETS
  members: Member[];                   // was Object.values(MEMBERS)
  membersById: Record<string, Member>; // was MEMBERS (keyed by user id)
  //? Resolve a ticket's people (creator + assignee + viewers) to Member objects via
  //? the live members — replaces the seed `ticketLinkedMembers(t)` helper (which keyed
  //? on the dummy MEMBERS map; real tickets carry real user ids).
  ticketMembers: (ticket: Ticket) => Member[];
  stages: PipelineStage[];             // was STAGES (board meta; full editor config still on seed)
  sprints: Sprint[];                   // was SPRINTS
  budget: WorkspaceBudget | null;      // was BUDGET
  usage: WorkspaceUsage;               // #16: real token usage (per-ticket + 7-day activity)
  insights: WorkspaceInsights;         // #5: cycle time / throughput / cost-per-ticket
  analytics: WorkspaceAnalytics;       // ADR 0047: the fuller delivery-analytics fold
  content: ContentSnapshot;            // ADR 0069: the content-lane pieces + media €-budget status
  triggers: WorkspaceTrigger[];        // #2: automation triggers
  agentRoles: { key: string; label: string; description: string; mutates: boolean }[]; // schedulable roles
  aiRuns: AiRun[];                     // central AI-activity feed (Workspace-AI panel "Activity" tab)
  //? Studio module — design + marketing tool.
  studioBriefs: StudioBrief[];
  studioArtifacts: StudioArtifact[];
  studioBrand: StudioBrandLibrary | null;    // central brand library (ADR 0013 G-MKT-2)
  designArtifacts: DesignArtifact[];         // persisted design library + active flag (ADR 0034)
  interviewFindings: InterviewFinding[];     // categorised interviewer findings (ADR 0034)
  makeTicketFromFinding: (id: string) => void;
  dismissFinding: (id: string) => void;
  ticketArtifactLinks: TicketArtifactLink[]; // design/Studio artifacts linked to a ticket (ADR 0034)
  linkArtifact: (ticketKey: string, artifactId: string, artifactKind: string, label?: string) => void;
  unlinkArtifact: (linkId: string) => void;
  saveBrief: (b: { id?: string; name: string; productName: string; audience: string; tone: string; goals: string; notes?: string }) => Promise<void>;
  generateArtifact: (briefId: string, kind: StudioArtifactKind) => Promise<{ ok: boolean; artifactId?: string; error?: string }>;
  deleteBrief: (briefId: string) => void;
  deleteArtifact: (artifactId: string) => void;
  saveBrand: (b: Partial<Omit<StudioBrandLibrary, 'workspaceId'>>) => Promise<void>;
  promoteBrand: (artifactId: string) => Promise<void>;
  //? #2 automation writes — create/update, enable/disable, delete a trigger (control-ops).
  saveTrigger: (t: { id?: string; name: string; on: string; action: string; params?: unknown; match?: unknown; requiresApproval?: boolean; cron?: string }) => void;
  toggleTrigger: (id: string, enabled: boolean) => void;
  deleteTrigger: (id: string) => void;
  runTrigger: (id: string) => void;   // run a trigger's action now (on-demand)
  //? Fire a content-generation control-op (U2) — the Conductor executes it (B-23).
  runContentOp: (op: string, contentProjectId: string, payload?: Record<string, string>) => void;
  //? Media settings (U3) — €-budget + encrypted provider key/override (B-23).
  editMediaBudget: (input: { capCents?: number; alertPct?: number; enabled: boolean }) => void;
  saveMediaProvider: (input: { providerId?: string; apiKey?: string; feature?: string; model?: string }) => void;
  editChannelBrand: (channelId: string, brandVoice: string) => void;
  //? Q2 — the per-workspace product/brand context folded into every creative generation.
  saveProductContext: (productContext: string) => void;
  //? Q3 — create/update + delete a per-workspace named style preset.
  saveStyle: (feature: string, key: string, label: string, systemPrompt: string) => void;
  deleteStyle: (feature: string, key: string) => void;
  docs: InfoDoc[];                     // was DOCS (InfoSource mode='context-doc')
  skills: SkillEntry[];                // was SKILLS (InfoSource mode='skill')
  invites: InviteEntry[];              // was INVITES
  activityEvents: ActivityEvent[];     // was EVENTS
  ticketNotes: TicketNote[];           // user comments on tickets (WorkspaceNote projection)
}

export const isTicketView = (v: string): boolean => v.startsWith('DEV-');

const WorkspacesContext = createContext<WorkspacesCtx | null>(null);

//? Raw context provider. The self-contained stateful provider component lives in
//? `WorkspacesProvider.tsx` (it owns the dummy-data state + router-based nav and
//? feeds this). Screens consume via `useWorkspaces()`.
export const WorkspacesContextProvider = WorkspacesContext.Provider;

export function useWorkspaces(): WorkspacesCtx {
  const ctx = use(WorkspacesContext);
  if (!ctx) throw new Error('useWorkspaces must be used within <WorkspacesProvider>');
  return ctx;
}
