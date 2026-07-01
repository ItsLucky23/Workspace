# Skill: audit-invalid-page-locations

Scan every `src/**/page.tsx` and flag files that aren't routeable under LuckyStack's invisible-parent folder convention.

The framework's `validatePagePath` helper (`packages/core/src/pageRouteValidation.ts`) defines the rules. This skill applies them at scale and tells the user which files are silently lost.

## When to use

- After bulk refactors that move pages between folders.
- After a project takes on a new naming convention (e.g. you start using `_marketing/` to group landing pages and want to verify nothing got dropped).
- Before publishing a release — silently skipped pages are a common cause of "the page works locally but 404s in prod".

## The rules (mirrored from `validatePagePath`)

- A folder starting with `_` is **invisible-parent**: stripped from the URL, but children route.
- A `page.tsx` placed directly inside an `_<folder>` is **invalid** (no URL segment left).
- A `page.tsx` inside a reserved framework folder (`_api`, `_sync`, `_function(s)`, `_component(s)`, `_provider(s)`, `_locale(s)`, `_socket(s)`, `_shared`, `_server`) is **invalid** — framework-internal.
- Filename must be `page.tsx` (or `page.jsx`).

## Workflow

### 1. Discover all pages

Use Glob with pattern `src/**/page.tsx`. Build a list of relative paths.

### 2. Apply the rules to each

For each path, split on `/`, drop the trailing `page.tsx`, then:

- If any segment is in the reserved-folder list → flag `RESERVED_FOLDER`.
- Filter out underscore-prefixed segments; if 0 visible segments remain (and the path wasn't just `src/page.tsx`) → flag `NO_URL_SEGMENT`.
- Otherwise compute the route and mark `OK`.

### 3. Report

Group findings by issue type:

```
[audit-invalid-page-locations]
  RESERVED_FOLDER (2):
    src/_api/playground/page.tsx          (page.tsx cannot live inside _api)
    src/_components/header/page.tsx        (page.tsx cannot live inside _components)

  NO_URL_SEGMENT (1):
    src/_housing/page.tsx                  (no URL segment left after stripping underscore folders)

  OK (8):
    src/admin/page.tsx               → /admin
    src/settings/page.tsx            → /settings
    src/_marketing/landing/page.tsx  → /landing
    ... (5 more)
```

### 4. Offer fixes

For `RESERVED_FOLDER` findings, the page is probably misplaced. Suggest:

- Move to a sibling folder (`src/_api/playground/page.tsx` → `src/playground/page.tsx`).
- Or rename the file to something other than `page.tsx` if it's actually a helper component (`PlaygroundLayout.tsx`).

For `NO_URL_SEGMENT` findings, the page wraps nothing — suggest:

- Add a real route segment inside (`src/_housing/index/page.tsx` → `/index`, or `src/_housing/overview/page.tsx` → `/overview`).
- Or move the file up (`src/_housing/page.tsx` → `src/page.tsx` if it really should be the root).
- Or rename to a non-`page.tsx` filename if it's a shared component.

Apply via Edit/Bash only on user confirmation. **Never delete `page.tsx` files unilaterally** — they may have useful code that just needs relocation.

## Example finding + correction

```
src/_housing/page.tsx → NO_URL_SEGMENT
```

The user probably meant to either:

```bash
# Option A: scope under a visible segment
mkdir src/_housing/overview && git mv src/_housing/page.tsx src/_housing/overview/page.tsx
# Now routes at /overview

# Option B: drop the invisible parent
git mv src/_housing/page.tsx src/housing/page.tsx
# Now routes at /housing
```

Ask the user which intent matches.

## Not in scope

- This skill doesn't validate page CONTENT (default export shape, template export). Use the existing `add-new-api` / scaffold templates as the structural reference.
- Auto-fix is not supported — these moves change URLs and need a human decision.
