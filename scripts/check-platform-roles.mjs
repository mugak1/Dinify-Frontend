#!/usr/bin/env node
/**
 * Standing gate (FE-AUTH-00): no frontend module derives authority from a platform role.
 *
 * Pure, git-free, dependency-free source analysis, so the matcher is unit-testable on
 * synthetic input (`--self-test`) rather than only "the tree happens to be clean today".
 * The frontend counterpart to the backend's
 * `dinify_backend/tenancy/ambient_authority.py` + `scripts/check_ambient_authority.py`.
 *
 * WHAT THIS GUARDS. The customer JWT's `profile.roles` used to carry platform authority
 * into this app. Four production sites read it:
 *
 *   - the `/kitchen` route's `data.roles`, which `AuthGuard` genuinely gates on;
 *   - `KITCHEN_ROUTE_TOP_LEVEL_ROLES`, mirroring that policy for the redirect guard;
 *   - a `canChangeBillingDate` getter revealing a Cash payment option;
 *   - the two first-time menu-approval buttons.
 *
 * None could produce backend cross-tenant access — the backend closed that in Phase 0.5
 * PR-A, and since Closure PR 1 a platform-staff account is refused on every presented
 * customer token. What they did do is tell the next engineer that customer JWT roles are
 * a legitimate platform-authority mechanism, which is precisely how this class of thing
 * regrows. They are gone; this gate keeps them gone.
 *
 * WHY A NODE SCRIPT AND NOT A SPEC. A source scanner cannot live in this repo's Karma
 * suite: it runs in headless Chrome on the esbuild `@angular/build:karma` builder, so
 * there is no `fs`, no `require.context` (webpack-only, and the repo migrated off
 * webpack), no raw-loader, and no `preprocessors` hook. `tsconfig.spec.json` compiles
 * only `src/**\/*.spec.ts` plus `.d.ts`. A spec can assert PARSED VALUES — and
 * `app-routing.module.spec.ts` does exactly that for the route config — but it cannot
 * read an HTML template as text, which is where two of the four sites lived.
 *
 * WHAT THIS DOES NOT GUARD. It is a source-text check, not a proof. It cannot tell that
 * a NEW predicate spelled differently confers platform authority, and it says nothing
 * about tenant scoping generally — that is `_security/tenant-isolation-closure.spec.ts`'s
 * job. What it proves is that the specific retired vocabulary has not come back by name.
 *
 * SCOPE. Every `.ts` and `.html` file under `src/`, except this script (which must spell
 * the forbidden names to look for them) and the spec fixtures that assert the gate
 * itself fires. Specs are otherwise IN scope, unlike the backend gate's exclusion: a
 * frontend spec assering a platform role admits is a spec pinning the wrong behaviour.
 *
 * Unlike a shrinking baseline this is a flat zero-tolerance check — the tree is clean,
 * so `ALLOWLIST` starts empty and should stay that way. It is PERMANENT, not
 * self-terminating: there is no future state in which the customer plane's `profile.roles`
 * becomes an acceptable platform-authority signal.
 *
 * Usage (no build, no deps):
 *
 *     node scripts/check-platform-roles.mjs              # scan the tree
 *     node scripts/check-platform-roles.mjs --self-test  # prove the matcher fires
 *
 * Exit 0 if clean, 1 if any violation is found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/**
 * The retired platform-role values. A bare literal anywhere in `src/` means someone is
 * either granting or hand-rolling platform identity in an app that, since PR-6, has no
 * code path that can authenticate an administrator at all.
 */
export const PLATFORM_ROLE_LITERALS = ['dinify_admin', 'dinify_account_manager'];

/**
 * Reads of the customer profile's `roles` used as an authority decision.
 *
 * Deliberately narrow: it matches `profile.roles` (optional-chained or not) followed by
 * a membership test — `.includes(...)`, `.some(...)`, `.indexOf(...)`. That is the shape
 * every removed site had.
 *
 * It does NOT match `currentRestaurantRole?.roles` or `restaurant_roles[].roles`, which
 * are the RESTAURANT role arrays and remain the correct, load-bearing authority signal —
 * the `/kitchen` route, the redirect guard and the menu-approval buttons all still read
 * them. The distinction is the SOURCE, not the field name: `profile.roles` is the
 * account-level array that used to carry platform strings.
 */
