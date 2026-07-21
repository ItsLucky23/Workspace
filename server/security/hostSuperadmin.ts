//? Host-control-plane identity. This is deliberately independent from WorkspaceMember/WorkspaceRole:
//? a workspace owner/admin has zero host authority, while a host superadmin still needs ordinary membership
//? for tenant actions. The framework-global User.admin flag is the persisted host role; self-host operators
//? may bootstrap/recover it with a root-owned WS_SUPERADMIN_EMAILS allowlist.

export interface HostSuperadminIdentity {
  admin?: boolean | null;
  email?: string | null;
}

function configuredSuperadminEmails(value: string | undefined = process.env.WS_SUPERADMIN_EMAILS): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0 && email.includes('@')),
  );
}

export function isHostSuperadmin(
  identity: HostSuperadminIdentity | null | undefined,
  configuredEmails?: string,
): boolean {
  if (!identity) return false;
  if (identity.admin === true) return true;
  const email = identity.email?.trim().toLowerCase();
  return email !== undefined && configuredSuperadminEmails(configuredEmails).has(email);
}

export function assertHostSuperadmin(
  identity: HostSuperadminIdentity | null | undefined,
  configuredEmails?: string,
): void {
  if (!isHostSuperadmin(identity, configuredEmails)) throw new Error('host.superadminRequired');
}
