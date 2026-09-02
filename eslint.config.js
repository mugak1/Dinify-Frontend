// @ts-check
// ESLint flat config. Replaces the former `.eslintrc.json`: angular-eslint v22's
// scoped plugin exports only `rules` (no eslintrc `configs`), so the shared configs
// now come from the `angular-eslint` / `typescript-eslint` umbrella packages, and
// eslintrc is no longer expressible. Rule set is a 1:1 translation of the old file.
//
// Deliberately NO `processor: angular.processInlineTemplates` — the eslintrc it
// replaces did not lint inline templates either, and this repo has 65 components
// that use them. Turning that on is a lint-policy change, not part of the upgrade.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    ignores: ['projects/**/*'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-alert': 'warn',
      '@angular-eslint/prefer-standalone': 'off',
      '@angular-eslint/prefer-inject': 'off',
      // angular-eslint v22 flags any component that states
      // `ChangeDetectionStrategy.Default`, because Angular 22 made OnPush the
      // compiled default. This app pins Default explicitly to keep the upgrade
      // behaviour-preserving (see tsconfig/CLAUDE.md notes); adopting OnPush is
      // separate, deliberate work. Same opt-out spirit as the two rules above.
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {},
  },
);
