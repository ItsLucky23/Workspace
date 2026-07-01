//? Workspaces — dummy seed data for the UI prototype.
//?
//? Mirrors the prototype's `data.js` and stays consistent across screens
//? (workspace YouComm Core, project youcomm-app, 7-stage pipeline, 12 tickets
//? DEV-1240…DEV-1251, 5 members). Typed against `_data/types.ts` so it lines up
//? with the real Prisma model. No server, no fetching — imported directly.

import type {
  ActivityEvent,
  AiSuggestion,
  ChatMessage,
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
  StageId,
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

export const ME: Member = MEMBERS.mathijs!;

export const WORKSPACES: Workspace[] = [
  { id: 'ws-youcomm', name: 'YouComm Core', slug: 'youcomm-core', ownerId: 'mathijs', role: 'owner' },
  { id: 'ws-luckystack', name: 'LuckyStack OSS', slug: 'luckystack-oss', ownerId: 'sanne', role: 'member' },
];
export const ACTIVE_WORKSPACE = WORKSPACES[0]!;

export const PROJECTS: Project[] = [
  { id: 'prj-app', workspaceId: 'ws-youcomm', name: 'youcomm-app', gitlabPath: 'youcomm/app' },
  { id: 'prj-api', workspaceId: 'ws-youcomm', name: 'youcomm-api', gitlabPath: 'youcomm/api' },
];
export const ACTIVE_PROJECT = PROJECTS[0]!;

export const STAGES: PipelineStage[] = [
  { id: 'unrefined', name: 'Unrefined', order: 0, aiEnabled: false },
  { id: 'refined', name: 'Refined', order: 1, aiEnabled: true },
  { id: 'plan', name: 'Plan', order: 2, aiEnabled: true, wipLimit: 2 },
  { id: 'impl', name: 'Implementatie', order: 3, aiEnabled: true },
  { id: 'test', name: 'Test', order: 4, aiEnabled: true },
  { id: 'review', name: 'Review', order: 5, aiEnabled: true },
  { id: 'final', name: 'Final', order: 6, aiEnabled: true },
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
    files: [
      {
        path: 'src/_components/Avatar.tsx', add: 12, del: 4,
        diff: [
          { kind: 'hunk', text: '@@ -18,9 +18,17 @@ export default function Avatar({ user }) {' },
          { kind: 'ctx', oldNo: 18, newNo: 18, text: '  const { avatarStatuses, setAvatarStatus } = useAvatarContext();' },
          { kind: 'del', oldNo: 19, text: '  const status = avatarStatuses[user.avatar];' },
          { kind: 'add', newNo: 19, text: '  const statusKey = getAvatarStatusKey(user.avatar, user.name);' },
          { kind: 'add', newNo: 20, text: '  const status = avatarStatuses[statusKey];' },
          { kind: 'ctx', oldNo: 20, newNo: 21, text: '  const showFallback = !user.avatar || status === "fallback";' },
          { kind: 'add', newNo: 22, text: '  // hold the previous frame during refetch to avoid the flicker' },
          { kind: 'ctx', oldNo: 21, newNo: 23, text: '  return showFallback ? <Fallback /> : <img … />;' },
        ],
      },
      {
        path: 'src/_providers/avatarProvider.tsx', add: 28, del: 2,
        diff: [
          { kind: 'hunk', text: '@@ -4,6 +4,14 @@ const AvatarContext = createContext(null);' },
          { kind: 'ctx', oldNo: 4, newNo: 4, text: 'export function AvatarProvider({ children }) {' },
          { kind: 'del', oldNo: 5, text: '  const [statuses, setStatuses] = useState({});' },
          { kind: 'add', newNo: 5, text: '  const [statuses, setStatuses] = useState({});' },
          { kind: 'add', newNo: 6, text: '  const setAvatarStatus = useCallback((key, status) => {' },
          { kind: 'add', newNo: 7, text: '    setStatuses((prev) => (prev[key] === status ? prev : { ...prev, [key]: status }));' },
          { kind: 'add', newNo: 8, text: '  }, []);' },
          { kind: 'ctx', oldNo: 6, newNo: 9, text: '  return <AvatarContext.Provider value={{ statuses, setAvatarStatus }}>{children}</AvatarContext.Provider>;' },
        ],
      },
      {
        path: 'src/_components/Avatar.test.tsx', add: 16, del: 0,
        diff: [
          { kind: 'hunk', text: '@@ -0,0 +1,16 @@' },
          { kind: 'add', newNo: 1, text: 'it("holds the previous frame during refetch", async () => {' },
          { kind: 'add', newNo: 2, text: '  const { rerender } = render(<Avatar user={user} />);' },
          { kind: 'add', newNo: 3, text: '  expect(screen.queryByRole("img")).toBeNull();' },
          { kind: 'add', newNo: 4, text: '  // … fans out the first resolution to every instance' },
          { kind: 'add', newNo: 5, text: '});' },
        ],
      },
    ],
    links: [{ id: 'DEV-1245', rel: 'relates to', ai: true, reason: 'Both tickets touch the Avatar render path — DEV-1245’s board cards render AvatarStacks, so the fallback-flicker fix here affects how they paint on first load.' }],
    history: [
      { stage: 'Refined', summary: 'Repro confirmed on throttled 3G; root-caused to per-instance state.', done: true },
      { stage: 'Plan', summary: 'Chose a shared AvatarProvider status map keyed by file id + cache-bust.', done: true },
      { stage: 'Implementatie', summary: 'In progress — provider wired, tests being written.', done: false },
    ],
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
    links: [{ id: 'DEV-1249', rel: 'relates to', ai: true, reason: 'DEV-1249 builds the per-workspace token vault. The Microsoft client secret needed here is exactly the kind of credential that vault is meant to store — likely a shared dependency.' }],
    history: [
      { stage: 'Refined', summary: 'Scoped to Entra ID only for v1.', done: true },
      { stage: 'Plan', summary: 'Waiting on secret-storage decision.', done: false },
    ],
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
export const ACTIVE_SPRINT = SPRINTS[0]!;

export const NOTIFICATIONS: NotificationItem[] = [
  { id: 'n1', type: 'needs-input', title: 'DEV-1241 needs your input', body: 'AI asks where the Microsoft client secret should live.', ticketId: 'DEV-1241', time: '2m', read: false },
  { id: 'n2', type: 'container-failure', title: 'Container failed to start', body: 'DEV-1244 — out of memory while installing deps.', ticketId: 'DEV-1244', time: '14m', read: false },
  { id: 'n3', type: 'ai-suggestion', title: 'New Workspace-AI suggestion', body: "Merge DEV-1241 & DEV-1249 into a 'secrets' epic.", ticketId: 'DEV-1249', time: '31m', read: false },
  { id: 'n4', type: 'merge', title: 'MR !88 merged', body: 'DEV-1246 merged into main (abc123).', ticketId: 'DEV-1246', time: '1h', read: true },
  { id: 'n5', type: 'ai-suggestion', title: 'Agent escalated to needs-input', body: 'DEV-1242 looked stuck (idle 8m) — paused for you.', ticketId: 'DEV-1242', time: '2h', read: true },
];

export const BUDGET: WorkspaceBudget = { spent: 168.4, cap: 200, alertPct: 80, currency: '€' };

export const EVENTS: ActivityEvent[] = [
  { time: '14:32', actor: 'ai', ticketId: 'DEV-1240', type: 'command', text: '`npm test` → 2 failing' },
  { time: '14:31', actor: 'ai', ticketId: 'DEV-1240', type: 'file-change', text: 'edited src/_components/Avatar.tsx (+12 −4)' },
  { time: '14:30', actor: 'ai', ticketId: 'DEV-1245', type: 'ai-message', text: 'Wiring dnd-kit columns; need a Column type…' },
  { time: '14:29', actor: 'sanne', ticketId: 'DEV-1241', type: 'status-change', text: '→ needs input' },
  { time: '14:27', actor: 'ai', ticketId: 'DEV-1242', type: 'ai-message', text: 'Asked: configurable burst size per route?' },
  { time: '14:24', actor: 'ai', ticketId: 'DEV-1245', type: 'command', text: '`npm run client` → vite ready :5173' },
  { time: '14:21', actor: 'mathijs', ticketId: 'DEV-1240', type: 'status-change', text: '→ busy · started terminal' },
  { time: '14:18', actor: 'mr', ticketId: 'DEV-1246', type: 'mr', text: 'merged !88 into main (abc123)' },
  { time: '14:12', actor: 'ai', ticketId: 'DEV-1247', type: 'file-change', text: 'created src/mcp/graphify/impact_of.ts (+86)' },
  { time: '14:05', actor: 'tom', ticketId: 'DEV-1249', type: 'comment', text: 'Left a note on the vault encryption scheme' },
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
    id: 'summary', name: 'project-summary', source: 'generated', updated: '2h ago', note: 'frozen @ abc123',
    summary: 'High-level orientation: what the project is, its architecture (web-app + orchestrator), and the house conventions. Always loaded first.',
    pendingBranches: ['DEV-1245', 'DEV-1249'], usedByStages: ['Refined', 'Plan', 'Implementatie'],
    content: '# Project summary\n\nLuckyStack is a socket-first fullstack framework (React 19 + raw Node + Socket.io). Workspaces orchestrates AI-driven development: tickets flow through a configurable pipeline, each running in its own container with a live terminal.\n\n## Architecture\n- web-app (this UI) — board, terminals, sources, presence\n- orchestrator — containers, worktrees, ~20 Claude-CLI processes, RAG indexer\n\n## Conventions\nSee `conventions` doc. DB schema in `db-schema`.',
  },
  {
    id: 'conventions', name: 'conventions', source: 'git', updated: '1d ago', note: 'frozen @ abc123',
    summary: 'Coding house-style: token-only colors, mandatory i18n, custom tryCatch, surgical changes. The rules the agent must follow when writing code.',
    usedByStages: ['Implementatie', 'Test', 'Review'],
    content: '# Conventions\n\n- Tailwind colors come ONLY from the theme tokens.\n- i18n via useTranslator for user-facing text.\n- Custom tryCatch everywhere — never raw try/catch.\n- Surgical changes; every changed line traces to the request.',
  },
  {
    id: 'glossary', name: 'glossary', source: 'git', updated: '3d ago', note: 'frozen @ abc123',
    summary: 'Domain terms: stage vs status, worktree, RAG snapshot, commit-hash freezing. Disambiguates the project vocabulary.',
    usedByStages: ['Refined', 'Review'],
    content: '# Glossary\n\n- **Stage** — a pipeline step (board column).\n- **Status** — ticket state within a stage (pill).\n- **Worktree** — per-ticket git checkout on a DEV-#### branch.\n- **RAG snapshot** — embeddings frozen on a commit hash.',
  },
  {
    id: 'dbschema', name: 'db-schema', source: 'generated', updated: '2h ago', note: 'frozen @ abc123',
    summary: 'Generated Prisma model excerpt (Ticket, TicketEvent, …). Lets the agent reason about the data shape without reading the whole schema.',
    pendingBranches: ['DEV-1249'], usedByStages: ['Plan', 'Implementatie'],
    content: '# DB schema (excerpt)\n\nmodel Ticket {\n  id String @id\n  stageId String\n  statusKey String\n  branch String?\n  commitHash String?\n}\n\nmodel TicketEvent { id; ticketId; seq Int; type; payload Json }',
  },
  {
    id: 'authspec', name: 'Auth redesign.md', source: 'uploaded', updated: '5d ago', note: 'spec',
    summary: 'Uploaded spec: OAuth = login, SSH key = terminal capability gate. The design decision behind the auth flow.',
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
  { id: 'i1', email: 'joost@youcomm.nl', role: 'member', sent: '2d ago' },
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
  { name: 'Owner', locked: true, perms: RBAC_CAPABILITIES.map(() => true) },
  { name: 'Admin', perms: ADMIN_PERMS },
  { name: 'Member', perms: MEMBER_PERMS },
];

//? Workspace-AI seed conversation.
export const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 'm0', role: 'ai',
    text: "Hi — I'm your Workspace-AI. Ask me to move a ticket (e.g. “move DEV-1240 to review”), summarise progress, or link related work. I can drive every action in here.",
  },
];

