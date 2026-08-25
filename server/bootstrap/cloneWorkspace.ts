//? GAP_SCAN G2 — workspace cloning.
//?
//? Documented as D9 with zero implementation: every new workspace started from nothing, so a user who had
//? tuned their pipeline, skills, sources, channels and triggers had to redo all of it by hand to run a
//? second project the same way. This deep-duplicates the CONFIGURATION of a workspace into a fresh one.
//?
//? What is copied is deliberate: the setup a user built. What is NOT copied is anything that would be a
//? lie or a leak in the new workspace —
//?   • tickets / content pieces / assets / deploys / metrics  (that is the SOURCE's history, not yours)
//?   • OAuth tokens + platform credentials + env secrets      (a clone must never inherit credentials)
//?   • members + invites                                      (the cloner is the owner of the copy)
//?   • audit + budget spend                                   (a new workspace starts at zero)

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { jsonInput } from '../util/json';
import { createBlankWorkspace } from './seedWorkspace';
import { isPipelinePreset, type PipelinePreset } from './defaultPipeline';

export interface CloneResult { ok: boolean; workspaceId?: string; copied: Record<string, number>; error?: string }

//? The env keys a clone must never carry: OAuth tokens, connection health, and the platform app
//? credentials. They are namespaced with `__`, which is exactly what makes this checkable.
const SECRET_PREFIXES = ['__publish', '__platformcred_', '__provider_key_'];
const isSecretKey = (key: string): boolean => SECRET_PREFIXES.some((p) => key.startsWith(p));

