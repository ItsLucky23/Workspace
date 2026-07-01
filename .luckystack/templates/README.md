# `.luckystack/templates/` — scaffold template customization

`@luckystack/devkit` injects starter content into newly-created **empty** files
under `src/` (a new `_api/*.ts`, `_sync/*.ts`, or `page.tsx`). This folder lets
you customize **what gets injected** and **when**, without forking devkit.

> Dev-only. devkit reads this folder during `npm run server` (development). It
> has no effect in production and ships nothing to your users.

## Two things you can edit

### 1. The selection logic — `templateRules.ts`

Decides **which** template a file receives, based on its path/kind. devkit
auto-loads this file before the first injection. Remove rules, change
predicates, or add new kinds. Delete the file to revert to devkit's defaults.

### 2. The template content — `*.template.ts(x)`

The files in this folder are your editable copies of devkit's built-in
templates. Change them to match your house style. Placeholders are filled in at
injection time:

| Placeholder | Replaced with |
|---|---|
| `{{REL_PATH}}` | relative path from the file back to project root (e.g. `../../../`) |
| `{{PAGE_PATH}}` | the page segment, for paired sync clients |
| `{{SYNC_NAME}}` | the sync event name, for paired sync clients |

**Content resolution order** (first hit wins):
1. `.luckystack/templates/<kind>.template.ts(x)` — the files here.
2. a `registerTemplate('<kind>', '...')` string override.
3. devkit's bundled default (current with your installed devkit version).

> These files are a **snapshot** of devkit's defaults at scaffold time. To use
> the (upgradeable) bundled default for a kind again, just **delete** that
> `*.template.*` file. To pull a fresh copy of a default, look in
> `node_modules/@luckystack/devkit/dist/templates/`.

## Built-in kinds

`api` · `sync_server` · `sync_client_paired` · `sync_client_standalone` ·
`page_plain` · `page_dashboard`

Add your own with `registerTemplateKind('<kind>', { match, priority? })` in
`templateRules.ts` plus a `<kind>.template.ts(x)` file here.
