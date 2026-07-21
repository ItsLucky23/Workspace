# Durable global jobs and entity CAS

<!-- @covers server/orchestrator/globalOps.ts server/orchestrator/entityVersion.ts prisma/schema.prisma -->

## Global write path

Account/global routes validate and authorize, then enqueue one member of the closed `GlobalAction` union. They never pass a write callback.

```text
route → validate → encrypt action → GlobalJob(pending)
      → renewable global Redis lease → global writer context
      → typed idempotent effect → GlobalJob(completed)
```

`GlobalJob.payloadEnc` is AES-256-GCM data under `WORKSPACES_ENC_KEY`. Kind/user/status are searchable; Push keys, import bundles and account fields are not plaintext queue metadata. A canonical action hash provides both the deterministic Mongo ID and dedup key.

Supported jobs:

- account update/preferences/delete;
- SSH-key add/remove;
- Web Push save/remove;
- PAT revoke;
- workspace import.

`runGlobalJobRecovery` reclaims pending or stale-running jobs after 30 seconds, with at most five attempts. The cron cadence is `WS_GLOBAL_JOB_RECOVERY_MIN` (default one minute). Login-only global control actions use the same `global` lease, so the single-writer property also holds across app instances.

Session tokens are deliberately absent. Mongo user state is authoritative; a route refreshes its current derived session after the durable job succeeds.

Workspace imports derive a stable target workspace ID from owner+bundle. `Workspace.importCompleted` is the final marker. Recovery deletes only a deterministic partial import and rebuilds it; a completed retry returns the existing workspace.

## Workspace entity CAS

`WorkspaceEntityVersion(workspaceId, entityKey)` fences completions that began before slow provider, Docker or filesystem work. A completion carries `expectedVersion`; the Conductor:

1. reads the current entity version;
2. rejects a mismatch as `write.superseded`;
3. performs the idempotent mutation;
4. atomically advances the version and records request/content identity.

Current keys cover generated project docs/images, brand library, style presets, per-project Dockerfiles and exact ticket worktree files. These InternalOps are therefore included in bounded crash replay. An older completion can repeat its same bytes/upserts after a crash, but cannot overwrite a later version.

## Canonical model boundaries

- `Skill` is canonical for both `instruction` and `capability` skill types.
- `InfoSource` contains context/document sources, not skills.
- `Document` → source; `DocumentRevision` → history; `RagEntry` → rebuildable derived index.
- `StudioBrandLibrary` → brand identity; `StylePreset` → feature-specific generation style.
- Artifact models keep domain-specific lifecycles and converge through ticket links/context projections rather than a mega-table.

## Operator commands

```bash
npm run db:backup
npm run prisma:db:push
npm run db:upgrade
```

`db:backup` writes a Mongo dump, media/repository archives where present, SHA-256 checksums and an encryption-key fingerprint. `db:upgrade` prints pre/post counts and fails when the skill consolidation invariants do not hold.
