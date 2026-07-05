//? Studio ⇄ AgentRole bridge (#2). Registers the DESIGNER and MARKETER as pluggable agent roles so
//? they show up in the automation role-picker (`listAgentRoles`) and a WorkspaceTrigger can
//? auto-generate a studio artifact (`invoke-agent-role` with params `{ briefId, kind }`). Non-coding
//? + workspace-scoped (invariant B-4). Call `registerStudioRoles()` once at boot.

import { getPrismaClient } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { generateArtifact, KIND_META, type ArtifactKind, type StudioRole } from './generate';

const KINDS_FOR: Record<StudioRole, ArtifactKind[]> = {
  designer: ['landing', 'brand'],
  marketer: ['copy', 'strategy'],
};

function makeRole(role: StudioRole, label: string, description: string): void {
  registerAgentRole({
    key: `studio-${role}`, label, description, mutates: true, //? writes a StudioArtifact → gate behind approval
    run: async (ctx) => {
      const briefId = typeof ctx.params.briefId === 'string' ? ctx.params.briefId : '';
      const kindRaw = typeof ctx.params.kind === 'string' ? ctx.params.kind : '';
      const kind = (KINDS_FOR[role] as string[]).includes(kindRaw) ? (kindRaw as ArtifactKind) : KINDS_FOR[role][0];
      if (!briefId || !kind) return { kind: 'studio', title: label, body: 'No brief specified — open the Studio to generate.' };
      const res = await generateArtifact(getPrismaClient(), { workspaceId: ctx.workspaceId, briefId, kind });
      return { kind: 'studio', title: `${KIND_META[kind].title} generated`, body: res.ok ? `A new ${kind} artifact is ready in the Studio.` : `Generation failed: ${res.error ?? 'unknown'}` };
    },
  });
}

export function registerStudioRoles(): void {
  makeRole('designer', 'Studio Designer', 'Generates landing pages + brand kits from a product brief.');
  makeRole('marketer', 'Studio Marketer', 'Generates marketing copy + go-to-market strategy from a product brief.');
}
