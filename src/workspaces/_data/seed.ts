//? Workspaces — dummy seed data for the UI prototype.
//?
//? Mirrors the prototype's `data.js` and stays consistent across screens
//? (workspace YouComm Core, project youcomm-app, 7-stage pipeline, 12 tickets
//? DEV-1240…DEV-1251, 5 members). Typed against `_data/types.ts` so it lines up
//? with the real Prisma model. No server, no fetching — imported directly.

import { HOOK_KEYS } from './catalogs';
import type {
  ActivityEvent,
  AiSuggestion,
  InfoDoc,
  InviteEntry,
  EnvVar,
  IntegrationTool,
  Member,
  NotificationItem,
  PermRole,
  PipelineStage,
  PipelineStageCfg,
  Project,
  Role,
  SessionEntry,
  SkillEntry,
  Sprint,
  SshKeyEntry,
  StageKind,
  StageModelCfg,
  StageModelChoice,
  StageNetworkCfg,
  StageStatusCfg,
  Terminal,
  Ticket,
  UsageRow,
  Workspace,
  WorkspaceBudget,
} from './types';

export const MEMBERS: Record<string, Member> = {
  test: { id: 'test', name: 'Test', email: 'test@youcomm.nl', avatarFallback: '#8B5CF6', role: 'member' },
  mathijs: { id: 'mathijs', name: 'Mathijs', email: 'mathijs@youcomm.nl', avatarFallback: '#6366F1', role: 'owner' },
  sanne: { id: 'sanne', name: 'Sanne', email: 'sanne@youcomm.nl', avatarFallback: '#0EA5A4', role: 'admin' },
  tom: { id: 'tom', name: 'Tom', email: 'tom@youcomm.nl', avatarFallback: '#E0920A', role: 'member' },
  lina: { id: 'lina', name: 'Lina', email: 'lina@youcomm.nl', avatarFallback: '#E5484D', role: 'member' },
  daan: { id: 'daan', name: 'Daan', email: 'daan@youcomm.nl', avatarFallback: '#16A34A', role: 'member' },
};

const meMember = MEMBERS.mathijs;
if (!meMember) throw new Error('MEMBERS.mathijs missing');
export const ME: Member = meMember;

export const WORKSPACES: Workspace[] = [
  { id: 'ws-youcomm', name: 'YouComm Core', slug: 'youcomm-core', ownerId: 'mathijs', role: 'owner' },
  { id: 'ws-luckystack', name: 'LuckyStack OSS', slug: 'luckystack-oss', ownerId: 'sanne', role: 'member' },
];
export const ACTIVE_WORKSPACE = WORKSPACES[0];

export const PROJECTS: Project[] = [
  { id: 'prj-app', workspaceId: 'ws-youcomm', name: 'youcomm-app', gitlabPath: 'youcomm/app' },
  { id: 'prj-api', workspaceId: 'ws-youcomm', name: 'youcomm-api', gitlabPath: 'youcomm/api' },
];
export const ACTIVE_PROJECT = PROJECTS[0];

export const STAGES: PipelineStage[] = [
  { id: 'unrefined', kind: 'refine', name: 'Unrefined', order: 0, aiEnabled: false },
  { id: 'refined', kind: 'refine', name: 'Refined', order: 1, aiEnabled: true },
  { id: 'plan', kind: 'plan', name: 'Plan', order: 2, aiEnabled: true, wipLimit: 2 },
  { id: 'impl', kind: 'code', name: 'Implementatie', order: 3, aiEnabled: true },
  { id: 'test', kind: 'test', name: 'Test', order: 4, aiEnabled: true },
  { id: 'review', kind: 'review', name: 'Review', order: 5, aiEnabled: true },
  { id: 'final', kind: 'final', name: 'Final', order: 6, aiEnabled: true },
];

const WS = 'ws-youcomm';
const PRJ = 'prj-app';

