//? Workspaces — first-login bootstrap.
//?
//? Auto-seeding a demo workspace on first login is intentionally DISABLED: a new
//? user starts with ZERO workspaces and goes through the onboarding empty-state
//? (create a workspace, or accept a pending email invitation). `seedDemoWorkspace`
//? is kept for tests and manual dev seeding only — it is no longer wired to login.

export function registerFirstLoginBootstrap(): void {
  //? No first-login side-effect — onboarding (client) owns the zero-workspace path.
}
