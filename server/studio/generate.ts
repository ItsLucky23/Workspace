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
import { broadcastContentDirty } from '../read/broadcast';

//? Bridge a genuinely-JSON value to Prisma's Json WRITE type (read JsonValue vs write InputJsonValue).
const asJson = (v: unknown): Prisma.InputJsonValue => v ?? {};

//? The artifact kinds. Designer = visual/UI (landing, brand kit, UI component). Marketer = words +
//? plans (copy, strategy, email sequence, ad set, social calendar, naming).
export type ArtifactKind = 'landing' | 'component' | 'brand' | 'copy' | 'strategy' | 'email' | 'ads' | 'social' | 'names' | 'thumbnail' | 'videoScript';
export type StudioRole = 'designer' | 'marketer';

//? Which role + provider-feature owns each kind.
export const KIND_META: Record<ArtifactKind, { role: StudioRole; feature: AiFeature; title: string }> = {
  landing: { role: 'designer', feature: 'studio-designer', title: 'Landing page' },
  component: { role: 'designer', feature: 'studio-designer', title: 'UI component' },
  brand: { role: 'designer', feature: 'studio-designer', title: 'Brand kit' },
  copy: { role: 'marketer', feature: 'studio-marketer', title: 'Marketing copy' },
  strategy: { role: 'marketer', feature: 'studio-marketer', title: 'Marketing strategy' },
  email: { role: 'marketer', feature: 'studio-marketer', title: 'Email sequence' },
  ads: { role: 'marketer', feature: 'studio-marketer', title: 'Ad set' },
  social: { role: 'marketer', feature: 'studio-marketer', title: 'Social calendar' },
  names: { role: 'marketer', feature: 'studio-marketer', title: 'Names & taglines' },
  //? Marketing visuals + video. `thumbnail` is a self-contained HTML ad creative (rendered in an
  //? iframe like a landing); `videoScript` is a promo script + storyboard (full video render needs a
  //? media/video provider key — the script is generated now, on the existing text provider).
  thumbnail: { role: 'marketer', feature: 'studio-marketer', title: 'Ad creative' },
  videoScript: { role: 'marketer', feature: 'studio-marketer', title: 'Video script' },
};
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['landing', 'component', 'brand', 'copy', 'strategy', 'email', 'ads', 'social', 'names', 'thumbnail', 'videoScript'];

//? The workspace's central brand library (ADR 0013 G-MKT-2), folded into every prompt so all
//? artifacts stay on-brand. Null when the workspace hasn't set one yet.
export interface BrandContext { palette: { name: string; hex: string }[]; typography: { heading: string; body: string }; voice: string; taglines: string[] }

export interface BriefInput { productName: string; audience: string; tone: string; goals: string; notes?: string | null }

const briefBlock = (b: BriefInput, brand?: BrandContext | null): string => {
  const base = `PRODUCT: ${b.productName}\nAUDIENCE: ${b.audience}\nTONE / BRAND VOICE: ${b.tone}\nGOALS: ${b.goals}${b.notes ? `\nEXTRA CONTEXT: ${b.notes}` : ''}`;
  if (!brand || (brand.palette.length === 0 && !brand.voice)) return base;
  const pal = brand.palette.map((p) => `${p.name} ${p.hex}`).join(', ');
  return `${base}\n\nSTAY ON-BRAND — use this workspace brand:\n- Palette: ${pal || '(none)'}\n- Fonts: ${brand.typography.heading || '?'} / ${brand.typography.body || '?'}\n- Voice: ${brand.voice || b.tone}${brand.taglines.length > 0 ? `\n- Existing taglines: ${brand.taglines.join(' · ')}` : ''}`;
};

