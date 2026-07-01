//? LuckyStack-specific lint contract. Codifies framework rules into actual
//? eslint enforcement (no raw try/catch, no raw fetch, prefer framework
//? components, no arbitrary tailwind colors).
//?
//? Rules ship via the `@luckystack/core/eslint` subpath. Package-gated
//? rules probe `node_modules` at config-load time and skip silently when
//? the relevant peer is absent (e.g. you only need fetch-ban if
//? @luckystack/api is installed).

import luckystack from '@luckystack/core/eslint'

export default luckystack

//? ─────────────────────────────────────────────────────────────────────
//? Customizing rules
//? ─────────────────────────────────────────────────────────────────────
//?
//? Three ways to mute or change a rule, in order of scope:
//?
//? 1) Project-wide override — replace `export default luckystack` above
//?    with the spread form and append a config block:
//?
//?      export default [
//?        ...luckystack,
//?        {
//?          rules: {
//?            'luckystack/no-arbitrary-tailwind-color': 'off',
//?            'luckystack/prefer-luckystack-dropdown': 'error', // promote
//?          },
//?        },
//?      ]
//?
//? 2) Per-directory override — add a glob-scoped block in your top-level
//?    `eslint.config.js` (NOT this file):
//?
//?      {
//?        files: ['src/legacy/**'],
//?        rules: { 'luckystack/no-raw-try-catch': 'off' },
//?      }
//?
//? 3) Inline disable — for a single occurrence with a WHY note:
//?
//?      // eslint-disable-next-line luckystack/no-raw-fetch-in-src -- external API probe
//?      const res = await fetch('/api/external/probe')
//?
//?    Or file-level at the top: `/* eslint-disable luckystack/X -- reason */`.
//?    `eslint-comments/no-unused-disable` is enabled, so dead disables get
//?    flagged when the underlying code stops violating — they won't rot
//?    silently.
//?
//? Full rule list + behavior: docs/luckystack/ARCHITECTURE_FUNCTION_INJECTION.md
//? has the framework spec; the rule definitions themselves live in
//? `@luckystack/core/src/eslint/rules/*.ts` inside your node_modules.