export const TICKETS: Ticket[] = [
  {
    id: 'DEV-1240', workspaceId: WS, projectId: PRJ, stageId: 'impl', status: 'busy', hasTerminal: true,
    title: 'Fix avatar fallback flicker on slow networks',
    labels: ['bug', 'frontend'], viewers: ['sanne', 'tom'], costLabel: '€1.18 · 12m',
    branch: 'DEV-1240', mr: '!91 · draft', issue: '#1240', sprintId: 's24',
    description:
      'On slow (3G) connections the Avatar component briefly renders the colour-initials fallback before the image loads, then swaps to the image — a visible flicker. Cache the load/fail state per avatar identity so the first resolution fans out to every instance, and hold the previous frame during refetch.',
    carryOver: 'From Plan: keep the fallback identity key stable across `?v=` cache-busts; do not change the public Avatar API.',
  },
  {
    id: 'DEV-1245', workspaceId: WS, projectId: PRJ, stageId: 'impl', status: 'busy', hasTerminal: true,
    title: 'Board drag-and-drop with dnd-kit',
    labels: ['feature', 'frontend'], viewers: ['mathijs'], costLabel: '€4.10 · 38m', sprintId: 's24',
    branch: 'DEV-1245', mr: '—', issue: '#1245',
  },
  {
    id: 'DEV-1242', workspaceId: WS, projectId: PRJ, stageId: 'review', status: 'stuck', hasTerminal: true,
    title: 'Refactor rate limiter to token bucket',
    labels: ['backend', 'perf'], viewers: ['daan'], costLabel: '€2.74 · 26m', sprintId: 's24',
    branch: 'DEV-1242', mr: '!89', issue: '#1242',
  },
  {
    id: 'DEV-1241', workspaceId: WS, projectId: PRJ, stageId: 'plan', status: 'needs-input', hasTerminal: false,
    title: 'Add SSO via Microsoft',
    labels: ['feature', 'auth'], viewers: ['sanne'], sprintId: 's24',
    branch: 'DEV-1241', mr: '—', issue: '#1241',
    description: 'Add Microsoft (Entra ID) as an OAuth provider alongside GitLab/GitHub. Needs a decision on where the client secret lives per-workspace.',
    carryOver: 'From Refined: SSO must reuse the existing provider-button flow in LoginForm; no new auth surface.',
    needsInput: 'Where should the Microsoft client secret live — the per-workspace token vault from DEV-1249, or env for now?',
  },
  {
    id: 'DEV-1247', workspaceId: WS, projectId: PRJ, stageId: 'plan', status: 'busy', hasTerminal: false,
    title: 'graphify MCP: impact_of endpoint',
    labels: ['mcp', 'backend'], viewers: [], sprintId: 's24',
  },
  {
    id: 'DEV-1249', workspaceId: WS, projectId: PRJ, stageId: 'plan', status: 'busy', hasTerminal: false,
    title: 'Per-workspace GitLab token vault',
    labels: ['security', 'backend'], viewers: ['tom'], sprintId: 's24',
  },
  {
    id: 'DEV-1244', workspaceId: WS, projectId: PRJ, stageId: 'test', status: 'busy', hasTerminal: false,
    title: 'Dark mode FOUC on unauth reload',
    labels: ['bug', 'frontend'], viewers: [], sprintId: 's24',
  },
  {
    id: 'DEV-1243', workspaceId: WS, projectId: PRJ, stageId: 'refined', status: 'done', hasTerminal: false,
    title: 'Voice note → ticket pipeline',
    labels: ['feature', 'mobile'], viewers: ['lina'], sprintId: 's24',
  },
  {
    id: 'DEV-1250', workspaceId: WS, projectId: PRJ, stageId: 'refined', status: 'busy', hasTerminal: false,
    title: 'Mobile bottom-sheet for quick actions',
    labels: ['feature', 'mobile'], viewers: ['lina'], sprintId: 's24',
  },
  {
    id: 'DEV-1246', workspaceId: WS, projectId: PRJ, stageId: 'final', status: 'done', hasTerminal: false,
    title: 'Email-change confirmation flow copy',
    labels: ['copy'], viewers: ['sanne'], sprintId: 's24',
  },
  {
    id: 'DEV-1248', workspaceId: WS, projectId: PRJ, stageId: 'unrefined', status: 'idle', hasTerminal: false,
    title: 'Investigate flaky sync test',
    labels: ['test', 'flaky'], viewers: [],
  },
  {
    id: 'DEV-1251', workspaceId: WS, projectId: PRJ, stageId: 'unrefined', status: 'idle', hasTerminal: false,
    title: 'Cleanup: remove SESSION_STATE.md from root',
    labels: ['chore'], viewers: [],
  },
];

//? Linked members: the FIRST is always the creator, the SECOND the assignee
//? (who picked it up). Falls back to `viewers` order when not set explicitly.
export function ticketCreator(t: Ticket): string {
  return t.creatorId ?? t.viewers[0] ?? 'mathijs';
}
export function ticketAssignee(t: Ticket): string | undefined {
  if (t.assigneeId) return t.assigneeId;
  const creator = ticketCreator(t);
  return t.viewers.find((v) => v !== creator);
}
export function ticketLinkedMembers(t: Ticket): Member[] {
  const ids = [ticketCreator(t), ticketAssignee(t)].filter((x): x is string => x !== undefined);
  return [...new Set(ids)].map((id) => MEMBERS[id]).filter((m): m is Member => m !== undefined);
}

