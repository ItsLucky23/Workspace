---
name: page-component-middleware
title: Protected page + component reuse + middleware
pattern: page-protected
tags: [page, middleware, auth, component, i18n]
---

# Protected page + component reuse + middleware

## When to use

The canonical shape for a `src/<page>/page.tsx` that must be auth-gated and that
reuses an existing `src/_components` primitive (here `Dropdown`). Use it whenever a
route needs a per-page guard plus shared UI. Do NOT use it for public pages (drop the
`middleware` export and default `template = 'plain'`), and do NOT hand-roll a new
dropdown/select — extend the existing component or add a prop.

## Canonical example

```ts
// src/team/page.tsx
import { useState } from 'react';

import { useTranslator, i18nNotify as notify } from '@luckystack/core/client';
import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from 'config';

import Dropdown, { type DropdownItem } from 'src/_components/Dropdown';

export const template = 'dashboard';

//? intent: Admin-only team roster. Filter members by role via a shared Dropdown.
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  if (session.admin) return { success: true };
  notify.error({ key: 'team.notAdmin' });
  return; // navigate(-1)
};

const ROLES = ['all', 'owner', 'member', 'guest'] as const;
type Role = typeof ROLES[number];

export default function Home() {
  const translate = useTranslator();
  const [role, setRole] = useState<Role>('all');

  const roleItems: DropdownItem[] = ROLES.map((value) => ({
    id: value,
    value,
    placeholder: translate({ key: `team.role.${value}` }),
  }));
  const selectedItem = roleItems.find((item) => item.id === role);

  return (
    <div className={`w-full h-full overflow-y-auto bg-background p-6`}>
      <div className={`max-w-2xl mx-auto flex flex-col gap-4`}>
        <div className={`text-2xl font-semibold text-title`}>
          {translate({ key: 'team.title' })}
        </div>
        <Dropdown
          items={roleItems}
          value={selectedItem}
          onChange={(item) => { setRole(item.id as Role); }}
        />
      </div>
    </div>
  );
}
```

## Why this shape

- **`export const template` + per-page `export const middleware`** is the canonical
  guard pattern (per `docs/ARCHITECTURE_ROUTING.md` "Page Guards"). The framework's
  `<Middleware>` component (wired by the `dashboard` template) auto-runs the per-page
  middleware before painting — no central `src/_functions/middlewareHandler.ts` switch,
  no manual `<Middleware>` wrapper in JSX. Pages own their guards.
- **The return contract is exact**: `{ success: true }` renders, `{ success: false,
  redirect }` navigates, and returning `undefined` triggers history-back — which is why
  the non-admin branch pairs a `notify.error(...)` toast with a bare `return`. Returning
  nothing silently would leave the user with no feedback.
- **`PageMiddleware<SessionLayout>`** is typed against the project's own
  `SessionLayout` (extended from `BaseSessionLayout` in `config.ts`), so `session.admin`
  is checked with no `as any` cast.
- **Component reuse, not reinvention**: `Dropdown` is imported from `src/_components`
  and driven by its real `DropdownItem[]` / `value` / `onChange` contract. `item.id` is
  `string | number`, so the `onChange` handler narrows it back to `Role` — the only cast
  is a domain narrowing on a known-safe union, never on the framework API surface.
- **i18n is mandatory**: every user-facing string (title, role labels, the non-admin
  toast) goes through `useTranslator()` / `notify`'s `key`, never a hardcoded literal.
- **`@theme` tokens only**: `bg-background`, `text-title` come from the `index.css`
  `@theme` block — no arbitrary hex. `className` always uses backticks per the JSX
  micro-conventions.
- **Default export named `Home`** and self-closing-free minimal JSX match the real
  `src/admin/page.tsx` / `src/settings/page.tsx` this is modeled on. No data fetching,
  no error handling for impossible states — a protected page that filters a list needs
  nothing more (Rule 7b).
