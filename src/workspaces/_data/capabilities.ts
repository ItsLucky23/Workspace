//? Client-side capability indices — a positional mirror of the server CAP enum (server/control/rbac.ts) and
//? the RBAC_CAPABILITIES label array (src/workspaces/_data/seed.ts). The server OWNS enforcement; this mirror
//? only lets the UI decide whether to offer a "fix it" button (the current user MAY do the setup) or fall back
//? to "ask someone with <capability>" (they may not) — so a blocked feature never shows a dead button.
//? Keep in lockstep with both server sources; the snapshot ships the caller's resolved `myPerms[]` so a custom
//? role resolves correctly here too.

export const CAP = {
  workTickets: 0,
  editPipeline: 1,
  workspaceSettings: 2,
  manageMembers: 3,
  manageSprints: 4,
  promoteAdmin: 5,
  demoteAdmin: 6,
  ownerActions: 7,
} as const;

export type CapKey = keyof typeof CAP;

//? The i18n key for a capability's human name — used in the "ask someone with <capability> permission" message
//? on a blocked feature the current user cannot set up themselves.
export const capLabelKey = (cap: CapKey): string => `workspaces.setup.cap.${cap}`;
