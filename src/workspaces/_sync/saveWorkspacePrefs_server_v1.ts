//? Workspaces — [save-workspace-prefs] REALTIME write via `_sync` (D55 + D31, owner 2026-08-26: "pricing
//? moet een UI krijgen, timezone moet overal gebruikt worden"). Persists the two workspace preferences that
//? had a reader but no write path: the IANA `timezone` every human-facing window is anchored to
//? (server/util/dateTz.ts) and the `pricing` map (€/1k tokens per model) merged over the defaults + env by
//? spend/record.priceFor. The Conductor is the single writer; the STORED values are broadcast back so every
//? client replaces them live. Requires the workspaceSettings capability (enforced by the control-op RBAC).
//?
//? Two shapes, one route: the settings UI sends the whole `pricing` map; the chat AI sends a single
//? `model` + `pricePer1k` pair, which the Conductor merges into the stored map.

/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { sanitizePriceMap } from '../../../server/spend/record';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { timezone?: string; pricing?: Record<string, number>; model?: string; pricePer1k?: number; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { timezone, pricing, model, pricePer1k, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'save-workspace-prefs', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: {
      ...(timezone === undefined ? {} : { timezone }),
      ...(pricing === undefined ? {} : { pricing }),
      ...(model === undefined ? {} : { model }),
      ...(pricePer1k === undefined ? {} : { pricePer1k }),
    },
    clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? Read the STORED values back rather than echoing the input: an invalid zone is rejected by the
  //? Conductor and a single-model merge only changes one key, so the input is not the new truth.
  const row = await functions.db.prisma.workspace.findUnique({ where: { id: roomCode }, select: { timezone: true, pricing: true } });
  return { status: 'success', timezone: row?.timezone ?? 'UTC', pricing: sanitizePriceMap(row?.pricing) };
};
