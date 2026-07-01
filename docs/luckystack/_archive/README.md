# docs/_archive — point-in-time records (NOT evergreen)

This folder holds **ephemeral documentation**: audits, handoffs, readiness reports, and session
snapshots. They describe a *problem → solution at a moment in time* and go stale the instant the work
they describe lands. They are kept for history, **not** as a source of truth.

## How docs are split

| Location | Contains | Lifetime |
|---|---|---|
| `docs/` (root) | **Evergreen** — architecture, page-purpose, protocols, guides, generated indexes | Kept current; the source of truth |
| `docs/_archive/` (this folder) | **Superseded / done** point-in-time reports | Frozen history; safe to delete once nobody needs the record |
| `review/` (repo root) | **Active** working backlog (an audit whose findings are not yet actioned) | Lives until its findings are resolved, then moves here |

## Rules

- **Do not link to `_archive/` from an evergreen doc.** If an evergreen doc needs a fact, copy the fact
  into the evergreen doc — don't point a live reader at a frozen snapshot.
- **Not bundled to consumers.** `create-luckystack-app`'s `bundleFrameworkDocs.mjs` skips `_archive/`, so
  this cruft never pollutes a scaffolded project's AI context.
- **An audit is "active" until actioned.** A report whose findings still need work belongs in `review/`
  (or its working folder), not here. Move it here only once it is done or superseded.

## Index

See `INDEX.md` for the per-file status (done / superseded) and what replaced it.
