//? Workspaces — [time-travel-preview] (T3) run a ticket's app at a RESOLVED time-travel ref: a raw commit, a
//? "main minus commit X" revert, or "as of timestamp T". Resolves the spec (git-only, no authoritative write) →
//? then opens the T1 ephemeral ref-preview. A direct `_api` op (slow container/dev-server boot must not block the
//? serial writer), `workTickets`-gated. The Assistant PROPOSES a spec in chat; the user accepts → this op runs
//? (single-writer intact — this only reads git / makes a throwaway synthetic ref + a preview container).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { resolveRefSpec, bareMirrorDir, type RefSpec } from '../../../server/git/timeTravel';
import { openRefPreview } from '../../../server/container/refPreview';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketKey: string; branch: string; spec: RefSpec };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketKey, branch, spec } = data;
  //? `validation: 'relaxed'` → the input is untrusted; validate the spec's shape (the RefSpec type is not a runtime guarantee).
  const kind = (spec as { kind?: unknown } | null)?.kind;
  if (!workspaceId || !ticketKey || !branch || (kind !== 'commit' && kind !== 'revert' && kind !== 'asof')) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  //? Resolve the time-travel spec → a concrete ref (or a typed conflict/error the client surfaces + can offer AI help on).
  const resolved = await resolveRefSpec(bareMirrorDir(workspaceId), branch, spec);
  if (!resolved.ok || !resolved.ref) {
    return { status: 'success', result: { ok: false, conflict: resolved.conflict === true, error: resolved.error ?? 'ref.unresolved' } };
  }
  const preview = await openRefPreview(workspaceId, ticketKey, resolved.ref);
  return { status: 'success', result: { ...preview, ref: resolved.ref } };
};