const PROFILE_ROLES_AUTHORITY = /profile\??\.\s*roles\s*\??\.?\s*(?:includes|some|indexOf)\s*\(/;

/** Extensions worth scanning. Templates matter — two removed sites were in HTML. */
const SCANNED_EXTENSIONS = ['.ts', '.html'];

/** Never descend into these. */
const PRUNE_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage', 'out-tsc']);

/**
 * Files entitled to spell the forbidden names.
 *
 * This script has to, in order to search for them. The ratchet's own spec has to, in
 * order to prove the matcher fires on synthetic input. Nothing else does — note that
 * ordinary specs are NOT exempt: a spec asserting a platform role grants access is
 * pinning behaviour this gate exists to prevent.
 */
const SELF_EXEMPT = new Set([
  'scripts/check-platform-roles.mjs',
  'src/app/_security/platform-role-ratchet.spec.ts',
]);

/**
 * Deliberate, reviewed exceptions: {'relative/path': ['NAME', ...]}.
 *
 * EMPTY, AND MEANT TO STAY THAT WAY. There is no legitimate reason for this app to name
 * a platform role or branch on `profile.roles`. If you are about to add an entry, the
 * thing to examine is the code, not this object.
 */
export const ALLOWLIST = Object.create(null);

/**
 * Return `[{line, name, reason}]` for one file's source.
 *
 * Split from the filesystem walk on purpose: it is what lets the spec feed synthetic
 * source and prove the gate actually fires, rather than only that the tree is currently
 * clean. Same seam as the backend's `find_violations_in_source`.
 */
export function findViolationsInSource(source, relativePath) {
  const allowed = new Set(ALLOWLIST[relativePath] ?? []);
  const violations = [];

  source.split('\n').forEach((text, index) => {
    const line = index + 1;

    for (const literal of PLATFORM_ROLE_LITERALS) {
      if (text.includes(literal) && !allowed.has(literal)) {
        violations.push({
          line,
          name: literal,
          reason:
            'hard-codes a platform-only role string; this app cannot authenticate an ' +
            'administrator, and profile.roles carries restaurant roles only',
        });
      }
    }

    if (PROFILE_ROLES_AUTHORITY.test(text) && !allowed.has('profile.roles')) {
      violations.push({
        line,
        name: 'profile.roles',
        reason:
          'derives authority from the account-level roles array; gate on the ' +
          'membership roles (currentRestaurantRole / restaurant_roles) instead',
      });
    }
  });

  return violations;
}

/** Yield every scannable file under `root`, as repo-relative POSIX paths. */
export function* iterScannedFiles(root = SRC_ROOT) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir).sort()) {
      if (PRUNE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
      const rel = relative(REPO_ROOT, full).split(sep).join('/');
      if (SELF_EXEMPT.has(rel)) continue;
      yield rel;
    }
  }
}

/** Return `[{file, line, name, reason}]` across the whole frontend source tree. */
export function findViolations() {
  const found = [];
  for (const rel of iterScannedFiles()) {
    const source = readFileSync(join(REPO_ROOT, rel), 'utf8');
    for (const v of findViolationsInSource(source, rel)) found.push({ file: rel, ...v });
  }
  return found;
}

/** Human-readable report lines (empty when clean). */
export function formatViolations(violations) {
  if (!violations.length) return [];
  const lines = [
    'Platform-role gate: FAIL — the frontend must not derive authority from a ' +
      'platform role:',
    '',
  ];
  for (const { file, line, name, reason } of violations) {
    lines.push(`  ${file}:${line}: ${name} — ${reason}`);
  }
  lines.push(
    '',
    `${violations.length} violation(s). Platform staff live at admin.dinifyapp.com and ` +
      'cannot authenticate here; restaurant authority comes from the membership roles.',
  );
  return lines;
}

/**
 * Prove the matcher fires, on synthetic source, without touching the tree.
 *
 * A gate that has only ever been observed passing is not evidence of anything: it may
 * match nothing at all. Each case below is a violation this gate exists to catch, plus
 * the near-misses it must NOT catch — the restaurant-role reads that are correct and
 * load-bearing.
 */
function selfTest() {
  const cases = [
    ['literal in a route config', "data:{roles:['dinify_admin']}", 1],
    ['the other literal', "const R = ['dinify_account_manager'];", 1],
    ['literal in a template', "@if (x?.includes('dinify_admin')) {", 2], // literal + profile-less .includes? no
    ['profile.roles authority read', 'return this.auth.userValue?.profile.roles.includes(r);', 1],
    ['optional-chained profile.roles', 'auth.userValue?.profile?.roles?.includes(x)', 1],
    ['profile.roles via some()', 'const ok = user.profile.roles.some(f);', 1],
    ['clean restaurant-role read', "auth.currentRestaurantRole?.roles?.includes('owner')", 0],
    ['clean membership scan', 'rr.roles?.some((role) => ALLOWED.includes(role))', 0],
    ['clean unrelated code', 'const roles = membership.roles ?? [];', 0],
  ];

  let failures = 0;
  for (const [label, source, expected] of cases) {
    const got = findViolationsInSource(source, 'synthetic.ts').length;
    // The template case yields the literal only; assert "at least one" for positives
    // and "exactly zero" for negatives, so the count stays robust to a matcher that
    // legitimately reports one line twice.
    const ok = expected === 0 ? got === 0 : got >= 1;
    if (!ok) {
      failures += 1;
      console.error(
        `  self-test FAIL: ${label} — expected ${expected === 0 ? 'no' : 'a'} ` +
          `violation, got ${got}`,
      );
    }
  }

  if (failures) {
    console.error(`\nPlatform-role gate self-test: ${failures} case(s) failed.`);
    return 1;
  }
  console.log(`Platform-role gate self-test: OK — ${cases.length} cases, matcher fires.`);
  return 0;
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const violations = findViolations();
  if (violations.length) {
    for (const line of formatViolations(violations)) console.log(line);
    return 1;
  }
  const scanned = [...iterScannedFiles()].length;
  console.log(
    `Platform-role gate: OK — scanned ${scanned} source file(s), no platform-role ` +
      'authority.',
  );
  return 0;
}

process.exit(main());
