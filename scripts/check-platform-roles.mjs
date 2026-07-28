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
 * WHAT IT NOW GUARANTEES. Because Closure PR 1 removed every legitimate production read,
 * the gate no longer has to recognise authority SYNTAX. It rejects ANY runtime access to
 * `profile.roles` under `src/` — property (`profile.roles`, `profile?.roles`), bracket
 * (`profile['roles']`, `profile?.['roles']`) and destructured (`const {roles} =
 * user.profile`). That is a simpler rule and a strictly stronger guarantee than the
 * membership-test regex it replaced, which matched only `.includes/.some/.indexOf` and
 * so would have missed the obvious alias:
 *
 *     const accountRoles = user.profile.roles;
 *     return accountRoles.includes('owner');
 *
 * There is no pattern left to outrun by spelling the read differently.
 *
 * WHAT IT STILL DOES NOT GUARD. It is a source-text check, not semantic analysis, and
 * three holes follow from that directly. A two-step alias through the profile OBJECT
 * (`const p = user.profile; return p.roles;`) never spells the banned pair on any line.
 * A value obtained from an API response under another name is outside its reach
 * entirely. And a destructure split across lines escapes the line-oriented matcher. It
 * also says nothing about tenant scoping generally — that is
 * `_security/tenant-isolation-closure.spec.ts`'s job. What it proves is that the
 * account-level array is not read, by any of its spellable names, in code that runs.
 *
 * COMMENTS ARE NOT RUNTIME ACCESS, and the matcher now knows the difference. Four
 * production files carry tombstone comments naming `profile.roles` to record why the
 * branch was removed — including `_helpers/auth.guard.ts`, the file that enforces route
 * authority. Allowlisting them was the alternative and it is much worse than it looks:
 * `ALLOWLIST` is file+name scoped, so exempting `auth.guard.ts` would blind the gate to
 * a REAL read in the one file where it matters most. That is the same trap commit
 * 52e3c90 avoided by removing `AuthGuard.hasTopLevelRole` rather than allowlisting it.
 * So `stripComments` blanks `//` and block comments in `.ts` and `<!-- -->` in `.html`
 * before the access rules run. It is a lexical approximation: it understands string and
 * template literals (so a `//` inside a URL is not a comment start) but not regex
 * literals, so a `//` inside a regex could over-blank the rest of that line.
 *
 * THE TWO RULES ASK DIFFERENT QUESTIONS, which is why only one of them strips comments.
 * The literal rule asks "does this string appear anywhere at all" — a retired role name
 * has no business in this source in any form, comment included — so it still runs on the
 * raw line. The access rule asks "does this code run". Contents of string literals stay
 * in scope for both.
 *
 * SCOPE. Every `.ts` and `.html` file under `src/`, except this script (which must spell
 * the forbidden names to look for them) and the spec fixtures that assert the gate
 * itself fires. Specs are otherwise IN scope, unlike the backend gate's exclusion: a
 * frontend spec assering a platform role admits is a spec pinning the wrong behaviour.
 * No other exemption exists or is needed: the `Profile.roles` TYPE DECLARATION
 * (`src/app/_models/app.models.ts`) is written `roles: string[]` and spec fixtures build
 * nested literals (`profile: { … roles: [] … }`), so neither spells the banned pair.
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
 * Any runtime read of the customer profile's account-level `roles` array.
 *
 * Three spellings, because the rule is "do not read it" rather than "do not branch on
 * it": property access, bracket access, and destructuring off a `.profile`. There is
 * deliberately no membership-test suffix — requiring `.includes(...)` was what let the
 * previous regex be defeated by assigning the array to a local first.
 *
 * None of them match `currentRestaurantRole?.roles` or `restaurant_roles[].roles`, which
 * are the RESTAURANT role arrays and remain the correct, load-bearing authority signal —
 * the `/kitchen` route, the redirect guard and the menu-approval buttons all still read
 * them. The distinction is the SOURCE, not the field name: `profile.roles` is the
 * account-level array that used to carry platform strings.
 *
 * The destructure rule anchors its right-hand side to END at `profile`, so
 * `const { roles } = getProfile(user);` and `const { roles } = route.data;` do not
 * false-positive. `\bprofile` likewise keeps `getProfile.roles` out — there is no word
 * boundary inside an identifier.
 */
