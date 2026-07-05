//? Studio generation service. Turns a StudioBrief into a generated artifact via the pluggable
//? AI-provider layer (`runAiCompletion` — ADR 0007), so which backend produces it is a per-feature
//? config choice, never hardcoded. Two roles: the DESIGNER (landing pages, brand kits) and the
//? MARKETER (copy/campaigns, strategy). Each artifact KIND has a prompt builder + a parser that
//? turns the model's text into the kind-specific structured `content` the Studio UI renders +
//? live-previews. Pure builders/parsers (unit-testable); the one impure step is the AI call + store.

import { Prisma, type PrismaClient } from '@prisma/client';

import { tryCatchSync } from '@luckystack/core';
import { runAiCompletion } from '../ai/registry';
import type { AiFeature } from '../ai/types';

//? Bridge a genuinely-JSON value to Prisma's Json WRITE type (read JsonValue vs write InputJsonValue).
const asJson = (v: unknown): Prisma.InputJsonValue => v ?? {};

export type ArtifactKind = 'landing' | 'copy' | 'brand' | 'strategy';
export type StudioRole = 'designer' | 'marketer';

//? Which role + provider-feature owns each kind.
export const KIND_META: Record<ArtifactKind, { role: StudioRole; feature: AiFeature; title: string }> = {
  landing: { role: 'designer', feature: 'studio-designer', title: 'Landing page' },
  brand: { role: 'designer', feature: 'studio-designer', title: 'Brand kit' },
  copy: { role: 'marketer', feature: 'studio-marketer', title: 'Marketing copy' },
  strategy: { role: 'marketer', feature: 'studio-marketer', title: 'Marketing strategy' },
};

export interface BriefInput { productName: string; audience: string; tone: string; goals: string; notes?: string | null }

const briefBlock = (b: BriefInput): string =>
  `PRODUCT: ${b.productName}\nAUDIENCE: ${b.audience}\nTONE / BRAND VOICE: ${b.tone}\nGOALS: ${b.goals}${b.notes ? `\nEXTRA CONTEXT: ${b.notes}` : ''}`;

//? Build the {system, prompt} for a kind. Pure — the prompts are the product; keep them explicit.
export function buildPrompt(kind: ArtifactKind, brief: BriefInput): { system: string; prompt: string } {
  const brf = briefBlock(brief);
  switch (kind) {
    case 'landing': {
      return {
        system: 'You are a world-class conversion-focused web designer + copywriter. You output a SINGLE self-contained, responsive HTML landing page: inline <style> only, NO external assets, fonts, scripts, or images (use CSS gradients/shapes + emoji instead). Modern, tasteful, accessible. Return ONLY the HTML in one ```html code block.',
        prompt: `Design a complete landing page for this product.\n\n${brf}\n\nInclude: a hero (headline, subhead, primary CTA), a 3-feature/benefit section, social-proof or stats, and a closing CTA + minimal footer. Make the copy specific to the product + audience + tone. Return one \`\`\`html block with the full page.`,
      };
    }
    case 'brand': {
      return {
        system: 'You are a senior brand designer. You output a brand kit as ONE ```json code block only, matching exactly: {"palette":[{"name":string,"hex":string}],"typography":{"heading":string,"body":string},"voice":string,"taglines":[string],"logoIdeas":[string]}. 4-6 palette colors with real hex values.',
        prompt: `Create a brand kit for this product.\n\n${brf}\n\nReturn one \`\`\`json block only.`,
      };
    }
    case 'copy': {
      return {
        system: 'You are an expert performance marketer + copywriter. You output marketing copy as ONE ```json code block only, matching exactly: {"sections":[{"channel":string,"items":[string]}]}. Cover these channels: "Headlines", "Social posts", "Google/Meta ads", "Email subject lines". 3-5 punchy items per channel.',
        prompt: `Write marketing copy for this product across channels.\n\n${brf}\n\nReturn one \`\`\`json block only.`,
      };
    }
    case 'strategy': {
      return {
        system: 'You are a go-to-market strategist. You output a concise, actionable marketing strategy as GitHub-flavored MARKDOWN (headings, bullets, a short table where useful). No preamble — start at the first heading.',
        prompt: `Write a go-to-market marketing strategy for this product.\n\n${brf}\n\nCover: positioning + one-line value prop, 2-3 audience personas, message hierarchy, the top 3-4 channels with why, a simple launch plan (phases), and 3-5 KPIs. Be specific to the product, not generic.`,
      };
    }
    default: {
      return { system: '', prompt: briefBlock(brief) };
    }
  }
}

//? Extract a fenced code block of a given language from the model text (falls back to the raw text).
function extractBlock(text: string, lang: string): string {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```');
  const m = re.exec(text);
  return (m?.[1] ?? '').trim();
}

//? Parse the model's text into the kind-specific `content` object. Never throws — returns a
//? best-effort shape (a raw fallback) so a slightly-off model response still yields something.
export function parseArtifact(kind: ArtifactKind, text: string): { content: Record<string, unknown>; title: string } {
  if (kind === 'landing') {
    const html = extractBlock(text, 'html') || text.trim();
    return { content: { html }, title: 'Landing page' };
  }
  if (kind === 'strategy') {
    return { content: { markdown: text.trim() }, title: 'Marketing strategy' };
  }
  //? brand + copy are JSON.
  const raw = extractBlock(text, 'json') || text.trim();
  const [, parsed] = tryCatchSync(() => JSON.parse(raw) as unknown);
  const obj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { raw };
  return { content: obj, title: KIND_META[kind].title };
}

export interface GenerateResult { ok: boolean; artifactId?: string; error?: string }

//? Generate an artifact for a brief: build the prompt, run the assigned provider, parse, and STORE a
//? StudioArtifact (status ready|error). Membership/RBAC is enforced at the route; this is the engine.
export async function generateArtifact(prisma: PrismaClient, input: { workspaceId: string; briefId: string; kind: ArtifactKind }): Promise<GenerateResult> {
  const brief = await prisma.studioBrief.findFirst({ where: { workspaceId: input.workspaceId, id: input.briefId } });
  if (!brief) return { ok: false, error: 'studio.briefNotFound' };
  const meta = KIND_META[input.kind];
  const { system, prompt } = buildPrompt(input.kind, brief);

  const completion = await runAiCompletion(meta.feature, { prompt, system, timeoutMs: 180_000 });
  if (!completion.ok || completion.text.trim().length === 0) {
    const failed = await prisma.studioArtifact.create({
      data: { workspaceId: input.workspaceId, briefId: input.briefId, kind: input.kind, role: meta.role, title: meta.title, content: {}, providerId: completion.providerId, status: 'error', error: completion.error ?? 'studio.emptyResponse' },
    });
    return { ok: false, artifactId: failed.id, error: completion.error ?? 'studio.emptyResponse' };
  }

  const { content, title } = parseArtifact(input.kind, completion.text);
  const artifact = await prisma.studioArtifact.create({
    data: { workspaceId: input.workspaceId, briefId: input.briefId, kind: input.kind, role: meta.role, title: `${title} — ${brief.productName}`, content: asJson(content), providerId: completion.providerId, status: 'ready' },
  });
  return { ok: true, artifactId: artifact.id };
}
