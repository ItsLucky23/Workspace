//? #19 — the CLIENT twin of the workspace packs (`server/bootstrap/workspacePacks.ts`).
//?
//? Same split as `chatOps.ts` vs the server op-catalog: the server bundle stubs `src/` runtime imports, so
//? the two lists live apart and a parity test keeps them honest. This half carries only what the picker
//? needs — the id, its copy, and the modules/tier it preselects. The seeded CONTENT (skills, channels,
//? documents, starter tickets) is the server's business and deliberately not duplicated here.
//?
//? NO imports in this file, so it stays safely importable from tests, client and anywhere else.

export interface WorkspacePackChoice {
  id: string;
  labelKey: string;
  descKey: string;
  icon: string;
  //? Preselected on pick — visible and still editable underneath, because a pack is a starting point.
  modules: ('development' | 'content' | 'design' | 'documents')[];
  preset: 'simple' | 'advanced' | 'professional';
}

export const WORKSPACE_PACK_CHOICES: WorkspacePackChoice[] = [
  {
    id: 'solo-dev',
    labelKey: 'workspaces.packs.soloDev', descKey: 'workspaces.packs.soloDevDesc', icon: 'code',
    modules: ['development'], preset: 'simple',
  },
  {
    id: 'content-creator',
    labelKey: 'workspaces.packs.creator', descKey: 'workspaces.packs.creatorDesc', icon: 'wand-magic-sparkles',
    modules: ['content', 'design'], preset: 'simple',
  },
  {
    id: 'agency',
    labelKey: 'workspaces.packs.agency', descKey: 'workspaces.packs.agencyDesc', icon: 'users',
    modules: ['development', 'content', 'design', 'documents'], preset: 'professional',
  },
  {
    id: 'student',
    labelKey: 'workspaces.packs.student', descKey: 'workspaces.packs.studentDesc', icon: 'graduation-cap',
    modules: ['documents', 'development'], preset: 'simple',
  },
];
