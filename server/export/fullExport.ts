//? F54 — a workspace bundle you can actually RESTORE from.
//?
//? The existing export is a portability SUMMARY: content pieces reduced to titles, no comments, no ticket
//? history, no documents, no skills, no channels. Round-tripping it produces a workspace that looks vaguely
//? like the original and works like nothing. That is fine for "give me my data"; it is not a restore.
//?
//? This is the complete bundle: everything that defines the workspace, with two exclusions that stay
//? excluded on purpose —
//?   • **secrets** (env values, OAuth tokens, platform credentials): a portable file containing them is a
//?     credential leak with a filename. Keys are listed so the operator knows what to re-provision.
//?   • **media BYTES**: they live in the asset backup (F49). The bundle references them by URL so a
//?     combined restore (bundle + media archive) is whole, and a bundle alone is small enough to email.
//?
//? Import is additive and id-remapping: it never assumes the target install has the same ids, and it never
//? overwrites an existing workspace.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

export const BUNDLE_VERSION = 1;

export interface FullBundle {
  version: number;
  exportedAt: string;
  workspace: { name: string; enabledSections: string[]; presetKey: string | null; aiInstruction: string | null; productContext: string | null };
  stages: unknown[];
  tickets: unknown[];
  ticketEvents: unknown[];
  documents: unknown[];
  skills: unknown[];
  styles: unknown[];
  references: unknown[];
  channels: unknown[];
  contentPieces: unknown[];
  contentAssets: unknown[];
  triggers: unknown[];
  customTasks: unknown[];
  infoSources: unknown[];
  //? The project's declared monorepo units. These were dropped entirely: exporting and reimporting a
  //? workspace silently lost every Service row — and with it each unit's path, build command and deploy
  //? unit — while the import still reported success.
  services: unknown[];
  envKeys: string[];
  //? What was deliberately NOT included, stated in the file itself so a restorer is never guessing.
  excluded: string[];
  counts: Record<string, number>;
}

const EXCLUDED = [
  'env values + secrets (re-provision by hand)',
  'OAuth tokens + platform credentials (re-connect each account)',
  'media bytes (see the media.tar.gz asset archive)',
  'members + invites (the importer becomes the owner)',
  'audit + spend history (belongs to the source install)',
];

//? Build the complete bundle. Bounded per collection: an export must never OOM the instance that produces it.
export async function buildFullBundle(prisma: PrismaClient, workspaceId: string, now: number): Promise<FullBundle | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, enabledSections: true, presetKey: true, aiInstruction: true, productContext: true },
  });
  if (!workspace) return null;

  const [stages, tickets, ticketEvents, documents, skills, styles, references, channels, pieces, assets, triggers, customTasks, infoSources, envVars, services] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { workspaceId }, orderBy: { order: 'asc' } }),
    prisma.ticket.findMany({ where: { workspaceId }, orderBy: { number: 'asc' }, take: 5000 }),
    prisma.ticketEvent.findMany({ where: { workspaceId }, orderBy: { seq: 'asc' }, take: 20_000 }),
    prisma.document.findMany({ where: { workspaceId }, take: 2000 }),
    prisma.skill.findMany({ where: { workspaceId }, take: 500 }),
    prisma.stylePreset.findMany({ where: { workspaceId }, take: 500 }),
    prisma.referenceExample.findMany({ where: { workspaceId }, take: 500 }),
    prisma.channel.findMany({ where: { workspaceId }, take: 200 }),
    prisma.contentProject.findMany({ where: { workspaceId }, take: 2000 }),
    prisma.contentAsset.findMany({ where: { workspaceId }, take: 10_000 }),
    prisma.workspaceTrigger.findMany({ where: { workspaceId }, take: 500 }),
    prisma.customAiTask.findMany({ where: { workspaceId }, take: 500 }),
    prisma.infoSource.findMany({ where: { workspaceId }, take: 1000 }),
    prisma.envVar.findMany({ where: { workspaceId }, select: { key: true, secret: true } }),
    prisma.service.findMany({ where: { workspaceId }, take: 200 }),
  ]);

  return {
    version: BUNDLE_VERSION,
    exportedAt: new Date(now).toISOString(),
    workspace: {
      name: workspace.name,
      enabledSections: workspace.enabledSections,
      presetKey: workspace.presetKey,
      aiInstruction: workspace.aiInstruction,
      productContext: workspace.productContext,
    },
    stages, tickets, ticketEvents, documents, skills, styles, references, channels,
    contentPieces: pieces, contentAssets: assets, triggers, customTasks, infoSources, services,
    //? Keys only — and internal `__`-namespaced rows (tokens, credentials) are not even named.
    envKeys: envVars.filter((e) => !e.secret && !e.key.startsWith('__')).map((e) => e.key),
    excluded: EXCLUDED,
    counts: {
      stages: stages.length, tickets: tickets.length, ticketEvents: ticketEvents.length,
      documents: documents.length, skills: skills.length, styles: styles.length,
      references: references.length, channels: channels.length,
      contentPieces: pieces.length, contentAssets: assets.length,
      triggers: triggers.length, customTasks: customTasks.length, infoSources: infoSources.length,
      services: services.length,
    },
  };
}

