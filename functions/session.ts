//? Framework-default shim. Re-exports session helpers from @luckystack/login
//? so they show up as `functions.session.<name>` inside every API + sync handler.
//?
//? Edit this file to wrap session calls — add per-tenant key-prefixes, logging,
//? extra audit fields. Your edits affect calls via `functions.session.X` in your
//? own handlers. Framework-internal session creation (login flow, OAuth callback,
//? logout cleanup) goes through `@luckystack/login` DIRECTLY and is NOT affected
//? by edits here.
//?
//? For framework-wide session storage override (different backend, custom key
//? naming, etc.): use `registerSessionAdapter()` from @luckystack/login. That
//? hook is consumed by every framework-internal session call.
export {
  saveSession,
  getSession,
  deleteSession,
  getAllSessions,
  revokeUserSessions,
} from '@luckystack/login';
