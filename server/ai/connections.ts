//? @adr 0325
//? ADR 0007 — the connected AIs as a LIST, and everything that follows from that.
//?
//? What this replaces: one configuration per provider, which could not express "two OpenAI models side
//? by side" and turned Claude Code into a status dot you could read but never connect or disconnect.
//?
//? Three rules the rest of the app depends on:
//?   1. The API KEY never leaves the server. Every read for the UI reports `hasKey`, never the value.
//?   2. The ENDPOINT is never a user setting. It resolves from the provider catalog, with an operator
//?      env override for a proxy or a self-hosted gateway — infrastructure, not a preference.
//?   3. Removing a connection must not leave a feature pointing at a backend that can no longer run.
//?      `reassignmentFor` is what the confirm dialog quotes, and `applyReassignment` is what makes it
//?      true; a dialog that promises a migration nothing performs is worse than no dialog.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { decryptSecret, encryptSecret } from '../crypto/secretBox';
import { AI_PROVIDER_CATALOG, isKnownAiProviderId, providerSurface } from './providers/catalog';
import type { AiProviderMeta, AiSurface } from './providers/catalog';
import { AI_OVERRIDE_PREFIX, parseAiOverride } from './workspaceAssignments';

export interface AiConnectionView {
  id: string;
  providerId: string;
  label: string;
  model: string;
  kind: 'subscription' | 'api-key';
  /** Which plane the backend serves (Fase 5.2) — the settings page groups on it. */
  surface: AiSurface;
  hasKey: boolean;
  verifiedAt: string | null;
  lastError: string | null;
}

const metaFor = (id: string): AiProviderMeta | undefined => AI_PROVIDER_CATALOG[id];

/** Everything the settings page may see. Deliberately not the key. */
export async function listConnections(workspaceId: string): Promise<AiConnectionView[]> {
  const prisma = getPrismaClient();
  const [, rows] = await tryCatch(() => prisma.aiConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }));
  return (rows ?? []).map((r) => ({
    id: r.id,
    providerId: r.providerId,
    //? A row whose provider left the catalog still renders, under its raw id: hiding it would leave a
    //? credential stored with no way to see or remove it.
    label: metaFor(r.providerId)?.label ?? r.providerId,
    model: r.model,
    kind: metaFor(r.providerId)?.kind ?? 'api-key',
    surface: providerSurface(r.providerId),
    hasKey: (r.apiKey ?? '').length > 0,
    verifiedAt: r.verifiedAt === null ? null : r.verifiedAt.toISOString(),
    lastError: r.lastError,
  }));
}

/** The credentials + model a provider should run with, from the FIRST connection that has them. */
export async function connectionFor(workspaceId: string | undefined, providerId: string): Promise<{ apiKey: string; model: string } | null> {
  if (workspaceId === undefined) return null;
  const prisma = getPrismaClient();
  const [, row] = await tryCatch(() => prisma.aiConnection.findFirst({ where: { workspaceId, providerId }, orderBy: { createdAt: 'asc' } }));
  if (!row) return null;
  const key = row.apiKey === null ? '' : (decryptSecret(row.apiKey) ?? '');
  return { apiKey: key.trim(), model: row.model.trim() };
}

export interface AddConnectionInput { workspaceId: string; providerId: string; model: string; apiKey: string }