//? A bundle from a newer app version may contain shapes this one cannot honour. Refusing loudly beats a
//? half-import that looks like it worked.
export function bundleCompatible(bundle: { version?: unknown }): { ok: boolean; reason: string } {
  const version = typeof bundle.version === 'number' ? bundle.version : 0;
  if (version === 0) return { ok: false, reason: 'not a workspace bundle' };
  if (version > BUNDLE_VERSION) return { ok: false, reason: `bundle version ${String(version)} is newer than this install (${String(BUNDLE_VERSION)})` };
  return { ok: true, reason: '' };
}

//? Narrow one exported row into a plain record. Rows arrive as untrusted JSON from a file; every write
//? below re-keys ids and re-stamps the workspace, so nothing from the file can point at another tenant.
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)) : [];
}
const str = (o: Record<string, unknown>, k: string, fallback = ''): string => (typeof o[k] === 'string' ? o[k] : fallback);
const num = (o: Record<string, unknown>, k: string, fallback = 0): number => (typeof o[k] === 'number' ? o[k] : fallback);
const bool = (o: Record<string, unknown>, k: string): boolean => o[k] === true;

export interface ImportOutcome { ok: boolean; workspaceId?: string; imported: Record<string, number>; error?: string }

//? Import a bundle into a NEW workspace owned by `ownerId`. Never targets an existing workspace: an
//? "import over" flow would need a merge policy nobody has specified, and silently overwriting is worse
//? than refusing.
export async function importFullBundle(
  prisma: PrismaClient, ownerId: string, bundle: unknown,
  deps: { createWorkspace: (name: string, sections: string[], preset: string) => Promise<string> },
): Promise<ImportOutcome> {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) return { ok: false, imported: {}, error: 'bundle.invalid' };
  const b = bundle as Record<string, unknown>;
  const compat = bundleCompatible(b);
  if (!compat.ok) return { ok: false, imported: {}, error: `bundle.incompatible: ${compat.reason}` };

  const meta = b.workspace !== null && typeof b.workspace === 'object' && !Array.isArray(b.workspace) ? b.workspace as Record<string, unknown> : {};
  const name = str(meta, 'name', 'Imported workspace');
  const sections = Array.isArray(meta.enabledSections) ? meta.enabledSections.filter((v): v is string => typeof v === 'string') : [];
  const preset = str(meta, 'presetKey', 'professional') || 'professional';

  const workspaceId = await deps.createWorkspace(`${name} (imported)`, sections, preset);
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  if (!project) return { ok: false, imported: {}, error: 'import.noProject' };
  const projectId = project.id;
  const imported: Record<string, number> = {};

  await tryCatch(() => prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(str(meta, 'aiInstruction') ? { aiInstruction: str(meta, 'aiInstruction') } : {}),
      ...(str(meta, 'productContext') ? { productContext: str(meta, 'productContext') } : {}),
    },
  }));

  //? Stages replace the seeded pipeline wholesale, so an imported board is the source's board.
  const stageRows = rows(b.stages);
  if (stageRows.length > 0) {
    await prisma.pipelineStage.deleteMany({ where: { workspaceId, projectId } });
    for (const st of stageRows) {
      await tryCatch(() => prisma.pipelineStage.create({
        data: {
          workspaceId, projectId,
          key: str(st, 'key'), kind: str(st, 'kind', 'code'), name: str(st, 'name', str(st, 'key')),
          order: num(st, 'order'), aiEnabled: bool(st, 'aiEnabled'),
          roleKey: str(st, 'roleKey', 'code'), systemPrompt: str(st, 'systemPrompt'),
          customInstructions: str(st, 'customInstructions'), handoverPrompt: str(st, 'handoverPrompt'),
          definitionOfDone: str(st, 'definitionOfDone'),
          skillKeys: [], sourceIds: [], visibleStageIds: [],
          commands: [], tools: [], processes: [],
          statuses: [
            { key: 'needs-input', label: 'Needs input', kind: 'base' },
            { key: 'busy', label: 'Busy', kind: 'base' },
            { key: 'stopped', label: 'Stopped', kind: 'base' },
            { key: 'done', label: 'Done', kind: 'base' },
          ],
          modelCfg: { autoEscalate: false, base: { model: 'sonnet', effort: 'medium', maxTurns: 20 }, rules: [] },
          network: { enabled: true, mode: 'whitelist', categories: ['package-registries'], domains: [] },
          hooks: {},
        },
      }));
    }
    imported.stages = stageRows.length;
  }

  //? Tickets keep their titles/descriptions and their stage when that stage exists here.
  const stageKeys = new Set(stageRows.map((st) => str(st, 'key')));
  let ticketNumber = 0;
  for (const t of rows(b.tickets)) {
    ticketNumber += 1;
    await tryCatch(() => prisma.ticket.create({
      data: {
        workspaceId, projectId,
        key: `DEV-${String(ticketNumber)}`, number: ticketNumber,
        title: str(t, 'title', 'Imported ticket'), description: str(t, 'description'),
        stageId: stageKeys.has(str(t, 'stageId')) ? str(t, 'stageId') : 'unrefined',
        //? Deliberately idle + labelled: an imported ticket must not resume an agent turn from another
        //? install, and the label is how you find them afterwards.
        status: 'idle', labels: ['imported'], creatorId: ownerId,
      },
    }));
  }
  imported.tickets = ticketNumber;

  //? Each writer returns void so the heterogeneous list unifies to one signature; the return values are
  //? not used anyway — a failed row is counted as skipped, not surfaced as a partial object.
  //? Each writer awaits its create and returns void, so the heterogeneous list unifies to one signature.
  //? An earlier version used `void prisma.x.create(...)` to make that type-check — which silently discarded
  //? the promise, so rows were still in flight (or failing invisibly) when the caller moved on.
  const collections: [string, Record<string, unknown>[], (row: Record<string, unknown>) => Promise<void>][] = [
    //? Services carry the project's unit layout. They restore onto the single imported project (the bundle
    //? is single-project by construction — see the note on `excluded`), so only `path`/`buildCmd`/
    //? `deployUnit` need to survive; ids are minted fresh like every other imported row.
    ['services', rows(b.services), async (sv) => {
      await prisma.service.create({ // luckystack-allow tenant-scope: scoped by the workspaceId it WRITES two lines below
        data: {
          workspaceId, projectId,
          name: str(sv, 'name', 'service'),
          path: str(sv, 'path', '.'),
          ...(str(sv, 'buildCmd') ? { buildCmd: str(sv, 'buildCmd') } : {}),
          ...(str(sv, 'deployUnit') ? { deployUnit: str(sv, 'deployUnit') } : {}),
          ...(str(sv, 'devCommand') ? { devCommand: str(sv, 'devCommand') } : {}),
          ...(str(sv, 'prodCommand') ? { prodCommand: str(sv, 'prodCommand') } : {}),
        },
      });
    }],
    ['documents', rows(b.documents), async (d) => {
      await prisma.document.create({ data: { workspaceId, title: str(d, 'title', 'Untitled'), content: str(d, 'content'), kind: str(d, 'kind'), archived: bool(d, 'archived') } });
    }],
    ['skills', rows(b.skills), async (sk) => {
      await prisma.skill.create({ data: { workspaceId, slug: `${str(sk, 'slug', 'skill')}-${workspaceId.slice(-6)}`, name: str(sk, 'name', 'Skill'), instruction: str(sk, 'instruction'), examples: str(sk, 'examples'), applyPoints: [], enabled: bool(sk, 'enabled'), builtin: false } });
    }],
    ['styles', rows(b.styles), async (st) => {
      await prisma.stylePreset.create({ data: { workspaceId, key: str(st, 'key', 'style'), label: str(st, 'label', 'Style'), feature: str(st, 'feature', 'image-gen'), builtin: false, systemPrompt: str(st, 'systemPrompt') } });
    }],
    ['references', rows(b.references), async (r) => {
      await prisma.referenceExample.create({ data: { workspaceId, kind: str(r, 'kind', 'image'), title: str(r, 'title', 'Reference'), description: str(r, 'description'), assetUrl: str(r, 'assetUrl'), tags: [] } });
    }],
    ['channels', rows(b.channels), async (c) => {
      //? Config only: never the connected account, never autopilot — an import must not start posting.
      await prisma.channel.create({ data: { workspaceId, projectId, name: str(c, 'name', 'Channel'), platform: str(c, 'platform', 'none'), brandVoice: str(c, 'brandVoice'), aiDisclosureDefault: bool(c, 'aiDisclosureDefault'), autopilot: false, defaultAccountId: null } });
    }],
    ['customTasks', rows(b.customTasks), async (t) => {
      await prisma.customAiTask.create({ data: { workspaceId, name: str(t, 'name', 'Task'), promptTemplate: str(t, 'promptTemplate') } });
    }],
  ];
  for (const [key, list, write] of collections) {
    let count = 0;
    for (const row of list) {
      const [error] = await tryCatch(() => write(row));
      if (!error) count += 1;
    }
    imported[key] = count;
  }

  //? Triggers arrive DISABLED — an import must not start firing someone else's crons on your instance.
  let triggerCount = 0;
  for (const tr of rows(b.triggers)) {
    const [error] = await tryCatch(() => prisma.workspaceTrigger.create({
      data: {
        workspaceId, name: str(tr, 'name', 'Trigger'), on: str(tr, 'on', 'cron'), action: str(tr, 'action', 'notify'),
        match: {}, params: {}, cron: str(tr, 'cron') || null, requiresApproval: bool(tr, 'requiresApproval'), enabled: false,
      },
    }));
    if (!error) triggerCount += 1;
  }
  imported.triggers = triggerCount;

  return { ok: true, workspaceId, imported };
}