export async function cloneWorkspace(
  prisma: PrismaClient, sourceWorkspaceId: string, ownerId: string, name: string,
): Promise<CloneResult> {
  const source = await prisma.workspace.findUnique({ where: { id: sourceWorkspaceId }, select: { enabledSections: true, presetKey: true, aiInstruction: true, gitConfig: true, autonomyLevel: true, productContext: true } });
  if (!source) return { ok: false, copied: {}, error: 'workspace.notFound' };

  //? Start from the normal creation path so a clone is a fully-formed workspace (roles, budget row, owner
  //? membership, a project) — then REPLACE the seeded pipeline with the source's tuned one.
  const preset: PipelinePreset = isPipelinePreset(source.presetKey) ? source.presetKey : 'professional';
  const created = await createBlankWorkspace(prisma, ownerId, name, source.enabledSections, preset);
  const workspaceId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  if (!project) return { ok: false, copied: {}, error: 'clone.noProject' };

  const copied: Record<string, number> = {};

  //? Workspace-level settings the user tuned (never credentials).
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(source.aiInstruction ? { aiInstruction: source.aiInstruction } : {}),
      ...(source.gitConfig === null ? {} : { gitConfig: source.gitConfig }),
      ...(source.autonomyLevel ? { autonomyLevel: source.autonomyLevel } : {}),
      ...(source.productContext ? { productContext: source.productContext } : {}),
    },
  });

  //? Pipeline: the SOURCE's stages replace the seeded ones wholesale, so a cloned board is identical.
  const [, stages] = await tryCatch(() => prisma.pipelineStage.findMany({ where: { workspaceId: sourceWorkspaceId }, orderBy: { order: 'asc' } }));
  if (stages && stages.length > 0) {
    await prisma.pipelineStage.deleteMany({ where: { workspaceId, projectId: project.id } });
    for (const st of stages) {
      //? Json columns come back as `JsonValue` (nullable), which Prisma's CREATE input refuses — round-trip
      //? them through `jsonInput` instead of casting (Rule 21).
      await prisma.pipelineStage.create({
        data: {
          workspaceId, projectId: project.id,
          key: st.key, kind: st.kind, name: st.name, order: st.order, aiEnabled: st.aiEnabled,
          wipLimit: st.wipLimit, systemPrompt: st.systemPrompt,
          customInstructions: st.customInstructions, handoverPrompt: st.handoverPrompt, definitionOfDone: st.definitionOfDone,
          sourceIds: st.sourceIds, visibleStageIds: st.visibleStageIds,
          //? These are typed COMPOSITE columns (not free-form Json), so the read-back values are already
          //? the right shape — copying them verbatim is what keeps a cloned stage byte-identical.
          commands: st.commands, tools: st.tools, statuses: st.statuses,
          processes: st.processes, modelCfg: st.modelCfg,
          //? `hooks` IS a free-form Json column — round-trip it so a null degrades to an empty object.
          hooks: jsonInput(st.hooks ?? {}),
        },
      });
    }
    copied.stages = stages.length;
  }

  //? Skills (the AI instruction blocks) — the single most-tuned thing in a mature workspace.
  const [, skills] = await tryCatch(() => prisma.skill.findMany({ where: { workspaceId: sourceWorkspaceId } }));
  for (const sk of skills ?? []) {
    await prisma.skill.create({
      data: { workspaceId, slug: sk.slug, name: sk.name, instruction: sk.instruction, examples: sk.examples, applyPoints: sk.applyPoints, enabled: sk.enabled, builtin: sk.builtin },
    });
  }
  copied.skills = (skills ?? []).length;

  //? Style presets + reference examples: the house look, reusable across projects by definition.
  const [, styles] = await tryCatch(() => prisma.stylePreset.findMany({ where: { workspaceId: sourceWorkspaceId } }));
  for (const st of styles ?? []) {
    await prisma.stylePreset.create({
      data: { workspaceId, key: st.key, label: st.label, feature: st.feature, builtin: st.builtin, systemPrompt: st.systemPrompt, previewAssetUrl: st.previewAssetUrl, previewKind: st.previewKind },
    });
  }
  copied.styles = (styles ?? []).length;

  const [, refs] = await tryCatch(() => prisma.referenceExample.findMany({ where: { workspaceId: sourceWorkspaceId } }));
  for (const r of refs ?? []) {
    await prisma.referenceExample.create({
      data: { workspaceId, kind: r.kind, title: r.title, description: r.description, assetUrl: r.assetUrl, tags: r.tags },
    });
  }
  copied.references = (refs ?? []).length;

  //? Channels: the CONFIG (name, platform, voice, disclosure default) — never the connected account, and
  //? never autopilot. A clone that inherited "post automatically" would publish from a workspace the user
  //? has not finished setting up.
  const [, channels] = await tryCatch(() => prisma.channel.findMany({ where: { workspaceId: sourceWorkspaceId } }));
  for (const ch of channels ?? []) {
    await prisma.channel.create({
      data: {
        workspaceId, projectId: project.id, name: ch.name, platform: ch.platform,
        ...(ch.handle ? { handle: ch.handle } : {}), ...(ch.description ? { description: ch.description } : {}),
        ...(ch.brandVoice ? { brandVoice: ch.brandVoice } : {}),
        aiDisclosureDefault: ch.aiDisclosureDefault,
        autopilot: false, defaultAccountId: null,
      },
    });
  }
  copied.channels = (channels ?? []).length;

  //? Automation triggers, copied DISABLED: a clone must not start firing crons the moment it exists.
  const [, triggers] = await tryCatch(() => prisma.workspaceTrigger.findMany({ where: { workspaceId: sourceWorkspaceId } }));
  for (const tr of triggers ?? []) {
    await prisma.workspaceTrigger.create({
      data: {
        workspaceId, name: tr.name, on: tr.on, action: tr.action,
        match: jsonInput(tr.match), params: jsonInput(tr.params),
        cron: tr.cron, requiresApproval: tr.requiresApproval, dedupeKey: tr.dedupeKey, debounceMs: tr.debounceMs,
        //? Copied DISABLED — a clone must not start firing crons the moment it exists.
        enabled: false,
      },
    });
  }
  copied.triggers = (triggers ?? []).length;

  //? Custom AI tasks — user-authored prompts, pure config.
  const [, tasks] = await tryCatch(() => prisma.customAiTask.findMany({ where: { workspaceId: sourceWorkspaceId } }));
  for (const t of tasks ?? []) {
    await prisma.customAiTask.create({
      data: { workspaceId, name: t.name, promptTemplate: t.promptTemplate },
    });
  }
  copied.customTasks = (tasks ?? []).length;

  //? Non-secret env vars only. The secret ones are exactly what a clone must re-enter by hand.
  const [, envs] = await tryCatch(() => prisma.envVar.findMany({ where: { workspaceId: sourceWorkspaceId } }));
  let envCount = 0;
  for (const e of envs ?? []) {
    if (e.secret || isSecretKey(e.key)) continue;
    await prisma.envVar.create({ data: { workspaceId, key: e.key, value: e.value, secret: false } });
    envCount += 1;
  }
  copied.envVars = envCount;

  return { ok: true, workspaceId, copied };
}