export const AI_SUGGESTIONS: AiSuggestion[] = [
  {
    id: 'sug-1', type: 'create-epic', title: "Merge overlapping work into a 'secrets' epic",
    body: 'DEV-1241 (Microsoft SSO) and DEV-1249 (GitLab token vault) both touch credential storage. Group them under a shared epic?',
    ticketIds: ['DEV-1241', 'DEV-1249'],
  },
  {
    id: 'sug-2', type: 'link-tickets', title: 'Flaky test resembles a fixed issue',
    body: 'DEV-1248 looks like the sync flake resolved in !72 last month. Want me to link them and re-run with the old fix?',
    ticketIds: ['DEV-1248'],
  },
];

export const SPRINTS: Sprint[] = [
  { id: 's24', name: 'Sprint 24', start: 'May 27', end: 'Jun 9', active: true, ticketCount: 9, daysLeft: 5 },
  { id: 's23', name: 'Sprint 23', start: 'May 13', end: 'May 26', active: false, ticketCount: 11, daysLeft: 0 },
  { id: 'backlog', name: 'Backlog', start: null, end: null, active: false, ticketCount: 3, daysLeft: null },
];
export const ACTIVE_SPRINT = SPRINTS[0];

export const NOTIFICATIONS: NotificationItem[] = [
  { id: 'n1', type: 'needs-input', title: 'DEV-1241 needs your input', body: 'AI asks where the Microsoft client secret should live.', ticketId: 'DEV-1241', time: '2m', read: false },
  { id: 'n2', type: 'container-failure', title: 'Container failed to start', body: 'DEV-1244 — out of memory while installing deps.', ticketId: 'DEV-1244', time: '14m', read: false },
  { id: 'n3', type: 'ai-suggestion', title: 'New Workspace-AI suggestion', body: "Merge DEV-1241 & DEV-1249 into a 'secrets' epic.", ticketId: 'DEV-1249', time: '31m', read: false },
  { id: 'n4', type: 'merge', title: 'MR !88 merged', body: 'DEV-1246 merged into main (abc123).', ticketId: 'DEV-1246', time: '1h', read: true },
  { id: 'n5', type: 'ai-suggestion', title: 'Agent escalated to needs-input', body: 'DEV-1242 looked stuck (idle 8m) — paused for you.', ticketId: 'DEV-1242', time: '2h', read: true },
];

export const BUDGET: WorkspaceBudget = { spent: 168.4, cap: 200, alertPct: 80, currency: '€' };

export const EVENTS: ActivityEvent[] = [
  { at: '2026-05-04T12:32:00.000Z', actor: 'ai', ticketId: 'DEV-1240', type: 'command', text: '`npm test` → 2 failing' },
  { at: '2026-05-04T12:31:00.000Z', actor: 'ai', ticketId: 'DEV-1240', type: 'file-change', text: 'edited src/_components/Avatar.tsx (+12 −4)' },
  { at: '2026-05-04T12:30:00.000Z', actor: 'ai', ticketId: 'DEV-1245', type: 'ai-message', text: 'Wiring dnd-kit columns; need a Column type…' },
  { at: '2026-05-04T12:29:00.000Z', actor: 'sanne', ticketId: 'DEV-1241', type: 'status-change', text: '→ needs input' },
  { at: '2026-05-04T12:27:00.000Z', actor: 'ai', ticketId: 'DEV-1242', type: 'ai-message', text: 'Asked: configurable burst size per route?' },
  { at: '2026-05-04T12:24:00.000Z', actor: 'ai', ticketId: 'DEV-1245', type: 'command', text: '`npm run client` → vite ready :5173' },
  { at: '2026-05-04T12:21:00.000Z', actor: 'mathijs', ticketId: 'DEV-1240', type: 'status-change', text: '→ busy · started terminal' },
  { at: '2026-05-04T12:18:00.000Z', actor: 'mr', ticketId: 'DEV-1246', type: 'mr', text: 'merged !88 into main (abc123)' },
  { at: '2026-05-04T12:12:00.000Z', actor: 'ai', ticketId: 'DEV-1247', type: 'file-change', text: 'created src/mcp/graphify/impact_of.ts (+86)' },
  { at: '2026-05-04T12:05:00.000Z', actor: 'tom', ticketId: 'DEV-1249', type: 'comment', text: 'Left a note on the vault encryption scheme' },
];

