//? AgentRole plugin registry (#2). The engine's ONE built-in role is the code-writing agent (the
//? interactive `claude` PTY, PTY-billing invariant B-6). This registry lets a self-host operator
//? plug in ADDITIONAL, NON-coding roles (a reviewer, a summariser, a triage bot) that a
//? WorkspaceTrigger's `invoke-agent-role` action can dispatch — WITHOUT touching the engine core.
//? A role is a pure descriptor + a handler; it is workspace-action-scoped (invariant B-4: never
//? host/system-level) and its handler runs under `runInTenant` at the call site.
//?
//? Kept deliberately small + generic (framework code, SOLID): register at boot, look up by key,
//? list for the UI. No I/O here — the handler does the work when the executor invokes it.

export interface AgentRoleContext {
  workspaceId: string;
  ticketKey?: string;
  //? Free-form params from the trigger (e.g. a prompt template, a target stage).
  params: Record<string, unknown>;
}

export interface AgentRole {
  //? Stable key referenced by a trigger's params (`{ role: '<key>' }`).
  key: string;
  //? Human label for the trigger editor / ArtifactViewer.
  label: string;
  //? One-line description of what this role does.
  description: string;
  //? Does this role write authoritative state? Then the executor gates it behind approval even if
  //? the trigger didn't ask — a plugin can't silently bypass the single-writer invariant (B-23).
  mutates: boolean;
  //? Run the role. Returns an artifact (rendered by the ArtifactViewer) or null. Best-effort — the
  //? executor wraps it in tryCatch, so a throwing plugin never breaks the trigger pipeline.
  run: (ctx: AgentRoleContext) => Promise<{ kind: string; title: string; body: string } | null>;
}

const roles = new Map<string, AgentRole>();

//? Register (or replace) an agent role. Called once per role at boot from the server overlay.
export function registerAgentRole(role: AgentRole): void {
  roles.set(role.key, role);
}

export function getAgentRole(key: string): AgentRole | undefined {
  return roles.get(key);
}

//? All registered roles (for the trigger editor's role picker + the ArtifactViewer legend).
export function listAgentRoles(): { key: string; label: string; description: string; mutates: boolean }[] {
  return [...roles.values()].map((r) => ({ key: r.key, label: r.label, description: r.description, mutates: r.mutates }));
}

//? Test/boot helper — clear the registry (used by unit tests to isolate).
export function resetAgentRoles(): void {
  roles.clear();
}
