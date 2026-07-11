//? Workspaces — the CHAT-ENABLED op tranche (X1, UNIVERSAL_TOOL_PROGRAM Fase A / COMPLETION Fase X).
//? The single client-side source of truth for WHICH control-ops the Workspace-AI may propose AND the
//? client can dispatch on accept. The server keeps its own copy inside `server/ai/opCatalog.ts`
//? (the bundler stubs `src/` runtime imports in server code, same constraint as OP_CAPABILITY) —
//? `tests/unit/opCatalogParity.test.mts` keeps the two in lockstep. Growing the assistant surface =
//? add the op here + a dispatcher in `chatDispatch.ts` + flip it to `enabled` in the server catalog.
//? NO imports in this file (it must stay safely importable from tests + client + anywhere).

export const CHAT_ENABLED_OPS = [
  // agent-session controls
  'pause', 'resume', 'kill', 'pause-all', 'resume-all',
  // deploy / environments
  'env-deploy', 'env-teardown', 'env-promote', 'build-export',
  // CI + reasoning + memory
  'ci-run', 'ci-allow-red', 'root-cause', 'plan-critique', 'index-memory',
  // user-app DB (db-connect stays excluded — it carries a connection-string secret)
  'db-migrate-create', 'db-introspect',
  // projects / greenfield
  'project-create', 'project-from-template',
  // service stacks (preset-only via chat; bring-your-own compose stays UI-only)
  'service-provision', 'service-teardown',
  // pipeline shape (R1 ops)
  'stage-create', 'stage-delete', 'stage-reorder',
  // content lifecycle + orchestration (paid per-asset gen ops follow once cost-confirms land, B4)
  'content-run-pipeline', 'content-advance', 'content-archive', 'content-unarchive', 'content-regenerate',
  // F5 — AI image critique (advisory, no asset write)
  'content-critique-image',
  // F7 — video-to-video restyle (paid gen)
  'content-video-restyle',
  'content-edit-image',
  'shortlink-create',
] as const;

export type ChatEnabledOp = (typeof CHAT_ENABLED_OPS)[number];

//? Type-guard so the provider can index the dispatch map without a cast (Rule 21).
export function isChatEnabledOp(op: string): op is ChatEnabledOp {
  return (CHAT_ENABLED_OPS as readonly string[]).includes(op);
}