const PROFILE_ROLES_RULES = [
  /\bprofile\s*\??\.\s*roles\b/,
  /\bprofile\s*(?:\?\.)?\s*\[\s*(['"`])roles\1\s*\]/,
  /\{[^{}]*\broles\b[^{}]*\}\s*=\s*[\w$?.]*\bprofile\s*;?\s*$/,
];

/**
 * Blank every comment span in `source`, preserving length and line structure.
 *
 * Length-preserving so reported line numbers stay the file's own, and newlines are never
 * blanked so `split('\n')` still lines up. Comments become spaces rather than being
 * deleted.
 *
 * `.ts` recognises `//` and `/* … *\/` (stateful across lines, so JSDoc is covered) and
 * tracks `'`, `"` and template literals with escapes, so a `//` inside a string is not
 * read as a comment start — without that, `const u = 'http://x'; return p.profile.roles;`
 * would be silently missed, and a gate whose whole claim is "nothing left to outrun"
 * must not ship that. `.html` recognises `<!-- … -->` ONLY: `//` in a template is a
 * protocol-relative URL, and quote-tracking there would swallow ordinary prose from the
 * first apostrophe onward.
 */
export function stripComments(source, relativePath) {
  const html = relativePath.endsWith('.html');
  const out = source.split('');
  const blank = (from, count) => {
    for (let k = from; k < from + count; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  let state = 'code'; // 'code' | 'line' | 'block' | 'html' | a quote character
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (state === 'code') {
      if (html && source.startsWith('<!--', i)) {
        state = 'html';
        blank(i, 4);
        i += 4;
      } else if (!html && ch === '/' && source[i + 1] === '/') {
        state = 'line';
        blank(i, 2);
        i += 2;
      } else if (!html && ch === '/' && source[i + 1] === '*') {
        state = 'block';
        blank(i, 2);
        i += 2;
      } else if (!html && (ch === "'" || ch === '"' || ch === '`')) {
        state = ch;
        i += 1;
      } else {
        i += 1;
      }
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') state = 'code';
      else out[i] = ' ';
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && source[i + 1] === '/') {
        state = 'code';
        blank(i, 2);
        i += 2;
      } else {
        blank(i, 1);
        i += 1;
      }
      continue;
    }

    if (state === 'html') {
      if (source.startsWith('-->', i)) {
        state = 'code';
        blank(i, 3);
        i += 3;
      } else {
        blank(i, 1);
        i += 1;
      }
      continue;
    }

    // Inside a string literal; `state` is the opening quote.
    if (ch === '\\') {
      i += 2;
    } else if (ch === state) {
      state = 'code';
      i += 1;
    } else if (ch === '\n' && state !== '`') {
      // Only a template literal spans lines; an unterminated quote ends at the newline
      // rather than swallowing the rest of the file.
      state = 'code';
      i += 1;
    } else {
      i += 1;
    }
  }

  return out.join('');
}

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

  // Two passes over the same lines by index: the literal rule reads the file as written,
  // the access rule reads only the code. See the docstring — they ask different
  // questions, so they are deliberately not fed the same text.
  const raw = source.split('\n');
  const code = stripComments(source, relativePath).split('\n');

  raw.forEach((text, index) => {
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

    if (
      !allowed.has('profile.roles') &&
      PROFILE_ROLES_RULES.some((rule) => rule.test(code[index]))
    ) {
      // One report per line however many spellings matched — the finding is the line,
      // not the syntax.
      violations.push({
        line,
        name: 'profile.roles',
        reason:
          'reads the account-level roles array at runtime; it carries restaurant ' +
          'roles only, and authority comes from the membership roles ' +
          '(currentRestaurantRole / restaurant_roles)',
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
  // [label, source, expected, path?] — `path` defaults to a .ts file; pass a .html one
  // to exercise the template comment syntax.
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

    // --- The evasions the membership-test regex could not see. These are what the
    // --- broadened rule exists for; each one exits 0 under the old pattern set.
    ['aliased read, then tested elsewhere', 'const accountRoles = user.profile.roles;', 1],
    ['bare read with no test at all', 'return this.auth.userValue.profile.roles;', 1],
    ['bracket access', "const r = user.profile['roles'];", 1],
    ['double-quoted bracket access', 'const r = user.profile["roles"];', 1],
    ['optional-chained bracket access', "if (u?.profile?.['roles'].length) {", 1],
    ['destructured off a profile', 'const { roles } = user.profile;', 1],
    ['destructured off an optional-chained profile', 'const { roles } = user?.profile', 1],
    ['destructured alongside other keys', 'const { id, roles } = this.auth.userValue.profile;', 1],

    // --- Near-misses the broadened rule must NOT catch. Every one of these is real
    // --- code in the tree; a false positive here is a broken build, not a nuisance.
    ['destructured off route data', 'const { roles, restaurant_roles } = route.data;', 0],
    ['destructured off a call, not a profile', 'const { roles } = getProfile(user);', 0],
    ['a profile-shaped fixture literal', "profile: { id: '1', roles: [], restaurant_roles: [] }", 0],
    ['the Profile interface declaration', '  roles: string[]', 0],
    ['restaurant_roles read on a profile', '(user.profile?.restaurant_roles ?? []).some(f)', 0],
    ['an identifier merely ending in profile', 'return getProfile.roles;', 0],

    // --- Comments are not runtime access. The first four are the exact tombstones in
    // --- the tree; without comment stripping the broadened rule fails on the clean
    // --- repo, and the only alternative is allowlisting the guard that enforces routes.
    ['line comment naming the field', '// NOTE there is deliberately no `profile.roles` branch here.', 0],
    ['trailing line comment', 'const x = 1; // profile.roles went with the vocabulary', 0],
    ['block comment', '/* profile.roles is the ACCOUNT-level array */', 0],
    ['jsdoc line inside a block comment', ' * gate on profile.roles instead', 0, 'synthetic-jsdoc.ts'],
    ['html comment', '<!-- profile.roles is gone -->', 0, 'synthetic.html'],
    ['// inside an html attribute is not a comment', '<a href="//cdn/x">{{ u.profile.roles }}</a>', 1, 'synthetic.html'],

    // --- ...but a comment must not blank real code that follows it.
    ['// inside a string does not hide a later read', "const u = 'http://x'; return p.profile.roles;", 1],
    ['read before a comment on the same line', 'return u.profile.roles; // the account array', 1],
    ['read after a closed block comment', '/* note */ return u.profile.roles;', 1],
  ];

  let failures = 0;
  for (const [label, source, expected, path] of cases) {
    const wrapped =
      path === 'synthetic-jsdoc.ts' ? `/**\n${source}\n */` : source;
    const got = findViolationsInSource(wrapped, path ?? 'synthetic.ts').length;
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
