//? Workspaces — app-level context. Holds the SPA state the prototype kept in
//? App.jsx (current view, open ticket tabs, AI suggestions) and the navigation
//? helpers, so any screen/card deep in the tree can drive the shell without
//? prop-drilling. State lives in `page.tsx`; this just types + exposes it.

import { createContext, use } from 'react';

import type {
  ActivityEvent, AiSuggestion, ChatMessage, EnvVar, InfoDoc, IntegrationTool, InviteEntry,
  Member, PermRole, PipelineStage, SkillEntry, Sprint, SshKeyEntry, Ticket, Workspace, WorkspaceBudget,
} from '../_data/types';

export type WsView =
  | 'board' | 'backlog' | 'terminals' | 'activity' | 'sources'
  | 'pipeline' | 'usage' | 'ai' | 'settings' | 'workspace'
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
  unreadNotifications: number;
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
  //? Workspaces: one project = one workspace. Switch the active one or create a
  //? new (still-simple) workspace. Dummy data shared across them for now.
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string) => void;
  //? Editable per-workspace RBAC + each member's assigned role. Held here so the
  //? edits persist across tab/route changes (would persist server-side for real).
  permRoles: PermRole[];
  togglePerm: (roleIndex: number, capIndex: number) => void;
  addRole: (name: string) => void;
  memberRoles: Record<string, string>;
  setMemberRole: (memberId: string, role: string) => void;
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

  //? ----- live tenant data (from the `workspaces/snapshot` read; MIGRATION §4) -----
  //? These replace the screens' old direct `_data/seed` DATA imports. Static
  //? CATALOGS (HOOK_CATALOG, COMMAND_CATALOG, INTEGRATION_TYPES, NETWORK_CATEGORIES,
  //? CARRY_VARS, RBAC_CAPABILITIES, ROLE_DISPLAY, …) stay as `_data/seed` imports.
  loading: boolean;                    // snapshot still loading
  refetch: () => void;                 // re-pull the snapshot (after a control-API write)
  tickets: Ticket[];                   // was TICKETS
  members: Member[];                   // was Object.values(MEMBERS)
  membersById: Record<string, Member>; // was MEMBERS
  stages: PipelineStage[];             // was STAGES (board meta; full editor config still on seed)
  sprints: Sprint[];                   // was SPRINTS
  budget: WorkspaceBudget | null;      // was BUDGET
  docs: InfoDoc[];                     // was DOCS (InfoSource mode='context-doc')
  skills: SkillEntry[];                // was SKILLS (InfoSource mode='skill')
  invites: InviteEntry[];              // was INVITES
  activityEvents: ActivityEvent[];     // was EVENTS
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