//? ---------------------------------------------------------------- pipeline config
//? Catalogs for the pipeline editor. Skills reference SKILLS, context docs
//? reference DOCS. Everything is stack-agnostic (works on Node / .NET / Go / …),
//? grounded in handoff/DATAMODEL.md §2 + CLAUDE_SETTINGS_MAP.md.

//? Lifecycle hooks — grouped, with their matcher + what they feed.
export const HOOK_CATALOG: { key: string; label: string; category: string; matcher: string; feeds: string; desc: string }[] = [
  { key: 'SessionStart', label: 'SessionStart', category: 'Lifecycle', matcher: 'stage container boots', feeds: 'AgentSession + carry-over', desc: 'Registers the session and injects the previous stage’s structured output as the start prompt.' },
  { key: 'UserPromptSubmit', label: 'UserPromptSubmit', category: 'Lifecycle', matcher: 'manual user input', feeds: 'TicketEvent (user-input)', desc: 'Logs a voice note / reply before it runs — full audit trail.' },
  { key: 'WorktreeCreate', label: 'WorktreeCreate', category: 'Lifecycle', matcher: 'git worktree add', feeds: 'orchestrator state', desc: 'Syncs the branch/worktree with the orchestrator when the container spins up.' },
  { key: 'WorktreeRemove', label: 'WorktreeRemove', category: 'Lifecycle', matcher: 'git worktree remove', feeds: 'orchestrator state', desc: 'Cleans up references when the container is torn down.' },
  { key: 'PostToolUse', label: 'PostToolUse', category: 'Events & status', matcher: 'Bash · Edit · Write · mcp__*', feeds: 'TicketEvent → live activity', desc: 'Records each command and file-change as an event in the live stream.' },
  { key: 'PostToolUseFailure', label: 'PostToolUseFailure', category: 'Events & status', matcher: 'any failed tool', feeds: 'error event + escalate', desc: 'Captures tool errors and can escalate the ticket to needs-input.' },
  { key: 'Stop', label: 'Stop', category: 'Events & status', matcher: 'stage-AI finished', feeds: 'done / needs-input + move', desc: 'Marks the stage done (or needs-input if idle) and runs the pipeline-move logic.' },
  { key: 'Notification', label: 'Notification', category: 'Gating', matcher: 'permission_prompt · idle_prompt', feeds: 'needs-input + notify', desc: 'Permission / idle prompts pause the agent, flag needs-input and ping you.' },
  { key: 'PreToolUse', label: 'PreToolUse', category: 'Gating', matcher: 'per-tool', feeds: 'app-level gating', desc: 'Extra gate before a tool runs (e.g. enforce the DB read/write tier).' },
];
const HOOK_KEYS = HOOK_CATALOG.map((h) => h.key);