export async function addConnection(input: AddConnectionInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  //? P4-3 — the same validation source as dispatch + the save op (catalog.knownAiProviderIds).
  if (!isKnownAiProviderId(input.providerId)) return { ok: false, error: 'ai.unknownProvider' };
  const meta = metaFor(input.providerId);
  if (meta === undefined) return { ok: false, error: 'ai.unknownProvider' };
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();

  //? A metered backend without a key is a row that can never run — it would sit in the list looking
  //? connected and fail at the first turn, which is the failure mode this whole page exists to remove.
  //? A local/self-hosted backend legitimately has no key (`keyUrl` empty), so the key requirement
  //? follows "is there anywhere to get one", not merely "is it metered".
  if (meta.kind === 'api-key' && meta.keyUrl.length > 0 && apiKey.length === 0) return { ok: false, error: 'ai.keyRequired' };
  //? A model is only a per-connection concept where the catalog offers models (text, and embedding's
  //? pinned model). A media backend has NO model on the connection — its model choice is per-feature
  //? (`__media_model_<feature>`) — so an empty model is its normal state, not an error.
  if (meta.kind === 'api-key' && model.length === 0 && meta.models.length > 0 && meta.surface === 'text') return { ok: false, error: 'ai.modelRequired' };
  const effectiveModel = model.length > 0 ? model : meta.defaultModel;

  const prisma = getPrismaClient();
  //? One connection per (provider, model): connecting the same model twice is a duplicate row that
  //? does nothing, and a delete would then only half-remove it.
  const existing = await prisma.aiConnection.findFirst({ where: { workspaceId: input.workspaceId, providerId: input.providerId, model: effectiveModel } });
  if (existing) {
    //? Re-adding with a new key is how a user rotates a credential — accept it as an update rather than
    //? refusing and leaving them to delete-then-add.
    if (apiKey.length > 0) await prisma.aiConnection.update({ where: { id: existing.id }, data: { apiKey: encryptSecret(apiKey), verifiedAt: null, lastError: null } });
    return { ok: true, id: existing.id };
  }
  const created = await prisma.aiConnection.create({
    data: {
      workspaceId: input.workspaceId, providerId: input.providerId, model: effectiveModel,
      ...(apiKey.length > 0 ? { apiKey: encryptSecret(apiKey) } : {}),
    },
  });
  return { ok: true, id: created.id };
}

//? F-001 — one-time migration of the DEAD legacy store. Content-settings → Admin used to offer a "Gemini"
//? key row that wrote EnvVar `__provider_key_gemini`; nothing in server/ai ever read it, so the key
//? "saved" while every text generation kept failing. The single owner is now this table. For every
//? workspace that has the legacy row and NO gemini-api connection, create one from it (the legacy row is
//? left in place — deleting secrets is not this migration's call). Idempotent; best-effort per workspace.
export async function migrateLegacyGeminiKeys(): Promise<number> {
  const prisma = getPrismaClient();
  const [, legacy] = await tryCatch(() => prisma.envVar.findMany({ where: { key: '__provider_key_gemini' }, select: { workspaceId: true, value: true } }));
  let created = 0;
  for (const row of legacy ?? []) {
    const [, existing] = await tryCatch(() => prisma.aiConnection.findFirst({ where: { workspaceId: row.workspaceId, providerId: 'gemini-api' }, select: { id: true } }));
    if (existing) continue;
    const apiKey = (decryptSecret(row.value) ?? '').trim();
    if (apiKey.length === 0) continue;
    const meta = metaFor('gemini-api');
    const [err, res] = await tryCatch(() => addConnection({ workspaceId: row.workspaceId, providerId: 'gemini-api', model: meta?.defaultModel ?? '', apiKey }));
    if (!err && res?.ok) created += 1;
  }
  return created;
}

//? Fase 5.2 — one-time migration of the media key store into THIS table (the single key store).
//? `__provider_key_<fal|elevenlabs|suno>` EnvVars were the content-settings KeysCard's store; the card
//? is gone and `loadWorkspaceMediaConfig` now reads AiConnection first (EnvVar stays as a runtime
//? fallback for a failed/partial migration — reading a secret is safer than losing one). For every
//? legacy row without a matching connection, create one; the legacy row is left in place (deleting
//? secrets is not this migration's call — same policy as the Gemini migration above). Idempotent.
export async function migrateLegacyMediaKeys(): Promise<number> {
  const prisma = getPrismaClient();
  const mediaIds = ['fal', 'elevenlabs', 'suno'];
  const [, legacy] = await tryCatch(() => prisma.envVar.findMany({ where: { key: { in: mediaIds.map((id) => `__provider_key_${id}`) } }, select: { workspaceId: true, key: true, value: true } }));
  let created = 0;
  for (const row of legacy ?? []) {
    const providerId = row.key.slice('__provider_key_'.length);
    const [, existing] = await tryCatch(() => prisma.aiConnection.findFirst({ where: { workspaceId: row.workspaceId, providerId }, select: { id: true } }));
    if (existing) continue;
    const apiKey = (decryptSecret(row.value) ?? '').trim();
    if (apiKey.length === 0) continue;
    const [err, res] = await tryCatch(() => addConnection({ workspaceId: row.workspaceId, providerId, model: '', apiKey }));
    if (!err && res?.ok) created += 1;
  }
  return created;
}

