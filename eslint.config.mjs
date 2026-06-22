import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

const tsLanguageOptions = {
  parser: tsparser,
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
}

const tsRules = {
  ...tseslint.configs.recommended.rules,
  // TypeScript already resolves identifiers and module/browser globals, so the
  // base no-undef/no-unused-vars rules are redundant (and noisy) here.
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  '@typescript-eslint/no-explicit-any': 'warn',
  // Intentional lazy `require('electron')` in services (avoids circular imports).
  '@typescript-eslint/no-require-imports': 'warn',
}

export default [
  {
    ignores: ['node_modules/', 'electron/dist/', 'server/dist/', 'src/dist/', 'dist-electron/', '*.config.*'],
  },
  js.configs.recommended,
  {
    files: ['electron/**/*.ts', 'server/**/*.ts'],
    languageOptions: tsLanguageOptions,
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: tsRules,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ...tsLanguageOptions,
      parserOptions: {
        ...tsLanguageOptions.parserOptions,
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsRules,
      ...reactHooks.configs.recommended.rules,
      // Data-loading effects legitimately setState; keep visible but non-blocking.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
