import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import reactX from 'eslint-plugin-react-x' // Import react-x plugin
// No need to import react-dom here

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Replace ...tseslint.configs.recommended with this for strict type checking
      ...tseslint.configs.strictTypeChecked,
      // Optionally add stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // From eslint-plugin-react-x
      js.configs.recommended,
      tseslint.configs.recommended,
      reactX.configs.recommended, // Add react-x plugin's recommended configuration
      // No need to add react-dom.configs.recommended again, it's redundant
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      // Removed react-x from plugins since it's already handled by extends
      // Removed react-dom here since it's already handled by extends
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // You can add specific custom rules for react-x or react-dom here if necessary
    },
  },
  {
    files: [
      'src/**/*api/**/*.ts', 
      'src/**/*Api/**/*.ts', 
      'src/**/*sync/**/*.ts',
      'src/**/*Sync/**/*.ts'
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
)
//npx eslint src/**/*.tsx
// ctrl + shift + p -> Restart TS server