export interface Reassignment { feature: string; from: string; to: string | null }

//? What removing this connection would DO to the rest of the configuration — computed before the
//? delete so a confirm dialog can state it, and re-computed inside the delete so what it states is
//? what happens. A feature routed to a provider that is about to lose its last connection has to go
//? somewhere; `to: null` means nothing is left to move it to and it falls back to the global default.
export async function reassignmentFor(workspaceId: string, connectionId: string): Promise<Reassignment[]> {
  const prisma = getPrismaClient();
  const [, target] = await tryCatch(() => prisma.aiConnection.findFirst({ where: { workspaceId, id: connectionId } }));
  if (!target) return [];

  const remaining = await prisma.aiConnection.findMany({ where: { workspaceId, id: { not: connectionId } } });
  //? Only a provider that will still have a connection can receive work.
  const stillServed = new Set(remaining.map((r) => r.providerId));
  if (stillServed.has(target.providerId)) return [];

  const overrides = await prisma.envVar.findMany({ where: { workspaceId, key: { startsWith: AI_OVERRIDE_PREFIX } }, select: { key: true, value: true } });
  //? Fase 5.2 — a feature can only move to a backend on the SAME surface: removing the last
  //? embedding connection must not "reassign" the embedder to a text host.
  const surface = providerSurface(target.providerId);
  const fallback = remaining.find((r) => providerSurface(r.providerId) === surface)?.providerId ?? null;
  //? P4-2 — a stored value may be `providerId:model`; match on the PROVIDER part (includes the `_default` row).
  return overrides
    .filter((o) => parseAiOverride(o.value, surface)?.providerId === target.providerId)
    .map((o) => ({ feature: o.key.slice(AI_OVERRIDE_PREFIX.length), from: target.providerId, to: fallback }));
}

export async function removeConnection(workspaceId: string, connectionId: string): Promise<{ ok: boolean; moved: Reassignment[] }> {
  const prisma = getPrismaClient();
  //? Computed BEFORE the row is gone, applied after — the same list the dialog showed.
  const moved = await reassignmentFor(workspaceId, connectionId);
  const deleted = await prisma.aiConnection.deleteMany({ where: { workspaceId, id: connectionId } });
  if (deleted.count === 0) return { ok: false, moved: [] };

  for (const m of moved) {
    const key = `${AI_OVERRIDE_PREFIX}${m.feature}`;
    //? No remaining backend ⇒ CLEAR the override rather than pinning the feature to a provider that
    //? cannot run. Cleared means "use the global default", which is a working state; pinned means a
    //? feature that silently fails at dispatch.
    await (m.to === null
      ? prisma.envVar.deleteMany({ where: { workspaceId, key } })
      : prisma.envVar.upsert({ where: { workspaceId_key: { workspaceId, key } }, create: { workspaceId, key, value: m.to, secret: false }, update: { value: m.to } }));
  }
  return { ok: true, moved };
}

/** Record the outcome of a credential probe, so the list can show more than "a key is present". */
export async function recordTest(workspaceId: string, connectionId: string, ok: boolean, error: string | null): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.aiConnection.updateMany({
    where: { workspaceId, id: connectionId },
    data: ok ? { verifiedAt: new Date(), lastError: null } : { lastError: error ?? 'ai.testFailed' },
  });
}
