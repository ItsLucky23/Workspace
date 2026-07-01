# Skill: add-new-page

Scaffold a new page route in a LuckyStack app under `src/{path}/page.tsx`.

Trigger: `/add-new-page <path> [--template dashboard|plain]`.

LuckyStack uses file-based routing for pages. `src/main.tsx` scans `.tsx` files via `import.meta.glob`; any file named `page.tsx` in a non-private folder is registered as a route. Creating the file is enough — the dev server hot-reloads.

## Workflow

### 1. Decide the route path

- The page lives at `src/{path}/page.tsx` and renders at `/{path}`. `src/page.tsx` renders at `/`.
- **Private folders** (any segment starting with `_`) are **invisible-parent**: they group files structurally but are stripped from the URL. `src/_marketing/landing/page.tsx` → `/landing`.
- **Invalid placements** (the loader skips these — verify before scaffolding):
  - A `page.tsx` directly inside a `_<folder>` with no visible segment left (`src/_housing/page.tsx`).
  - A `page.tsx` inside a reserved framework folder (`_api`, `_sync`, `_function(s)`, `_component(s)`, `_provider(s)`, `_locale(s)`, `_socket(s)`, `_shared`, `_server`).
- Resolve the `--template` flag: `dashboard` for sidebar/app pages (admin, settings, billing, account, profile), `plain` for chrome-less pages (login, register, docs, marketing). Default to `plain` if not specified.

### 2. Reuse before authoring (Rule 12)

Before building any UI, check existing surfaces — do not roll a parallel implementation:

- `docs/AI_CAPABILITIES.md` — existing helpers, utils, cross-cutting modules.
- `docs/AI_PROJECT_INDEX.md` — existing routes/pages/components and which helpers a similar page already imports.
- `src/_components/` — primitives like `Dropdown`, `MultiSelectDropdown`, `Avatar`, `Navbar`, `MenuHandlerProvider` / `useMenuHandler`, `menuHandler.confirm(...)`. Extend a component or add a prop rather than reimplementing.

If a capability lives in a not-yet-installed `@luckystack/*` package (`docs/PACKAGE_OVERVIEW.md`), propose the install instead of reimplementing.

### 3. Create the page file from this template

Every page MUST `export default` a React component and SHOULD `export const template`. If `template` is omitted it defaults to `'plain'`.

**Plain page** (`--template plain`):

```tsx
import { useTranslator } from '@luckystack/core/client';

export const template = 'plain';

export default function ExamplePage() {
  const translate = useTranslator();

  return (
    <div className={`flex min-h-screen flex-col items-center justify-center bg-background text-common`}>
      <div className={`text-title text-2xl font-semibold`}>
        {translate({ key: 'example.title' })}
      </div>
    </div>
  );
}
```

**Dashboard page** (`--template dashboard`):

```tsx
import { i18nNotify as notify, useSession, useTranslator } from '@luckystack/core/client';
import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from 'config';

export const template = 'dashboard';

//? Logged-out users -> /login. Logged-in users render the page.
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

export default function ExamplePage() {
  const translate = useTranslator();
  const session = useSession();

  return (
    <div className={`flex flex-col gap-4 p-6 text-common`}>
      <div className={`text-title text-xl font-semibold`}>
        {translate({ key: 'example.title' })}
      </div>
      <div className={`rounded-lg border border-container1-border bg-container1 p-4`}>
        {translate({ key: 'example.body' })}
      </div>
    </div>
  );
}
```

### 4. Per-page middleware (protected pages)

Guards live **on the page itself** via `export const middleware: PageMiddleware<SessionLayout>`. The framework's `<Middleware>` component (and `useRouter` for programmatic nav) runs it before painting; with no per-page middleware the route is allowed by default. There is **no central `src/_functions/middlewareHandler.ts`** — pages own their guards.

Return contract:

| Return value | Effect |
|---|---|
| `{ success: true }` | Page renders. |
| `{ success: false, redirect: '/some-path' }` | `navigate('/some-path')`. |
| `undefined` (no return) | `navigate(-1)` (history back). Pair with `notify.error(...)` for feedback. |

For role checks, gate inside the middleware and toast on denial:

```tsx
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  if (session.admin) return { success: true };
  notify.error({ key: 'middleware.notAdmin' });
  return; // navigate(-1)
};
```

### 5. i18n and styling rules

- **All user-facing text via `useTranslator`** — call `const translate = useTranslator();` then `translate({ key: 'page.someKey' })`. No hardcoded strings. Add the matching keys to the project's `_locales` JSON.
- **Tailwind tokens only** — surfaces (`background`, `container1`, `container2` + `-hover` / `-border`), text (`title`, `common`, `muted`, `disabled`), accent (`primary`, `secondary`), semantic (`correct`, `warning`, `wrong`), utility (`overlay`, `focus-ring`, `divider`). Never arbitrary hex values; tokens come only from `src/index.css` `@theme`.
- **JSX conventions** — always backticks in `className={`...`}`; self-closing tags for childless components; prefer `<div>` over semantic tags unless required.

### 6. Refresh indexes, then lint + build

After saving the file, run autonomously (Rule 12 / 15):

```
npm run ai:project-index
npm run lint
npm run build
```

`ai:project-index` re-snapshots routes/pages/components so subsequent work sees the new page. Deliver only on zero lint warnings and zero build errors.

### 7. Verify and report developer actions

- Confirm the route resolves: `src/{path}/page.tsx` → `/{path}` (private segments stripped).
- If the dev server is running, an **empty** `page.tsx` triggers devkit's template injector instead — for a hand-authored page, write the full file directly.
- Tell the developer: the new route is reachable at `/{path}`, what to test (load the URL; for guarded pages, test both logged-out redirect and logged-in render), and that any new `_locales` keys must be added before strings resolve.

### 8. Deep dive

For routing details (invisible-parent rules, duplicate-route detection, the `validatePagePath` helper, template injection), see [`docs/ARCHITECTURE_ROUTING.md`](../../../docs/ARCHITECTURE_ROUTING.md).