export const TERMINALS: Terminal[] = [
  {
    ticketId: 'DEV-1240', stage: 'Implementatie',
    processes: [
      {
        name: 'claude', status: 'busy', cwd: '/app', exit: '—',
        lines: [
          { tone: 'green', prefix: 'claude>', text: ' editing src/_components/Avatar.tsx' },
          { tone: 'amber', prefix: '●', text: ' Running tests…' },
          { tone: 'red', text: '  2 failing  ·  Avatar.test.tsx' },
          { tone: 'text', prefix: '$', text: '', cursor: true },
        ],
      },
      {
        name: 'server', status: 'busy', cwd: '/app', exit: '—',
        lines: [
          { tone: 'muted', prefix: '$', text: ' npm run server' },
          { tone: 'green', text: '  ✓ Redis connected · Prisma ready' },
          { tone: 'blue', text: '  listening on :80' },
          { tone: 'text', prefix: '$', text: '', cursor: true },
        ],
      },
    ],
  },
  {
    ticketId: 'DEV-1245', stage: 'Implementatie',
    processes: [
      {
        name: 'server', status: 'busy', cwd: '/app', exit: '—',
        lines: [
          { tone: 'muted', prefix: '$', text: ' tsx server/server.ts' },
          { tone: 'green', text: '  ✓ boot ok · :80' },
          { tone: 'text', prefix: '$', text: '', cursor: true },
        ],
      },
      {
        name: 'client', status: 'busy', cwd: '/app', exit: '—',
        lines: [
          { tone: 'blue', prefix: '▲ vite', text: ' ready on :5173 · HMR connected' },
          { tone: 'muted', text: '  hmr update /src/workspaces/_screens/Board.tsx' },
          { tone: 'text', prefix: '$', text: '', cursor: true },
        ],
      },
      {
        name: 'claude', status: 'busy', cwd: '/app', exit: '—',
        lines: [
          { tone: 'green', prefix: 'claude>', text: ' wiring dnd-kit columns…' },
          { tone: 'muted', text: '  added Column type, sortable context' },
          { tone: 'text', prefix: '$', text: '', cursor: true },
        ],
      },
    ],
  },
  {
    ticketId: 'DEV-1242', stage: 'Review',
    processes: [
      {
        name: 'claude', status: 'stuck', cwd: '/app', exit: '—',
        lines: [
          { tone: 'green', prefix: 'claude>', text: ' reviewing token-bucket limiter' },
          { tone: 'amber', prefix: '?', text: ' Should burst size be configurable per route?', wait: true },
          { tone: 'text', prefix: '$', text: '', cursor: true },
        ],
      },
    ],
  },
];

export const DOCS: InfoDoc[] = [
  {
    id: 'summary', name: 'project-summary', source: 'generated', updated: '2h ago', note: 'frozen @ abc123', aiEditable: true,
    summary: 'High-level orientation: what the project is, its architecture (web-app + orchestrator), and the house conventions. Always loaded first.',
    pendingBranches: ['DEV-1245', 'DEV-1249'], usedByStages: ['Refined', 'Plan', 'Implementatie'],
    content: '# Project summary\n\nLuckyStack is a socket-first fullstack framework (React 19 + raw Node + Socket.io). Workspaces orchestrates AI-driven development: tickets flow through a configurable pipeline, each running in its own container with a live terminal.\n\n## Architecture\n- web-app (this UI) — board, terminals, sources, presence\n- orchestrator — containers, worktrees, ~20 Claude-CLI processes, RAG indexer\n\n## Conventions\nSee `conventions` doc. DB schema in `db-schema`.',
  },
  {
    id: 'conventions', name: 'conventions', source: 'git', updated: '1d ago', note: 'frozen @ abc123', aiEditable: false,
    summary: 'Coding house-style: token-only colors, mandatory i18n, custom tryCatch, surgical changes. The rules the agent must follow when writing code.',
    usedByStages: ['Implementatie', 'Test', 'Review'],
    content: '# Conventions\n\n- Tailwind colors come ONLY from the theme tokens.\n- i18n via useTranslator for user-facing text.\n- Custom tryCatch everywhere — never raw try/catch.\n- Surgical changes; every changed line traces to the request.',
  },
  {
    id: 'glossary', name: 'glossary', source: 'git', updated: '3d ago', note: 'frozen @ abc123', aiEditable: false,
    summary: 'Domain terms: stage vs status, worktree, RAG snapshot, commit-hash freezing. Disambiguates the project vocabulary.',
    usedByStages: ['Refined', 'Review'],
    content: '# Glossary\n\n- **Stage** — a pipeline step (board column).\n- **Status** — ticket state within a stage (pill).\n- **Worktree** — per-ticket git checkout on a DEV-#### branch.\n- **RAG snapshot** — embeddings frozen on a commit hash.',
  },
  {
    id: 'dbschema', name: 'db-schema', source: 'generated', updated: '2h ago', note: 'frozen @ abc123', aiEditable: true,
    summary: 'Generated Prisma model excerpt (Ticket, TicketEvent, …). Lets the agent reason about the data shape without reading the whole schema.',
    pendingBranches: ['DEV-1249'], usedByStages: ['Plan', 'Implementatie'],
    content: '# DB schema (excerpt)\n\nmodel Ticket {\n  id String @id\n  stageId String\n  statusKey String\n  branch String?\n  commitHash String?\n}\n\nmodel TicketEvent { id; ticketId; seq Int; type; payload Json }',
  },
  {
    id: 'authspec', name: 'Auth redesign.md', source: 'uploaded', updated: '5d ago', note: 'spec', aiEditable: false,
    summary: 'Auth contract: LuckyStack session = login; workspace RBAC plus exact container labels authorize terminal access. SSH keys are not a terminal gate.',
    usedByStages: ['Plan'],
    content: '# Auth redesign\n\nOAuth = primary login/identity. A linked SSH public key is required to open terminals (capability-gate on the /pty namespace). Private key stays client-side; server verifies against the public half.',
  },
];

