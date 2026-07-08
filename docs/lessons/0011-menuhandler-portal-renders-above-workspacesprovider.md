---
id: 0011
title: A form opened via menuHandler.open renders ABOVE WorkspacesProvider — useWorkspaces() throws
severity: high
area: src/workspaces/_shell, menuHandler, react-context
date: 2026-07-08
---

# 0011 — menuHandler-rendered components can't call useWorkspaces()

## What happened

Extending `CreateProjectForm` (the "New project" dialog) to read `templates` + `createFromTemplate`
via `useWorkspaces()` made the whole app go **blank** the moment the dialog opened — no visible React
error in the terminal, just an empty `#f4f4f4` page and an `auth.required` re-auth loop. tsc, lint,
and `npm run build` were all green; only the live browser surfaced it.

## Root cause

The provider hierarchy is `SocketStatusProvider > SessionProvider > TranslationProvider > AvatarProvider
> MenuHandlerProvider > Router`, and `WorkspacesProvider` wraps the workspaces ROUTES *inside* the Router.
`menuHandler.open(<X/>)` renders `X` in the **MenuHandler's portal**, which sits ABOVE the Router — so it
is OUTSIDE `WorkspacesProvider`. Calling `useWorkspaces()` there throws "must be used within
WorkspacesProvider", the error boundary swallows the subtree, and the page blanks. The pre-existing
`CreateProjectForm` already knew this implicitly: it took `onCreate` as a **prop** rather than pulling
`createProject` from the hook.

## How to avoid

- A component rendered via `menuHandler.open(...)` (or any portal above the Router) must NOT call
  `useWorkspaces()` (or any workspaces-scoped hook). **Inject what it needs as props** from the call site,
  which lives inside the provider (e.g. `ProjectSwitcher` passes `templates` + `onCreateFromTemplate`).
- Components rendered **inline in a page** (`{open && <Editor/>}` in a `*/page.tsx`) ARE inside the
  provider — `useWorkspaces()` is fine there. This is why `ImageEditor` / `VideoTimelineEditor` /
  `NeedsInputBanner` (all inline) are safe and `menuHandler` forms are not.
- This class of bug is invisible to tsc/lint/build (it's a runtime context boundary) — a quick live
  browser open of any new `menuHandler` form catches it instantly.
