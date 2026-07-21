//? Workspaces — module / nav-section model (workspace-scoped nav gating).
//?
//? A workspace enables a set of NAV SECTIONS. At creation the user picks high-level
//? MODULES (Development / Content / Design) — pure presets that expand to a set of
//? section ids. The RESOLVED section-id list is what we persist
//? (`Workspace.enabledSections`), so individual sections can be toggled later (a
//? Development workspace can add just the Interviewer without the rest of Design).
//? An EMPTY list means "legacy / all-on" — pre-module workspaces keep every section.
//?
//? Pure constants (no React / no server deps) so BOTH the client (nav filter, creation
//? picker, settings toggles) and the server (createWorkspace input validation) import
//? ONE source of truth.

export type WorkspaceModuleId = 'development' | 'content' | 'design' | 'documents';

export interface WorkspaceModule {
  id: WorkspaceModuleId;
  labelKey: string;   // i18n key
  descKey: string;    // i18n key
  icon: string;       // FontAwesome icon name (rendered by the creation picker)
  sections: string[]; // nav-section ids this module unlocks
}

//? The three shippable modules. Development is the only lane that needs a repo +
//? Dockerfile; Content is the marketing/AI image+video+copy lane; Design is the
//? UI/theme designer lane. Any nav item NOT owned by a module here (usage, ai,
//? settings, workspace) is ALWAYS shown regardless of the enabled set.
export const WORKSPACE_MODULES: WorkspaceModule[] = [
  //? Gap-fix: 'interviewer' also unlocks for Development — the CODE-focused review tool previously only
  //? unlocked via Design (which has no Sources/code-index), leaving dev workspaces without it.
  { id: 'development', labelKey: 'workspaces.modules.developmentLabel', descKey: 'workspaces.modules.developmentDesc', icon: 'code-branch', sections: ['board', 'backlog', 'terminals', 'code', 'activity', 'sources', 'pipeline', 'automations', 'scheduled', 'interviewer', 'components'] },
  //? #87 — Content/Design also unlock 'scheduled' (automation/triggers) so those lanes can reach
  //? scheduled posts + event automation, not just the Development lane. #165 — Design also unlocks
  //? 'marketing' (the Studio brand/landing generator) so a Design-only workspace can do visual/brand
  //? generation. (OPEN VRAAG: defaults per Rule 3a — user away; revisit if the nav feels too broad.)
  //? Category restructure — 'studio' (brief → landing page + brand kit) is a visible nav section
  //? again, unlocked by the same lanes as 'marketing' (it is the brand/landing generator behind it).
  { id: 'content', labelKey: 'workspaces.modules.contentLabel', descKey: 'workspaces.modules.contentDesc', icon: 'wand-magic-sparkles', sections: ['content', 'marketing', 'scheduled', 'automations', 'scheduled-posts', 'studio'] },
  { id: 'design', labelKey: 'workspaces.modules.designLabel', descKey: 'workspaces.modules.designDesc', icon: 'display', sections: ['designer', 'components', 'interviewer', 'marketing', 'scheduled', 'automations', 'studio'] },
  //? DOC1 (DOCUMENTS_AND_SKILLS) — the Documents module: AI-drafted workspace documents (specs,
  //? designs, plans) with export targets. Own module so any workspace type can add just this.
  { id: 'documents', labelKey: 'workspaces.modules.documentsLabel', descKey: 'workspaces.modules.documentsDesc', icon: 'file-lines', sections: ['documents'] },
];

//? Per-section metadata for the settings toggle grid (individual sections can be
//? enabled/disabled after creation — a Development workspace can add just the
//? Interviewer without the rest of Design). `moduleId` groups the toggles.
export interface WorkspaceSectionDef { id: string; labelKey: string; moduleId: WorkspaceModuleId; }
export const WORKSPACE_SECTIONS: WorkspaceSectionDef[] = WORKSPACE_MODULES.flatMap((m) =>
  m.sections.map((id) => ({ id, labelKey: `workspaces.sections.${id}`, moduleId: m.id })),
);

//? Every section id that some module can unlock — the GATEABLE set. A nav item not in
//? here is never hidden.
export const GATEABLE_SECTIONS: string[] = WORKSPACE_MODULES.flatMap((m) => m.sections);

//? Expand a set of chosen module ids to the flat set of section ids they unlock.
export function sectionsForModules(moduleIds: WorkspaceModuleId[]): string[] {
  const set = new Set<string>();
  for (const m of WORKSPACE_MODULES) if (moduleIds.includes(m.id)) for (const s of m.sections) set.add(s);
  return [...set];
}

//? Is a nav section visible for a workspace's enabledSections? Empty/absent = legacy →
//? everything on. A non-gateable section (not owned by any module) is always visible.
export function isSectionEnabled(enabledSections: string[] | undefined, sectionId: string): boolean {
  if (!enabledSections || enabledSections.length === 0) return true;
  if (!GATEABLE_SECTIONS.includes(sectionId)) return true;
  return enabledSections.includes(sectionId);
}

//? Is a whole module (any of its sections) enabled? Gates module-specific setup UI —
//? e.g. the repo/Dockerfile setup only makes sense when Development is on.
export function isModuleEnabled(enabledSections: string[] | undefined, moduleId: WorkspaceModuleId): boolean {
  if (!enabledSections || enabledSections.length === 0) return true;
  const mod = WORKSPACE_MODULES.find((m) => m.id === moduleId);
  return mod ? mod.sections.some((s) => enabledSections.includes(s)) : false;
}

//? Sanitize a caller-supplied section list to only known gateable ids (input hardening
//? on the create/save path — never persist an arbitrary string).
export function sanitizeSections(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const v of input) if (typeof v === 'string' && GATEABLE_SECTIONS.includes(v)) set.add(v);
  return [...set];
}