export const SKILLS: SkillEntry[] = [
  { id: 'rag', name: 'RAG · semantic_search', kind: 'frozen', status: '12.4k chunks @ abc123 · healthy', model: 'self-hosted nomic', on: true, description: 'Semantic slice-search over the per-commit-frozen embedding store. Filters by the ticket commit hash so results are frozen-per-ticket.', usedByStages: ['Refined', 'Plan', 'Implementatie'], lastIndexed: 'abc123 · 2h ago' },
  { id: 'graphify', name: 'graphify · impact_of', kind: 'live', status: '1.8k nodes', on: true, description: 'Call-graph queries (impact_of / graph_query) via the graphify MCP server. Shows what a change ripples into.', usedByStages: ['Plan', 'Implementatie'], lastIndexed: 'live' },
  { id: 'symbol', name: 'symbol-index', kind: 'frozen', status: 'lookup · @ abc123', on: true, description: 'lookup_symbol / get_signature over the indexed symbol table.', usedByStages: ['Plan', 'Implementatie'], lastIndexed: 'abc123 · 2h ago' },
  { id: 'route', name: 'route-index', kind: 'frozen', status: '142 routes', on: false, description: 'find_route over the API/sync route map — useful in large projects.', usedByStages: [], lastIndexed: 'abc123 · 2h ago' },
  { id: 'git', name: 'git-history', kind: 'live', status: 'blame + log', on: true, description: 'history_of(file) / blame — live, no frozen store.', usedByStages: ['Implementatie', 'Test', 'Review'], lastIndexed: 'live' },
  { id: 'test', name: 'test-runner', kind: 'live', status: 'vitest', on: true, description: 'run_tests / coverage_for — runs the project test suite.', usedByStages: ['Implementatie', 'Test'], lastIndexed: 'live' },
  { id: 'deps', name: 'deps-audit', kind: 'live', status: 'osv scanner', on: false, description: 'audit_deps — dependency + security scan (OSV).', usedByStages: ['Review'], lastIndexed: 'live' },
  { id: 'cross', name: 'cross-ticket', kind: 'live', status: 'links + dedupe', on: true, description: 'find_related_tickets — links and dedupes against other tickets.', usedByStages: ['Refined', 'Review'], lastIndexed: 'live' },
];

export const SSH_KEYS: SshKeyEntry[] = [
  { id: 'k1', name: 'MacBook Pro', type: 'ed25519', fingerprint: 'SHA256:9f3a…7c21', added: 'Mar 2025', lastUsed: 'today', userId: 'mathijs' },
];

export const SESSIONS: SessionEntry[] = [
  { id: 's1', device: 'MacBook Pro · Chrome', location: 'Amsterdam, NL', lastActive: 'now', current: true },
  { id: 's2', device: 'iPhone 15 · Safari', location: 'Amsterdam, NL', lastActive: '2h ago', current: false },
];

export const INVITES: InviteEntry[] = [
  { id: 'i1', email: 'joost@youcomm.nl', role: 'member', sentAt: '2026-07-10T09:00:00.000Z', expiresAt: '2026-07-17T09:00:00.000Z' },
];

//? Dummy SSH login: which member a pasted public-key value authenticates as.
export const SSH_KEY_TO_USER: Record<string, string> = { '123': 'test', '456': 'mathijs' };

export const USAGE_ROWS: UsageRow[] = [
  { ticketId: 'DEV-1245', tokensIn: '1.2M', tokensOut: '184k', cost: 4.1, time: '38m' },
  { ticketId: 'DEV-1242', tokensIn: '880k', tokensOut: '120k', cost: 2.74, time: '26m' },
  { ticketId: 'DEV-1247', tokensIn: '610k', tokensOut: '92k', cost: 1.86, time: '19m' },
  { ticketId: 'DEV-1240', tokensIn: '420k', tokensOut: '64k', cost: 1.18, time: '12m' },
  { ticketId: 'DEV-1244', tokensIn: '300k', tokensOut: '40k', cost: 0.82, time: '9m' },
];

