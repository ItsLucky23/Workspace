/** @docs owner ItsLucky23 */
//? DESIGN_DOCS_PROGRAM 2.1 — document templates (user-authorable, option B). A template is a named section
//? skeleton [{ heading, hint }] the AI fills outline-then-section. One builtin ships (Technical Design — the
//? owner's headline "detailed technical design" doc); users add/edit/duplicate their own. The skeleton also
//? seeds a blank document's starting structure so even a non-AI author gets the right shape.

import type { PrismaClient } from '@prisma/client';

export interface DocSection { heading: string; hint: string }
export interface DocTemplate { slug: string; name: string; description: string; sections: DocSection[] }

//? The one seeded builtin. Covers the vision's named content types (designs, requirements, wireframes,
//? system decisions) plus the connective sections a real technical-design doc needs.
export const BUILTIN_DOC_TEMPLATES: DocTemplate[] = [
  {
    slug: 'technical-design',
    name: 'Technical Design',
    description: 'A detailed technical design document: overview, requirements, architecture, wireframes, system decisions.',
    sections: [
      { heading: 'Overview', hint: 'What is being built and why, in a few sentences. The problem, the goal, the audience.' },
      { heading: 'Goals & non-goals', hint: 'Bullet the explicit goals and the things deliberately out of scope.' },
      { heading: 'Requirements', hint: 'Functional + non-functional requirements. Use a table (id | requirement | priority) where it helps.' },
      { heading: 'Architecture', hint: 'The system shape: components, data flow, external services. Describe a diagram in words (a mermaid block if useful).' },
      { heading: 'Data model', hint: 'The key entities and their fields/relations. A table per entity where it helps.' },
      { heading: 'Wireframes & UX', hint: 'The main screens/flows and how the user moves through them. Describe each wireframe.' },
      { heading: 'System decisions', hint: 'The important choices made and the alternatives rejected, with the reasoning (an ADR-style list).' },
      { heading: 'Risks & open questions', hint: 'What could go wrong, unknowns, and what still needs a decision.' },
      { heading: 'Milestones', hint: 'A phased plan with rough sequencing. A table (phase | deliverable | done-when) where it helps.' },
    ],
  },
];

//? Safe-parse a Prisma `DocumentTemplate.sections` Json into typed sections (unknown shapes dropped).
export function parseSections(raw: unknown): DocSection[] {
  if (!Array.isArray(raw)) return [];
  const out: DocSection[] = [];
  for (const s of raw) {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) continue;
    const rec = s as Record<string, unknown>;
    if (typeof rec.heading !== 'string' || rec.heading.trim().length === 0) continue;
    out.push({ heading: rec.heading.trim(), hint: typeof rec.hint === 'string' ? rec.hint : '' });
  }
  return out;
}

//? A blank starting document from a template's sections (## headings, hints as HTML comments the author
//? replaces). Seeded as the initial content when a document is created with a template.
export function buildSkeleton(title: string, sections: DocSection[]): string {
  const head = title.trim().length > 0 ? `# ${title.trim()}\n` : '';
  const body = sections.map((s) => `## ${s.heading}\n\n${s.hint ? `<!-- ${s.hint} -->\n` : ''}`).join('\n');
  return `${head}\n${body}`.trim() + '\n';
}

//? The structure instruction for template-guided generation: the model must produce EXACTLY these sections
//? (in order, as ## headings) and fill each per its hint — outline the section first, then write it out.
export function buildTemplateStructure(template: DocTemplate): string {
  const lines = template.sections.map((s, i) => `${String(i + 1)}. ## ${s.heading} — ${s.hint}`);
  return [
    `Produce a "${template.name}" document with EXACTLY these sections, in this order, each as a "## " heading:`,
    ...lines,
    'For each section: first think of the key points (an outline), then write the section out in full, grounded strictly on the provided source material. Use tables and mermaid code-blocks where the hint suggests them. Do not add or drop sections.',
  ].join('\n');
}

//? The builtin default for a slug (the reset source), or null if not a builtin.
export function builtinDocTemplate(slug: string): DocTemplate | null {
  return BUILTIN_DOC_TEMPLATES.find((t) => t.slug === slug) ?? null;
}

//? A DB row → typed template.
function rowToTemplate(row: { slug: string; name: string; description: string; sections: unknown }): DocTemplate {
  return { slug: row.slug, name: row.name, description: row.description, sections: parseSections(row.sections) };
}

//? The workspace's templates: builtins are VIRTUAL (no seeding), a DB row with the same slug OVERRIDES its
//? builtin (a user edit), and user-created slugs are appended. So existing workspaces get the builtins for
//? free and edits/additions live in the DB. Sorted builtins-first then by name.
export async function listWorkspaceTemplates(prisma: PrismaClient, workspaceId: string): Promise<(DocTemplate & { builtin: boolean })[]> {
  const rows = await prisma.documentTemplate.findMany({ where: { workspaceId } });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const out: (DocTemplate & { builtin: boolean })[] = [];
  for (const b of BUILTIN_DOC_TEMPLATES) {
    const override = bySlug.get(b.slug);
    out.push({ ...(override ? rowToTemplate(override) : b), builtin: true });
    bySlug.delete(b.slug);
  }
  for (const r of bySlug.values()) out.push({ ...rowToTemplate(r), builtin: false });
  return out;
}

//? Resolve ONE template by slug for generation: a DB override wins, else the builtin constant, else null.
export async function resolveTemplate(prisma: PrismaClient, workspaceId: string, slug: string): Promise<DocTemplate | null> {
  if (!slug) return null;
  const row = await prisma.documentTemplate.findFirst({ where: { workspaceId, slug } });
  if (row) return rowToTemplate(row);
  return builtinDocTemplate(slug);
}
