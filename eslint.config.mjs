// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/src/generated/**',
      'apps/console-api/src/generated/**',
      'apps/api/prisma/migrations/**',
      'apps/web/src/routeTree.gen.ts',
      'apps/web/src/lib/api/schema.d.ts',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // docs/08 §N forbidden list + docs/14 §1
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'child_process', message: 'Forbidden in api/worker code (docs/08 §N).' },
            { name: 'node:child_process', message: 'Forbidden in api/worker code (docs/08 §N).' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='$queryRawUnsafe']",
          message: '$queryRawUnsafe is forbidden — use $queryRaw tagged templates (docs/08 E4).',
        },
        {
          selector: "MemberExpression[property.name='$executeRawUnsafe']",
          message:
            '$executeRawUnsafe is forbidden — use $executeRaw tagged templates (docs/08 E4).',
        },
        {
          selector: "Property[key.name='rejectUnauthorized'][value.value=false]",
          message:
            'Disabling TLS verification is forbidden (docs/08 §N). Pin the certificate instead.',
        },
        {
          selector: "Property[key.name='disableCSRFCheck'][value.value=true]",
          message: 'CSRF checks must stay enabled (docs/08 C2).',
        },
      ],
    },
  },
  {
    // Fastify plugin functions are conventionally async even when they only register routes.
    files: ['**/*.routes.ts', 'apps/api/src/modules/index.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    // Test harness code may spawn processes (migrations) and truncate tables; it never ships.
    files: ['**/*.test.ts', 'apps/*/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // web app: browser globals, React rules (docs/17)
    // React UI, wherever it lives: the app and the design system package it shares with the
    // owner console.
    files: [
      'apps/web/**/*.{ts,tsx}',
      'apps/console-web/**/*.{ts,tsx}',
      'packages/ui/**/*.{ts,tsx}',
    ],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh, 'jsx-a11y': jsxA11y },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Every autoFocus in this app sits inside a modal dialog, drawer or popover that traps
      // focus. WAI-ARIA asks for focus to move into a modal on open, so the rule fights the
      // correct behaviour here. Focus outside an overlay is still never auto-moved.
      'jsx-a11y/no-autofocus': 'off',
      // route files export Route objects next to components by design (TanStack Router)
    },
  },
  {
    // plain Node scripts (asset pipeline): no type information available.
    // typescript-eslint types this preset as CompatibleConfig, which does not declare
    // languageOptions, so the property is narrowed here rather than read off the loose type.
    files: ['apps/web/scripts/**/*.mjs', 'apps/site/scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      .../** @type {import('eslint').Linter.Config} */ (tseslint.configs.disableTypeChecked)
        .languageOptions,
      globals: { ...globals.node },
    },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
  {
    files: ['apps/web/src/routes/**/*.tsx', 'apps/console-web/src/app/router.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
      // TanStack Router: `throw redirect()` / `throw notFound()` are the documented control flow
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    files: [
      'apps/web/**/*.test.{ts,tsx}',
      'apps/console-web/**/*.test.{ts,tsx}',
      'apps/console-web/src/test/**/*.tsx',
      'apps/*/vitest.setup.ts',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  prettier,
);