//? Common, Claude-relevant command patterns to whitelist, grouped by category.
//? Each maps to a `.claude` permission rule. Stack-agnostic on purpose. `desc`
//? feeds the ? info popover in the editor.
export const COMMAND_CATALOG: { category: string; commands: { pattern: string; label: string; desc: string }[] }[] = [
  { category: 'Package managers', commands: [
    { pattern: 'Bash(npm install)', label: 'npm install', desc: 'Install Node dependencies from package.json.' },
    { pattern: 'Bash(npm ci)', label: 'npm ci', desc: 'Clean install from the lockfile (CI-style, reproducible).' },
    { pattern: 'Bash(pnpm install)', label: 'pnpm install', desc: 'Install dependencies with pnpm.' },
    { pattern: 'Bash(yarn install)', label: 'yarn install', desc: 'Install dependencies with Yarn.' },
    { pattern: 'Bash(dotnet restore)', label: 'dotnet restore', desc: 'Restore NuGet packages for a .NET project.' },
    { pattern: 'Bash(go mod download)', label: 'go mod download', desc: 'Download Go module dependencies.' },
    { pattern: 'Bash(pip install:*)', label: 'pip install …', desc: 'Install Python packages with pip.' },
  ] },
  { category: 'Build & run', commands: [
    { pattern: 'Bash(npm run build)', label: 'npm run build', desc: 'Run the project build script.' },
    { pattern: 'Bash(npm run *)', label: 'npm run …', desc: 'Run any package.json script (broad — covers all run targets).' },
    { pattern: 'Bash(dotnet build)', label: 'dotnet build', desc: 'Compile a .NET project/solution.' },
    { pattern: 'Bash(go build:*)', label: 'go build …', desc: 'Compile Go packages.' },
    { pattern: 'Bash(make:*)', label: 'make …', desc: 'Run Makefile targets.' },
  ] },
  { category: 'Testing', commands: [
    { pattern: 'Bash(npm run test:*)', label: 'npm run test…', desc: 'Run test scripts (test, test:unit, test:e2e, …).' },
    { pattern: 'Bash(npm run coverage)', label: 'npm run coverage', desc: 'Run the test suite with coverage.' },
    { pattern: 'Bash(dotnet test)', label: 'dotnet test', desc: 'Run the .NET test suite.' },
    { pattern: 'Bash(go test ./...)', label: 'go test ./...', desc: 'Run all Go tests in the module.' },
  ] },
  { category: 'Version control', commands: [
    { pattern: 'Bash(git add:*)', label: 'git add …', desc: 'Stage files for commit.' },
    { pattern: 'Bash(git commit:*)', label: 'git commit …', desc: 'Create a commit on the ticket branch.' },
    { pattern: 'Bash(git checkout:*)', label: 'git checkout …', desc: 'Switch branches / restore files.' },
    { pattern: 'Bash(git push:*)', label: 'git push …', desc: 'Push commits to the remote (opens/updates the MR).' },
    { pattern: 'Bash(git rebase:*)', label: 'git rebase …', desc: 'Rebase the branch — history rewrite, use with care.' },
  ] },
  { category: 'Filesystem & edits', commands: [
    { pattern: 'Edit(*)', label: 'Edit files', desc: 'Modify existing files in the worktree.' },
    { pattern: 'Write(*)', label: 'Write files', desc: 'Create new files in the worktree.' },
    { pattern: 'Bash(mkdir:*)', label: 'mkdir …', desc: 'Create directories.' },
    { pattern: 'Bash(rm:*)', label: 'rm …', desc: 'Delete files — destructive.' },
  ] },
  { category: 'Containers & infra', commands: [
    { pattern: 'Bash(docker:*)', label: 'docker …', desc: 'Run Docker commands inside the container.' },
    { pattern: 'Bash(docker compose:*)', label: 'docker compose …', desc: 'Bring up/down compose services.' },
    { pattern: 'Bash(kubectl:*)', label: 'kubectl …', desc: 'Interact with a Kubernetes cluster — high blast radius.' },
  ] },
  { category: 'Database CLIs', commands: [
    { pattern: 'Bash(psql:*)', label: 'psql …', desc: 'PostgreSQL CLI.' },
    { pattern: 'Bash(mysql:*)', label: 'mysql …', desc: 'MySQL CLI.' },
    { pattern: 'Bash(redis-cli:*)', label: 'redis-cli …', desc: 'Redis CLI.' },
    { pattern: 'Bash(mongosh:*)', label: 'mongosh …', desc: 'MongoDB shell.' },
  ] },
  { category: 'Network & dangerous', commands: [
    { pattern: 'Bash(curl:*)', label: 'curl …', desc: 'HTTP requests — can exfiltrate; pair with a Network allow-list.' },
    { pattern: 'Bash(npm publish)', label: 'npm publish', desc: 'Publish a package to the registry — almost always Deny.' },
    { pattern: 'Bash(sudo:*)', label: 'sudo …', desc: 'Run as root — almost always Deny.' },
    { pattern: 'Bash(rm -rf:*)', label: 'rm -rf …', desc: 'Recursive force delete — almost always Deny.' },
  ] },
];

