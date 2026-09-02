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
      // angular-eslint v22 flags any component that states an eager strategy,
      // because Angular 22 made OnPush the compiled default. This app states
      // `ChangeDetectionStrategy.Eager` explicitly to keep the upgrade
      // behaviour-preserving; adopting OnPush is separate, deliberate work.
      // Same opt-out spirit as the two rules above.
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
      // ...and the other half of that decision: an OMITTED `changeDetection` is
      // silently OnPush in v22 (`decl.changeDetection ?? OnPush` in the
      // compiler). Nothing else reports it — it type-checks, lints and builds
      // clean, then fails to re-render at runtime. This makes the CLAUDE.md
      // rule mechanical. `> Property` is deliberate: a plain `:has(Property…)`
      // would also match a `changeDetection` key nested in some inner object.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Decorator > CallExpression[callee.name="Component"] > ObjectExpression:not(:has(> Property[key.name="changeDetection"]))',
          message:
            'Every @Component must state `changeDetection` explicitly: Angular 22 compiles an omitted field as OnPush. Use ChangeDetectionStrategy.Eager to preserve pre-22 behaviour.',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {},
  },
);
