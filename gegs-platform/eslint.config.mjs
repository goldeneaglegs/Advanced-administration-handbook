import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from '@next/eslint-plugin-next';

// Flat config. `eslint-config-next`'s legacy entry point loads
// @rushstack/eslint-patch, which fails under ESLint 9 flat config, so the Next
// rules come from the plugin's own flat config instead.
//
// Type-aware linting (`projectService`) is deliberately not enabled: `tsc
// --noEmit` already gates types in its own step, and turning it on here would
// mean every config and script file needed a tsconfig entry for no added
// coverage.
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  next.flatConfig.coreWebVitals,
  {
    rules: {
      // Phase 1 §6.2: server logs must not accumulate personal data, so writing
      // to stdout is a deliberate, reviewed act rather than a convenience.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          // Phase 1 §3.4: offset pagination silently skips and duplicates rows
          // under concurrent writes, which in a work queue means a candidate
          // vanishes from a consultant's list. Cursor pagination only.
          selector:
            "CallExpression[callee.property.name=/^(findMany|findFirst)$/] Property[key.name='skip']",
          message: 'Offset pagination is forbidden (Phase 1 §3.4). Use cursor pagination.',
        },
      ],
    },
  },
  {
    // Tests legitimately assert on thrown values and mutate process.env.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  {
    // Build-time gates run under plain Node, outside the bundler.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
);