//? Integration TYPES (templates) — picked when setting up a workspace tool. Each
//? carries default config fields + a default MCP command. Stack-agnostic; custom
//? allowed too.
export const INTEGRATION_TYPES: { key: string; label: string; fields: { label: string; placeholder?: string }[]; mcp: string }[] = [
  { key: 'mongodb', label: 'MongoDB', fields: [{ label: 'Connection string', placeholder: 'mongodb://…' }], mcp: 'node /pty-agent/mcp/mongo.js' },
  { key: 'postgres', label: 'PostgreSQL', fields: [{ label: 'Connection string', placeholder: 'postgres://…' }], mcp: 'node /pty-agent/mcp/postgres.js' },
  { key: 'mysql', label: 'MySQL', fields: [{ label: 'Connection string', placeholder: 'mysql://…' }], mcp: 'node /pty-agent/mcp/mysql.js' },
  { key: 'redis', label: 'Redis', fields: [{ label: 'URL', placeholder: 'redis://…' }], mcp: 'node /pty-agent/mcp/redis.js' },
  { key: 'kafka', label: 'Kafka', fields: [{ label: 'Brokers', placeholder: 'host:9092,…' }], mcp: 'node /pty-agent/mcp/kafka.js' },
  { key: 'rabbitmq', label: 'RabbitMQ', fields: [{ label: 'AMQP URL', placeholder: 'amqp://…' }], mcp: 'node /pty-agent/mcp/amqp.js' },
  { key: 's3', label: 'S3 / object storage', fields: [{ label: 'Endpoint' }, { label: 'Access key' }, { label: 'Secret key' }], mcp: 'node /pty-agent/mcp/s3.js' },
  { key: 'elasticsearch', label: 'Elasticsearch', fields: [{ label: 'Node URL', placeholder: 'https://…' }], mcp: 'node /pty-agent/mcp/es.js' },
  { key: 'http', label: 'HTTP API', fields: [{ label: 'Base URL' }, { label: 'Auth header' }], mcp: 'node /pty-agent/mcp/http.js' },
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

//? Network egress category presets (whitelist/blacklist building blocks).
export const NETWORK_CATEGORIES: { key: string; label: string; desc: string }[] = [
  { key: 'package-registries', label: 'Package registries', desc: 'npm, NuGet, Go proxy, PyPI, crates.io' },
  { key: 'source-hosts', label: 'Source hosts', desc: 'github.com, gitlab.com, bitbucket.org' },
  { key: 'ai-apis', label: 'AI APIs', desc: 'api.anthropic.com, api.openai.com' },
  { key: 'cdns', label: 'CDNs', desc: 'jsdelivr, unpkg, cloudflare' },
  { key: 'cloud', label: 'Cloud providers', desc: 'AWS, GCP, Azure endpoints' },
  { key: 'social', label: 'Social & media', desc: 'twitter/x, youtube, reddit' },
  { key: 'trackers', label: 'Ads & trackers', desc: 'analytics + ad networks' },
];

//? Carry-over variables (B-O2) — what the previous stage hands to this one.
export const CARRY_VARS: { token: string; desc: string }[] = [
  { token: '{{summary}}', desc: 'One-paragraph summary of what the previous stage produced.' },
  { token: '{{changedFiles}}', desc: 'List of files the previous stage touched (with +/− counts).' },
  { token: '{{openQuestions}}', desc: 'Unresolved questions the previous stage flagged.' },
  { token: '{{commitHash}}', desc: 'The frozen commit the ticket’s context is pinned to.' },
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

function cfg(id: StageId, name: string, order: number, over: Partial<PipelineStageCfg>): PipelineStageCfg {
  return {
    id, name, order, aiEnabled: true,
    customInstructions: '', promptTemplate: '',
    skillKeys: [], sourceIds: ['summary'], commands: [],
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
  cfg('unrefined', 'Unrefined', 0, {
    aiEnabled: false, skillKeys: [], sourceIds: ['summary'], processes: [], tools: [],
    modelCfg: modelCfg({ model: 'haiku', effort: 'low', maxTurns: 8 }, false),
    statuses: [...baseStatuses(), { key: 'triage', label: 'Triage', kind: 'custom' }],
    customInstructions: 'Human triage stage — no AI. Tickets land here from GitLab and wait for a person to refine them.',
  }),
  cfg('refined', 'Refined', 1, {
    modelCfg: modelCfg({ model: 'haiku', effort: 'low', maxTurns: 12 }, false),
    skillKeys: ['rag', 'cross'], sourceIds: ['summary', 'glossary'],
    promptTemplate: 'Refine the ticket into clear acceptance criteria.\nPrior summary: {{summary}}\nOpen questions: {{openQuestions}}',
    customInstructions: 'Clarify scope only. Do NOT write code. Produce acceptance criteria + edge cases.',
  }),
  cfg('plan', 'Plan', 2, {
    modelCfg: modelCfg({ model: 'opus', effort: 'high', maxTurns: 20 }, true),
    skillKeys: ['rag', 'graphify', 'symbol'], sourceIds: ['summary', 'dbschema', 'authspec'], visibleStageIds: ['refined'],
    promptTemplate: 'Produce a step-by-step implementation plan.\nFrom Refined: {{summary}}\nKnown files: {{changedFiles}}',
    customInstructions: 'Output a numbered plan + risks + a rollback note. No edits. Reference the db-schema where relevant.',
  }),
  cfg('impl', 'Implementatie', 3, {
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
    promptTemplate: 'Implement the plan.\nPlan: {{summary}}\nFiles in scope: {{changedFiles}}\nCommit base: {{commitHash}}',
    customInstructions: 'Follow the Plan stage exactly. Keep changes surgical. Run the test suite before finishing.',
    statuses: [...baseStatuses(), { key: 'review-ready', label: 'Review-ready', kind: 'custom' }],
  }),
  cfg('test', 'Test', 4, {
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
    promptTemplate: 'Write & run tests for the changes.\nChanged files: {{changedFiles}}',
    customInstructions: 'Add a regression test for every changed file. Fail loudly on uncovered branches.',
  }),
  cfg('review', 'Review', 5, {
    modelCfg: modelCfg({ model: 'opus', effort: 'high', maxTurns: 18 }, true),
    skillKeys: ['cross', 'deps', 'git'], sourceIds: ['summary', 'conventions'], visibleStageIds: ['plan', 'impl', 'test'],
    commands: [{ id: 'r1', pattern: 'Bash(git push:*)', mode: 'ask' }],
    promptTemplate: 'Adversarially review the diff.\nSummary: {{summary}}\nOpen questions: {{openQuestions}}',
    customInstructions: 'Be a skeptical reviewer. Flag security + correctness first. Default to requesting changes.',
    statuses: [...baseStatuses(), { key: 'approved', label: 'Approved', kind: 'custom' }],
  }),
  cfg('final', 'Final', 6, {
    modelCfg: modelCfg({ model: 'haiku', effort: 'low', maxTurns: 10 }, false),
    skillKeys: [], sourceIds: ['summary'], processes: [], tools: [{ toolId: 'tool-mongodb', tier: 'ro' }],
    promptTemplate: 'Summarise the merged change for the changelog.\n{{summary}}',
    customInstructions: 'Produce the MR description + changelog entry. No code.',
  }),
];