//? Cost per day for the last 7 days (spend sparkline).
export const SPEND_7D: { day: string; cost: number }[] = [
  { day: 'Mon', cost: 12.4 }, { day: 'Tue', cost: 18.9 }, { day: 'Wed', cost: 9.2 },
  { day: 'Thu', cost: 22.1 }, { day: 'Fri', cost: 16.7 }, { day: 'Sat', cost: 28.3 }, { day: 'Sun', cost: 24.8 },
];

//? Human label for the built-in roles (used by invites + member defaults).
export const ROLE_DISPLAY: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

//? RBAC — the capabilities (rows) and the default editable role matrix (cols).
//? Owner is locked all-allowed; everything else is a starting point you can edit
//? per workspace. The order of `perms` lines up with RBAC_CAPABILITIES.
export const RBAC_CAPABILITIES: string[] = [
  'Use terminals + work on tickets',
  'Edit pipeline / stages',
  'Workspace settings / GitLab token',
  'Invite / remove members',
  'Manage sprints + labels, teardown',
  'Promote a member to Admin',
  'Downgrade / remove an Admin',
  'Transfer ownership / delete workspace',
];

const ADMIN_PERMS = [true, true, true, true, true, false, false, false];
const MEMBER_PERMS = [true, false, false, false, false, false, false, false];

export const DEFAULT_PERM_ROLES: PermRole[] = [
  { key: 'owner', name: 'Owner', locked: true, perms: RBAC_CAPABILITIES.map(() => true) },
  { key: 'admin', name: 'Admin', perms: ADMIN_PERMS },
  { key: 'member', name: 'Member', perms: MEMBER_PERMS },
];

//? ---------------------------------------------------------------- pipeline config
//? Catalogs for the pipeline editor. Skills reference SKILLS, context docs
//? reference DOCS. Everything is stack-agnostic (works on Node / .NET / Go / …),
//? grounded in handoff/DATAMODEL.md §2 + CLAUDE_SETTINGS_MAP.md.

//? F29 — the lifecycle hooks a stage container can emit.
//?
//? This list used to advertise NINE hooks; the container emitted three, and none of the six others had an
//? emitter anywhere. Toggling `WorktreeCreate` did nothing and said nothing — a UI that lies about what it
//? controls is worse than one that offers less. So the catalog is now exactly what `renderStage` writes
//? into the container's settings.json, and each entry's toggle really takes effect.
//?
//? `required` marks a hook the engine itself depends on: the Stop hook is how a turn is detected as
//? finished, so it is shown but not switchable — the alternative is a stage that hangs forever.

//? Common, Claude-relevant command patterns to whitelist, grouped by category.
//? Each maps to a `.claude` permission rule. Stack-agnostic on purpose. `desc`
//? feeds the ? info popover in the editor.
//? Integration TYPES (templates) — picked when setting up a workspace tool. Each
//? carries default config fields + a default MCP command. Stack-agnostic; custom
//? allowed too.
//? K4 — the DB integrations' `mcp` points at the REAL baked `cli-proxy.mjs` MCP server (queries via the baked
//? psql/mysql/redis-cli/mongosh + the K3-injected connection env). The old `/pty-agent/mcp/<svc>.js` paths never
//? existed (wrong dir + missing file), so enabling an integration exec'd a missing file. Services without a baked
//? CLI (kafka/rabbitmq/s3/elasticsearch/http) carry NO mcp for now (no broken exec; the agent uses the injected
//? env + curl/tools) — a dedicated MCP server per those is a follow-up.
export const INTEGRATION_TYPES: { key: string; label: string; fields: { label: string; placeholder?: string }[]; mcp: string }[] = [
  { key: 'mongodb', label: 'MongoDB', fields: [{ label: 'Connection string', placeholder: 'mongodb://…' }], mcp: 'node /opt/pty-agent/mcp/cli-proxy.mjs mongo' },
  { key: 'postgres', label: 'PostgreSQL', fields: [{ label: 'Connection string', placeholder: 'postgres://…' }], mcp: 'node /opt/pty-agent/mcp/cli-proxy.mjs postgres' },
  { key: 'mysql', label: 'MySQL', fields: [{ label: 'Connection string', placeholder: 'mysql://…' }], mcp: 'node /opt/pty-agent/mcp/cli-proxy.mjs mysql' },
  { key: 'redis', label: 'Redis', fields: [{ label: 'URL', placeholder: 'redis://…' }], mcp: 'node /opt/pty-agent/mcp/cli-proxy.mjs redis' },
  { key: 'kafka', label: 'Kafka', fields: [{ label: 'Brokers', placeholder: 'host:9092,…' }], mcp: '' },
  { key: 'rabbitmq', label: 'RabbitMQ', fields: [{ label: 'AMQP URL', placeholder: 'amqp://…' }], mcp: '' },
  { key: 's3', label: 'S3 / object storage', fields: [{ label: 'Endpoint' }, { label: 'Access key' }, { label: 'Secret key' }], mcp: '' },
  { key: 'elasticsearch', label: 'Elasticsearch', fields: [{ label: 'Node URL', placeholder: 'https://…' }], mcp: '' },
  { key: 'http', label: 'HTTP API', fields: [{ label: 'Base URL' }, { label: 'Auth header' }], mcp: '' },
];

