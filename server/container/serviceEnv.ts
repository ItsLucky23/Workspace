//? K3 — inject the workspace's env (connection strings for its K1/K2 services + any BYO EnvVars) into the agent +
//? preview containers, and put those containers on the per-workspace service network so a service is reachable by
//? name. `07b §6.3` designed this but nothing implemented it — the audit found even the BYO-URL path was broken
//? end-to-end (the app never saw the creds). Pure arg-builders + a decrypting resolver; the launch path threads
//? them in. Secrets are decrypted only to hand to the container's own env (the app needs them), never logged.

import type { PrismaClient } from '@prisma/client';

import { decryptSecret } from '../crypto/secretBox';

//? A `docker run`-safe env pair: skip empty keys + keys with `=`/whitespace (invalid env names). Value passed
//? verbatim via `-e KEY=VALUE` (docker does not re-interpret it).
export function serviceEnvArgs(env: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (key.trim().length === 0 || /[\s=]/.test(key)) continue;
    args.push('-e', `${key}=${value}`);
  }
  return args;
}

//? Resolve the workspace's EnvVars into a plain key→value map (decrypting the `secret` ones). A value that fails
//? to decrypt is skipped (never a partial/garbage env). Tenant-scoped by `workspaceId`.
export async function resolveWorkspaceEnv(prisma: PrismaClient, workspaceId: string): Promise<Record<string, string>> {
  const rows = await prisma.envVar.findMany({ where: { workspaceId }, select: { key: true, value: true, secret: true } });
  const out: Record<string, string> = {};
  for (const row of rows) {
    //? Skip empty keys + the INTERNAL `__`-namespace (publish tokens, provider keys, per-feature overrides) —
    //? those are orchestrator state, never the user's app env; injecting them would leak secrets into the container.
    if (row.key.trim().length === 0 || row.key.startsWith('__')) continue;
    const value = row.secret ? decryptSecret(row.value) : row.value;
    if (value !== null) out[row.key] = value;
  }
  return out;
}
