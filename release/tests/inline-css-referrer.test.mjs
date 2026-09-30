/**
 * THE ENTRY DOCUMENT CARRIES NO INLINE CSS (D14 B3) — so the approved Referrer-Policy
 * governs every request a QR entry makes.
 *
 * A diner arrives on `/diner/h/<table>?c=<credential>`. The app strips `?c=` only once
 * Angular has booted, and the browser lays out the empty document well before that.
 * Measured in Chromium 141 (D14 B3, local and synthetic): a subresource referenced from
 * INLINE CSS — a `<style>` element or a `style=""` attribute — is fetched under the
 * browser's DEFAULT policy, `strict-origin-when-cross-origin`, whatever the document's
 * own policy says (header or `<meta>`, even `no-referrer`). A same-origin request under
 * that default carries the full URL. Critical-CSS inlining put the Plus Jakarta Sans
 * `@font-face` rules into an inline `<style>`, so the font request carried the whole
 * entry URL, credential included, as its Referer. The same rules in the linked
 * stylesheet are fetched under that stylesheet's own response policy, the approved
 * `strict-origin`, and send only the origin.
 *
 * So the shipping configuration, and production beside it, keep inlining OFF, and the
 * source entry document holds no inline CSS of its own. This asserts configuration and
 * source, never what a browser or the production CDN does: that was measured, not
 * modelled, and the measurements are summarised in the pull request that added this file.
 *
 * It does NOT make the credential confidential. It still reaches the hosting origin in
 * the document request itself, stays in the navigation timing entry and the browser's
 * history, and lives in session storage by design. Only a change of QR transport
 * addresses those, and that is a separate decision.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { ROOT } from './harness.mjs';
import { POLICY } from './fixtures.mjs';

const ANGULAR = JSON.parse(readFileSync(join(ROOT, 'angular.json'), 'utf8'));
const INDEX = readFileSync(join(ROOT, 'src/index.html'), 'utf8');
const project = Object.values(ANGULAR.projects)[0];
const configuration = (name) => project.architect.build.configurations[name];

/**
 * The configuration that ships (read from the release policy, so a later change of
 * shipping configuration is guarded without editing this file), and production, which
 * CI builds beside it.
 */
const GUARDED = Object.freeze([POLICY.build.configuration, 'production']);

describe('critical-CSS inlining stays off where it would ship', () => {
  for (const name of GUARDED) {
    test(`REGRESSION: \`${name}\` sets optimization.styles.inlineCritical to false, explicitly`, () => {
      const c = configuration(name);
      assert.ok(c, `angular.json has a \`${name}\` configuration`);
      // Absent is NOT off: with style optimization on, Angular inlines critical CSS by default.
      assert.equal(typeof c.optimization, 'object', `\`${name}\` states its optimization options`);
      assert.equal(typeof c.optimization.styles, 'object', `\`${name}\` states its style optimization options`);
      assert.equal(c.optimization.styles.inlineCritical, false);
    });
    test(`CONTROL: \`${name}\` still minifies styles and leaves font inlining off`, () => {
      const c = configuration(name);
      assert.equal(c.optimization.styles.minify, true);
      assert.equal(c.optimization.fonts, false);
    });
  }
});

describe('the source entry document carries no inline CSS', () => {
  test('GUARD: src/index.html has no <style> element', () => {
    assert.doesNotMatch(INDEX, /<style[\s>]/i);
  });
  test('GUARD: src/index.html has no style="" attribute', () => {
    assert.doesNotMatch(INDEX, /\sstyle\s*=/i);
  });
  test('CONTROL: the entry document still loads the app', () => {
    assert.match(INDEX, /<app-root>\s*<\/app-root>/);
    assert.match(INDEX, /<base href="\/">/);
  });
});