//? Workspace env vars (hold the real secrets/config; integration tools point at them).
export const ENV_VARS: EnvVar[] = [
  { id: 'env-mongo', key: 'MONGODB_URI', value: 'mongodb://localhost:27017/youcomm', secret: true },
  { id: 'env-redis', key: 'REDIS_URL', value: 'redis://localhost:6379', secret: true },
  { id: 'env-gitlab', key: 'GITLAB_TOKEN', value: 'glpat-xxxxxxxxxxxx', secret: true },
  { id: 'env-node', key: 'NODE_ENV', value: 'development', secret: false },
];

//? Configured integration tools for this workspace (point at env vars + MCP).
export const INTEGRATION_TOOLS: IntegrationTool[] = [
  { id: 'tool-mongodb', name: 'MongoDB', type: 'mongodb', fields: [{ id: 'imf1', label: 'Connection string', envVarId: 'env-mongo' }], mcp: { enabled: true, command: 'node /pty-agent/mcp/mongo.js' } },
  { id: 'tool-redis', name: 'Redis', type: 'redis', fields: [{ id: 'imf2', label: 'URL', envVarId: 'env-redis' }], mcp: { enabled: true, command: 'node /pty-agent/mcp/redis.js' } },
];

const baseStatuses = (): StageStatusCfg[] => [
  { key: 'needs-input', label: 'Needs input', kind: 'base' },
  { key: 'busy', label: 'Busy', kind: 'base' },
  { key: 'stopped', label: 'Stopped', kind: 'base' },
  { key: 'done', label: 'Done', kind: 'base' },
];

const escalationRules = () => [
  { id: 'r-high', minScore: 7, model: 'opus' as const, effort: 'high' as const, maxTurns: 30 },
  { id: 'r-mid', minScore: 4, model: 'sonnet' as const, effort: 'medium' as const, maxTurns: 20 },
  { id: 'r-low', minScore: 1, model: 'haiku' as const, effort: 'low' as const, maxTurns: 10 },
];
const modelCfg = (base: StageModelChoice, autoEscalate: boolean): StageModelCfg => ({ autoEscalate, base, rules: autoEscalate ? escalationRules() : [] });
const network = (over?: Partial<StageNetworkCfg>): StageNetworkCfg => ({ enabled: true, mode: 'whitelist', categories: ['package-registries', 'source-hosts', 'ai-apis'], domains: ['gitlab.youcomm.nl'], ...over });

function cfg(id: string, kind: StageKind, name: string, order: number, over: Partial<PipelineStageCfg>): PipelineStageCfg {
  return {
    projectId: PRJ,
    id, kind, name, order, aiEnabled: true,
    customInstructions: '', handoverPrompt: '',
    skillKeys: [], aiSkillIds: [], sourceIds: ['summary'], commands: [],
    tools: [{ toolId: 'tool-mongodb', tier: 'ro' }],
    statuses: baseStatuses(),
    processes: [{ id: `${id}-claude`, name: 'claude', cwd: '/app', env: [], commands: ['npm run claude'] }],
    visibleStageIds: [],
    modelCfg: modelCfg({ model: 'sonnet', effort: 'medium', maxTurns: 12 }, false),
    network: network(),
    hooks: Object.fromEntries(HOOK_KEYS.map((k) => [k, true] as const)),
    ...over,
  };
}