//? Build the {system, prompt} for a kind, folding in the central brand library. Pure — the prompts
//? are the product; keep them explicit.
export function buildPrompt(kind: ArtifactKind, brief: BriefInput, brand?: BrandContext | null): { system: string; prompt: string } {
  const brf = briefBlock(brief, brand);
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
    case 'component': {
      return {
        system: 'You are a senior product/UI designer + front-end engineer. You output a SINGLE self-contained, responsive HTML snippet of ONE polished UI component (e.g. a pricing table, feature grid, testimonial section, or signup card): inline <style> only, NO external assets/fonts/scripts/images (CSS + emoji only). Modern, accessible, on-brand. Return ONLY the HTML in one ```html code block.',
        prompt: `Design one reusable UI component for this product's marketing site (pick the most useful one for the goals).\n\n${brf}\n\nReturn one \`\`\`html block with the component (a centered, self-contained section).`,
      };
    }
    case 'email': {
      return {
        system: 'You are a lifecycle-email expert. You output an onboarding/launch EMAIL SEQUENCE as ONE ```json code block only, matching exactly: {"emails":[{"subject":string,"preview":string,"body":string}]}. 3-5 emails, each with a compelling subject, a preview line, and a short plain-text body with one clear CTA.',
        prompt: `Write an email sequence to convert + activate for this product.\n\n${brf}\n\nReturn one \`\`\`json block only.`,
      };
    }
    case 'ads': {
      return {
        system: 'You are a performance-ad specialist. You output an AD SET as ONE ```json code block only, matching exactly: {"ads":[{"platform":string,"headline":string,"body":string,"cta":string}]}. Cover Google Search, Meta (FB/IG), and LinkedIn; 2-3 variants per platform, within realistic character limits.',
        prompt: `Write an ad set across platforms for this product.\n\n${brf}\n\nReturn one \`\`\`json block only.`,
      };
    }
    case 'social': {
      return {
        system: 'You are a social-media strategist. You output a 2-week CONTENT CALENDAR as ONE ```json code block only, matching exactly: {"posts":[{"day":string,"platform":string,"hook":string,"body":string}]}. Mix formats (educational, social proof, behind-the-scenes, launch); 8-10 posts.',
        prompt: `Plan a 2-week social content calendar for this product.\n\n${brf}\n\nReturn one \`\`\`json block only.`,
      };
    }
    case 'names': {
      return {
        system: 'You are a naming + brand strategist. You output naming ideas as ONE ```json code block only, matching exactly: {"names":[{"name":string,"rationale":string}],"taglines":[string],"domains":[string]}. 6-8 distinct names with a one-line rationale, 6-8 taglines, and plausible available-style domain ideas.',
        prompt: `Generate product names, taglines, and domain ideas for this product.\n\n${brf}\n\nReturn one \`\`\`json block only.`,
      };
    }
    case 'thumbnail': {
      return {
        system: 'You are a senior advertising creative designer. You output a SINGLE self-contained, responsive HTML AD CREATIVE / thumbnail — a bold landscape card (~1200×630): inline <style> only, NO external assets/fonts/scripts/images (CSS gradients/shapes + emoji only). A strong headline, a short subhead, and a clear CTA button, on-brand colours. Return ONLY the HTML in one ```html code block.',
        prompt: `Design one scroll-stopping ad creative / social thumbnail for this product (pick the strongest angle for the goals).\n\n${brf}\n\nReturn one \`\`\`html block — a single centered ad card sized around 1200×630.`,
      };
    }
    case 'videoScript': {
      return {
        system: 'You are a short-form video director + scriptwriter. You output a promo VIDEO SCRIPT + storyboard as ONE ```json code block only, matching exactly: {"hook":string,"durationSec":number,"scenes":[{"shot":string,"voiceover":string,"onScreen":string,"seconds":number}],"cta":string}. 4-7 scenes for a 30-60s promo — concrete, punchy, product-specific.',
        prompt: `Write a 30-60 second promo video script + storyboard for this product.\n\n${brf}\n\nReturn one \`\`\`json block only.`,
      };
    }
    default: {
      return { system: '', prompt: briefBlock(brief, brand) };
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
  if (kind === 'landing' || kind === 'component' || kind === 'thumbnail') {
    const html = extractBlock(text, 'html') || text.trim();
    return { content: { html }, title: KIND_META[kind].title };
  }
  if (kind === 'strategy') {
    return { content: { markdown: text.trim() }, title: 'Marketing strategy' };
  }
  //? the rest (brand, copy, email, ads, social, names) are JSON.
  const raw = extractBlock(text, 'json') || text.trim();
  const [, parsed] = tryCatchSync(() => JSON.parse(raw) as unknown);
  const obj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { raw };
  return { content: obj, title: KIND_META[kind].title };
}

//? Read the workspace's central brand library into a BrandContext (null when unset/empty). Defensive
//? readers — the Json columns are `unknown` at the type level.
export async function readBrandContext(prisma: PrismaClient, workspaceId: string): Promise<BrandContext | null> {
  const lib = await prisma.studioBrandLibrary.findFirst({ where: { workspaceId } });
  if (!lib) return null;
  const palRaw = Array.isArray(lib.palette) ? lib.palette : [];
  const palette = palRaw
    .map((p): { name: string; hex: string } | null => (p !== null && typeof p === 'object' ? { name: strOf((p as Record<string, unknown>).name), hex: strOf((p as Record<string, unknown>).hex) } : null))
    .filter((p): p is { name: string; hex: string } => p !== null && p.hex.length > 0);
  const typo = lib.typography !== null && typeof lib.typography === 'object' ? (lib.typography as Record<string, unknown>) : {};
  return { palette, typography: { heading: strOf(typo.heading), body: strOf(typo.body) }, voice: lib.voice, taglines: lib.taglines };
}
const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface GenerateResult { ok: boolean; artifactId?: string; error?: string }

//? Generate an artifact for a brief: build the prompt, run the assigned provider, parse, and STORE a
//? StudioArtifact (status ready|error). Membership/RBAC is enforced at the route; this is the engine.
//? I4 — append a free-text refine instruction to a built prompt (empty tweak → the prompt unchanged). Pure +
//? exported for tests.
export function applyRefine(prompt: string, tweak?: string): string {
  const t = (tweak ?? '').trim();
  return t.length > 0 ? `${prompt}\n\nRefine with this specific direction: ${t}` : prompt;
}

export interface GenerateInput { workspaceId: string; briefId: string; kind: ArtifactKind; tweak?: string }

//? #168 — create the 'generating' placeholder row IMMEDIATELY (the completion can take ~240s), so the
//? UI shows an in-progress artifact instead of a frozen button. `finishArtifact` does the slow work +
//? flips the row to ready/error. Returns the new row id (or an error if the brief is gone).
export async function beginArtifact(prisma: PrismaClient, input: GenerateInput): Promise<GenerateResult> {
  const brief = await prisma.studioBrief.findFirst({ where: { workspaceId: input.workspaceId, id: input.briefId }, select: { id: true } });
  if (!brief) return { ok: false, error: 'studio.briefNotFound' };
  const meta = KIND_META[input.kind];
  const art = await prisma.studioArtifact.create({
    data: { workspaceId: input.workspaceId, briefId: input.briefId, kind: input.kind, role: meta.role, title: meta.title, content: {}, status: 'generating' },
  });
  return { ok: true, artifactId: art.id };
}

//? #168 — run the (slow) AI completion for an already-created 'generating' row and flip it to
//? ready/error, then broadcast so every client refetches the snapshot. Call DETACHED (fire-and-forget)
//? from the route for an async return, or awaited via `generateArtifact` for the synchronous callers.
export async function finishArtifact(prisma: PrismaClient, artifactId: string, input: GenerateInput): Promise<GenerateResult> {
  const brief = await prisma.studioBrief.findFirst({ where: { workspaceId: input.workspaceId, id: input.briefId } });
  if (!brief) {
    await prisma.studioArtifact.update({ where: { id: artifactId }, data: { status: 'error', error: 'studio.briefNotFound' } });
    broadcastContentDirty(input.workspaceId);
    return { ok: false, artifactId, error: 'studio.briefNotFound' };
  }
  const meta = KIND_META[input.kind];
  //? Seed the prompt with the workspace's central brand library so the artifact stays on-brand (G-MKT-2).
  const brand = await readBrandContext(prisma, input.workspaceId);
  const built = buildPrompt(input.kind, brief, brand);
  //? I4 — a free-text refine instruction appended to the prompt (was a blind re-roll from the unchanged brief).
  const prompt = applyRefine(built.prompt, input.tweak);

  //? Generous timeout — the interactive claude-cli PTY can be slow on longer (brand-seeded) prompts.
  //? A workspace can assign the studio-* features to a faster API provider (gemini) via the AI-layer.
  const completion = await runAiCompletion(meta.feature, { prompt, system: built.system, timeoutMs: 240_000, workspaceId: input.workspaceId, label: `${meta.title} · ${brief.productName}` });
  if (!completion.ok || completion.text.trim().length === 0) {
    await prisma.studioArtifact.update({ where: { id: artifactId }, data: { providerId: completion.providerId, status: 'error', error: completion.error ?? 'studio.emptyResponse' } });
    broadcastContentDirty(input.workspaceId);
    return { ok: false, artifactId, error: completion.error ?? 'studio.emptyResponse' };
  }

  const { content, title } = parseArtifact(input.kind, completion.text);
  await prisma.studioArtifact.update({
    where: { id: artifactId },
    data: { title: `${title} — ${brief.productName}`, content: asJson(content), providerId: completion.providerId, status: 'ready', error: null },
  });
  broadcastContentDirty(input.workspaceId);
  return { ok: true, artifactId };
}

//? Synchronous convenience (the marketer role + tests): begin the row + await the completion.
export async function generateArtifact(prisma: PrismaClient, input: GenerateInput): Promise<GenerateResult> {
  const begun = await beginArtifact(prisma, input);
  if (!begun.ok || begun.artifactId === undefined) return begun;
  return finishArtifact(prisma, begun.artifactId, input);
}
