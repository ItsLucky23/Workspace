//? AgentRole plugin registry (#2). The engine's ONE built-in role is the code-writing agent (the
//? interactive `claude` PTY, PTY-billing invariant B-6). This registry lets a self-host operator
//? plug in ADDITIONAL, NON-coding roles (a reviewer, a summariser, a triage bot) that a
//? WorkspaceTrigger's `invoke-agent-role` action can dispatch — WITHOUT touching the engine core.
//? A role is a pure descriptor + a handler; it is workspace-action-scoped (invariant B-4: never
//? host/system-level) and its handler runs under `runInTenant` at the call site.
//?
//? Kept deliberately small + generic (framework code, SOLID): register at boot, look up by key,
//? list for the UI. The raw handler stays inside this registry; production callers invoke it through
//? `executeAgentRole`, which requires the matching Conductor writer + tenant context.

import { assertWorkspaceWriterContext } from '../orchestrator/writerContext';

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
  //? Does this role perform the authoritative ACTION that requires prior human approval? Then the
  //? executor gates it even if the trigger did not ask. `false` roles may still persist proposal or
  //? derived-result rows (findings, suggestions, watch snapshots) through the active Conductor; that
  //? bookkeeping is not consent to apply the proposed action (B-23).
  mutates: boolean;
  //? Run the role. Returns an artifact (rendered by the ArtifactViewer) or null. Best-effort — the
  //? executor wraps it in tryCatch, so a throwing plugin never breaks the trigger pipeline.
  run: (ctx: AgentRoleContext) => Promise<{ kind: string; title: string; body: string } | null>;
}

const roles = new Map<string, AgentRole>();

export type RegisteredAgentRole = Omit<AgentRole, 'run'>;

//? Register (or replace) an agent role. Called once per role at boot from the server overlay.
export function registerAgentRole(role: AgentRole): void {
  roles.set(role.key, role);
}

//? Metadata only: raw mutation-capable role callbacks are not exposed to arbitrary workers.
export function getAgentRole(key: string): RegisteredAgentRole | undefined {
  const role = roles.get(key);
  return role
    ? { key: role.key, label: role.label, description: role.description, mutates: role.mutates }
    : undefined;
}

export function executeAgentRole(key: string, ctx: AgentRoleContext): ReturnType<AgentRole['run']> {
  assertWorkspaceWriterContext(ctx.workspaceId);
  const role = roles.get(key);
  return role ? role.run(ctx) : Promise.resolve(null);
}

//? All registered roles (for the trigger editor's role picker + the ArtifactViewer legend).
export function listAgentRoles(): { key: string; label: string; description: string; mutates: boolean }[] {
  return [...roles.values()].map((r) => ({ key: r.key, label: r.label, description: r.description, mutates: r.mutates }));
}

//? Test/boot helper — clear the registry (used by unit tests to isolate).
export function resetAgentRoles(): void {
  roles.clear();
}