export const STAGE_CONFIGS: PipelineStageCfg[] = [
  cfg('unrefined', 'refine', 'Unrefined', 0, {
    aiEnabled: false, skillKeys: [], sourceIds: ['summary'], processes: [], tools: [],
    modelCfg: modelCfg({ model: 'haiku', effort: 'low', maxTurns: 8 }, false),
    statuses: [...baseStatuses(), { key: 'triage', label: 'Triage', kind: 'custom' }],
    customInstructions: 'Human triage stage — no AI. Tickets land here from GitLab and wait for a person to refine them.',
  }),
  cfg('refined', 'refine', 'Refined', 1, {
    modelCfg: modelCfg({ model: 'haiku', effort: 'low', maxTurns: 12 }, false),
    skillKeys: ['rag', 'cross'], sourceIds: ['summary', 'glossary'],
    handoverPrompt: 'Name the agreed scope, the acceptance criteria, and anything you could NOT resolve.',
    customInstructions: 'Clarify scope only. Do NOT write code. Produce acceptance criteria + edge cases.',
  }),
  cfg('plan', 'plan', 'Plan', 2, {
    modelCfg: modelCfg({ model: 'opus', effort: 'high', maxTurns: 20 }, true),
    skillKeys: ['rag', 'graphify', 'symbol'], sourceIds: ['summary', 'dbschema', 'authspec'], visibleStageIds: ['refined'],
    handoverPrompt: 'Give the ordered plan: which files change, in what order, and where the risk sits.',
    customInstructions: 'Output a numbered plan + risks + a rollback note. No edits. Reference the db-schema where relevant.',
  }),
  cfg('impl', 'code', 'Implementatie', 3, {
    modelCfg: modelCfg({ model: 'sonnet', effort: 'high', maxTurns: 30 }, true),
    skillKeys: ['rag', 'graphify', 'symbol', 'git', 'test'], sourceIds: ['summary', 'conventions', 'dbschema'],
    tools: [{ toolId: 'tool-mongodb', tier: 'rw' }, { toolId: 'tool-redis', tier: 'rw' }], visibleStageIds: ['plan', 'refined'],
    processes: [
      { id: 'impl-claude', name: 'claude', cwd: '/app', env: [], commands: ['npm run claude'] },
      { id: 'impl-server', name: 'server', cwd: '/app', env: [{ key: 'NODE_ENV', value: 'development' }], commands: ['npm run server'] },
      { id: 'impl-client', name: 'client', cwd: '/app', env: [], commands: ['npm run client'] },
    ],
    commands: [
      { id: 'c1', pattern: 'Bash(npm run test:*)', mode: 'allow' },
      { id: 'c2', pattern: 'Bash(npm run build)', mode: 'allow' },
      { id: 'c3', pattern: 'Bash(npm publish)', mode: 'deny' },
    ],
    handoverPrompt: 'Say what you changed and why, which files, and anything you assumed or left half-done.',
    customInstructions: 'Follow the Plan stage exactly. Keep changes surgical. Run the test suite before finishing.',
    statuses: [...baseStatuses(), { key: 'review-ready', label: 'Review-ready', kind: 'custom' }],
  }),
  cfg('test', 'test', 'Test', 4, {
    modelCfg: modelCfg({ model: 'sonnet', effort: 'medium', maxTurns: 20 }, true),
    skillKeys: ['test', 'git'], sourceIds: ['summary', 'conventions'], visibleStageIds: ['plan', 'impl'],
    processes: [
      { id: 'test-claude', name: 'claude', cwd: '/app', env: [], commands: ['npm run claude'] },
      { id: 'test-server', name: 'server', cwd: '/app', env: [], commands: ['npm run server'] },
    ],
    commands: [
      { id: 't1', pattern: 'Bash(npm run test:*)', mode: 'allow' },
      { id: 't2', pattern: 'Bash(npm run coverage)', mode: 'allow' },
    ],
    handoverPrompt: 'Report what you covered, what passes and what fails - name the failing case, not just a count.',
    customInstructions: 'Add a regression test for every changed file. Fail loudly on uncovered branches.',
  }),
  cfg('review', 'review', 'Review', 5, {
    modelCfg: modelCfg({ model: 'opus', effort: 'high', maxTurns: 18 }, true),
    skillKeys: ['cross', 'deps', 'git'], sourceIds: ['summary', 'conventions'], visibleStageIds: ['plan', 'impl', 'test'],
    commands: [{ id: 'r1', pattern: 'Bash(git push:*)', mode: 'ask' }],
    handoverPrompt: 'List your findings concretely enough to act on without re-reading the diff.',
    customInstructions: 'Be a skeptical reviewer. Flag security + correctness first. Default to requesting changes.',
    statuses: [...baseStatuses(), { key: 'approved', label: 'Approved', kind: 'custom' }],
  }),
  cfg('final', 'final', 'Final', 6, {
    modelCfg: modelCfg({ model: 'haiku', effort: 'low', maxTurns: 10 }, false),
    skillKeys: [], sourceIds: ['summary'], processes: [], tools: [{ toolId: 'tool-mongodb', tier: 'ro' }],
    handoverPrompt: 'Summarise the merged change the way it should read in the changelog.',
    customInstructions: 'Produce the MR description + changelog entry. No code.',
  }),
];
