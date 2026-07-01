//? Official-plugins tier of the lint contract. Mirrors the React +
//? TypeScript + import + a11y plugins the LuckyStack framework uses.
//? Framework-specific rules live in `eslint.luckystack.config.js`.
//?
//? Both files are spread by `eslint.config.js` (the entry point).

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import reactX from 'eslint-plugin-react-x'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import eslintPluginImportX from 'eslint-plugin-import-x'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import i18next from 'eslint-plugin-i18next'
import eslintPluginComments from 'eslint-plugin-eslint-comments'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '**/*.generated.*'] },
  {
    files: ['**/*.{ts,tsx}'],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      js.configs.recommended,
      tseslint.configs.recommended,
      reactX.configs.recommended,
      eslintPluginUnicorn.configs['flat/recommended'],
      eslintPluginImportX.flatConfigs.recommended,
      eslintPluginImportX.flatConfigs.typescript,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['./tsconfig.json', './tsconfig.server.json'],
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'react': react,
      'i18next': i18next,
      'eslint-comments': eslintPluginComments,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'eslint-comments/no-unused-disable': 'error',
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          //? Framework convention: page.tsx co-exports `template` +
          //? `middleware` alongside the default component. Whitelist both.
          allowExportNames: ['template', 'middleware'],
        },
      ],
      'unicorn/filename-case': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'react/jsx-no-literals': ['warn', {
        noStrings: true,
        allowedStrings: [
          '!', '?', '-', '/', ':', ',', '(', ')', '%', '&',
          '@', '#', '$', '^', '*', '+', '=', '|', '.', '...',
          '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
          ' ', ' ', ' | ', ' • ', ' » ', ' « ', '—', '–',
          '·', ' · ', '· ', '−', // middot separators + the U+2212 minus glyph (typographic, non-translatable)
          'x', 'px', 'rem', 'em', 'ms', 's', '°',
        ],
        ignoreProps: true,
      }],
      //? Strict typing — no any, no double-cast, no object-literal as-cast.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'as',
        objectLiteralTypeAssertions: 'never',
      }],
      'no-restricted-syntax': ['error', {
        selector: 'TSAsExpression > TSAsExpression > TSUnknownKeyword',
        message: 'Avoid double-cast `x as unknown as Y` — it bypasses the type-checker. Use a runtime guard or typed boundary helper instead.',
      }],
    },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts', 'config.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'react/jsx-no-literals': 'off',
      'import-x/default': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },
)
