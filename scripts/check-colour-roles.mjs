#!/usr/bin/env node
/**
 * Standing gate (COLOUR-ROLES-00): in the restaurant portal, brand red means ACT or
 * nothing.
 *
 * Pure, dependency-free source analysis, so the matcher is unit-testable on synthetic
 * input (`--self-test`) rather than only "the tree happens to be clean today". Modelled
 * on `scripts/check-platform-roles.mjs`.
 *
 * WHAT THIS GUARDS. Brand red (`primary` / `d-red`, #FF2C32) used to paint hover,
 * selection, switches, focus, prices, links, decorative icons and neutral labels, so
 * nothing on a portal screen read as most important. Each colour now has one job:
 *
 *   act        brand red  — the one primary action per view, plus the 3px
 *                           "you are here" marker (sidebar, section rail, team rail)
 *   danger     --destructive (#B81E1E) — delete/revoke, errors, invalid, asterisks
 *   selected   --selected (#171717 ink) — chosen segment, chip, day, switch, checkbox
 *   hover      --accent (#F5F5F5) — every neutral hover/pressed surface
 *   focus      --ring (ink) — every focus ring
 *   status     green/amber/grey tints with dark text
 *   info       text-foreground — prices, links, counts, decorative icons
 *
 * The role table lives in CLAUDE.md → Styling Rules. This gate catches the four ways
 * brand red regrows in a template, each as its own rule so a failure says WHICH role was
 * borrowed:
 *
 *   R1  brand red under a state variant (hover/active/focus/…) — hover is grey and
 *       focus is ink; only the shared primary button's own hover may darken red.
 *   R2  brand-red tints and outlines (`bg-primary/10`, `border-primary`, `ring-d-red`,
 *       `accent-primary`, `bg-d-red-soft`) — every one of these was a "selected" or
 *       "status" look drawn in red.
 *   R3  brand-red text — prices, links, counts and icons are information (ink); error
 *       text is `text-destructive`.
 *   R4  a solid brand-red fill — allowed only in the reviewed files that draw the one
 *       action or the location marker.
 *
 * WHY A NODE SCRIPT AND NOT A SPEC. Same reason as the platform-role gate: Karma runs
 * in headless Chrome on the esbuild `@angular/build:karma` builder, with no `fs`, no
 * `require.context` and no raw-loader, so no spec can read an HTML template as text —
 * and templates are where almost every one of these classes lives.
 *
 * MATCHING. Comments are blanked first (`<!-- -->` in HTML, `//` and `/* *\/` in TS,
 * string-aware), so a comment that NAMES a banned class to explain its removal does not
 * fail the build. A class is matched as a whole TOKEN: it must not be preceded by a
 * letter, digit, `_` or `-`, and must not be followed by one, so `text-primary-foreground`
 * (white text ON red, which is the button's own job) and `bg-primary-hover` never match,
 * while `[class.bg-primary/10]` and `'bg-primary text-white'` do. Variant prefixes
 * (`sm:`, `hover:`, `file:`, `has-[:checked]:`) are read as part of the token.
 *
 * WHAT IT DOES NOT GUARD. It is source text, not semantics. A colour assembled at runtime
 * (`'bg-' + colour`), an inline `style`, a raw hex, or a CSS file is outside its reach.
 * `fill-*` / `stroke-*` are not checked. And it reads only the IN-SCOPE files listed in
 * `SCOPE` below: the diner app, the kitchen board, the Menu preview components (which
 * mimic the diner brand), the parked Tables service view and the other auth screens keep
 * their own brand red by design and are not scanned.
 *
 * Usage (no build, no deps):
 *
 *     node scripts/check-colour-roles.mjs              # scan the in-scope tree
 *     node scripts/check-colour-roles.mjs --self-test  # prove the matcher fires
 *
 * Exit 0 if clean, 1 if any violation is found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The in-scope files: the restaurant portal plus the shared pieces it consumes.
 * `include` entries are repo-relative directory or file prefixes; `exclude` entries are
 * matched against the file name (the out-of-scope components keep brand red on purpose).
 */
export const SCOPE = {
  include: [
    'src/app/restaurant-mgt/',
    'src/app/_shared/ui/button/',
    'src/app/_shared/ui/segmented/',
    'src/app/_shared/ui/switch/',
    'src/app/_shared/ui/badge/',
    'src/app/_shared/ui/toast/',
    'src/app/_shared/timeframe/',
    'src/app/_shared/tags/menu-item-tag-selector.component.',
    'src/app/_shared/support/support-meta.ts',
    'src/app/_common/confirm-dialog/',
    'src/app/_models/app.models.ts',
    'src/app/auth/forgot-password/forgot-password.component.html',
  ],
  exclude: [
    // Menu preview — mimics the diner app's brand on purpose.
    'preview-menu-drawer',
    'item-detail-view',
    'tag-filter-sheet',
    'upsell-carousel',
    'upsell-preview-modal',
    // The parked (hidden) Tables service view.
    'tables-service-view',
    'floor-plan-canvas',
    'reservations-pane',
    'table-details-drawer',
    'service-toolbar',
    'transfer-table-modal',
    'new-reservation-modal',
  ],
};

/** Utility properties that can carry a brand-red colour. */
const PROPERTIES = 'bg|text|border|ring|accent|outline';

/** The brand-red colour names. `d-red-soft` first so the alternation takes the longest. */
const BRAND = 'd-red-soft|d-red|primary';

/**
 * One brand-red class token, with any variant prefixes and an opacity suffix.
 *
 * Groups: 1 = the variant prefix chain (`hover:`, `sm:file:`, …), 2 = property,
 * 3 = colour, 4 = opacity suffix (`/10`, `/[0.13]`).
 *
 * The lookbehind/lookahead are the whole TOKEN BOUNDARY: `-` counts as part of a word,
 * which is what keeps `text-primary-foreground` and `bg-primary-hover` out.
 */
const TOKEN = new RegExp(
  String.raw`(?<![\w-])((?:[\w-]+(?:\[[^\]\s]*\])?:)*)(${PROPERTIES})-(${BRAND})(\/(?:\d+|\[[^\]\s]+\]))?(?![\w-])`,
  'g',
);

/** Variants that mean "this is a state", which R1 reserves for grey/ink. */
const STATE_VARIANTS = new Set([
  'hover',
  'desktop-hover',
  'group-hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
]);

export const RULES = {
  R1: 'brand red under a state variant — hover is grey (--accent), focus is ink (--ring)',
  R2: 'brand-red tint or outline — a chosen value is --selected, a status is its own tint, danger is --destructive',
  R3: 'brand-red text — prices, links, counts and icons are ink; errors are text-destructive',
  R4: 'solid brand-red fill outside the reviewed act/marker files — the one action per view uses the shared primary button',
};

/** Classify one matched token into a rule id. */
export function classify(prefix, property, colour, opacity) {
  const variants = prefix.split(':').filter(Boolean);
  if (variants.some((v) => STATE_VARIANTS.has(v))) return 'R1';
  if (colour === 'd-red-soft') return 'R2';
  if (property === 'text') return 'R3';
  if (property === 'bg') return opacity ? 'R2' : 'R4';
  return 'R2'; // border / ring / outline / accent, solid or tinted
}

/**
 * Deliberate, reviewed exceptions. Keep it as small as possible: each entry exempts ONE
 * rule in ONE file, and says why.
 */
export const ALLOWLIST = [
  {
    file: 'src/app/_shared/ui/button/button.component.ts',
    rule: 'R1',
    reason: "the primary button's own hover (hover:bg-primary/90) is the act colour darkening",
  },
  {
    file: 'src/app/_shared/ui/button/button.component.ts',
    rule: 'R4',
    reason: 'the default and cta variants ARE the one primary action',
  },
  {
    file: 'src/app/restaurant-mgt/layout/sidebar/sidebar.component.html',
    rule: 'R3',
    reason: 'the active nav icon is part of the reference "you are here" marker',
  },
  {
    file: 'src/app/restaurant-mgt/layout/sidebar/sidebar.component.html',
    rule: 'R4',
    reason: 'the 3px "you are here" bar',
  },
  {
    file: 'src/app/restaurant-mgt/menu/components/section-rail/section-rail.component.html',
    rule: 'R4',
    reason: 'the open section\'s 3px "you are here" bar',
  },
  {
    file: 'src/app/restaurant-mgt/settings/team/team-shell.component.html',
    rule: 'R4',
    reason: 'the active Team link\'s "you are here" bar (3px left, 2px under on phones)',
  },
  {
    file: 'src/app/restaurant-mgt/reviews/overview/reviews-overview.component.ts',
    rule: 'R4',
    reason: 'the "View all reviews" CTA is a hand-rolled anchor (the button selector matches only <button>)',
  },
  {
    file: 'src/app/restaurant-mgt/rest-notifications/rest-notifications.component.html',
    rule: 'R4',
    reason: 'the unread dot',
  },
  {
    file: 'src/app/_common/confirm-dialog/confirm-dialog.component.ts',
    rule: 'R4',
    reason: 'the warning/neutral submit is the dialog\'s one primary action (submitToneClass)',
  },
  {
    file: 'src/app/_common/confirm-dialog/confirm-dialog.component.html',
    rule: 'R3',
    reason: "the 'warning' tone's triangle renders exactly as before (inactivity notice)",
  },
  {
    file: 'src/app/auth/forgot-password/forgot-password.component.html',
    rule: 'R1',
    reason: "the auth screens' input focus is the sign-in design; only the two radios are in scope here",
  },
  {
    file: 'src/app/auth/forgot-password/forgot-password.component.html',
    rule: 'R4',
    reason: 'its hand-rolled submit buttons are each step\'s one action',
  },
];

/**
 * Blank every comment span in `source`, preserving length and line structure, so line
 * numbers stay the file's own. Same lexer as `check-platform-roles.mjs`: `.ts` knows
 * `//`, block comments and string/template literals; `.html` knows `<!-- -->` only.
 */
export function stripComments(source, relativePath) {
  const html = relativePath.endsWith('.html');
  const out = source.split('');
  const blank = (from, count) => {
    for (let k = from; k < from + count; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  let state = 'code';
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
    if (state === 'block' || state === 'html') {
      const close = state === 'block' ? '*/' : '-->';
      if (source.startsWith(close, i)) {
        state = 'code';
        blank(i, close.length);
        i += close.length;
      } else {
        blank(i, 1);
        i += 1;
      }
      continue;
    }
    // Inside a string literal; `state` is the opening quote. An inline component
    // template is a template literal, so its HTML comments are NOT blanked — which is
    // why `findViolationsInSource` also blanks `<!-- -->` inside .ts files below.
    if (ch === '\\') {
      i += 2;
    } else if (ch === state) {
      state = 'code';
      i += 1;
    } else if (ch === '\n' && state !== '`') {
      state = 'code';
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** Blank `<!-- -->` spans (length-preserving) — for inline templates inside .ts files. */
function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Return `[{line, rule, token}]` for one file's source. */
export function findViolationsInSource(source, relativePath) {
  let code = stripComments(source, relativePath);
  if (relativePath.endsWith('.ts')) code = stripHtmlComments(code);
  const allowed = new Set(
    ALLOWLIST.filter((a) => a.file === relativePath).map((a) => a.rule),
  );
  const violations = [];
  code.split('\n').forEach((text, index) => {
    for (const m of text.matchAll(TOKEN)) {
      const [token, prefix, property, colour, opacity] = m;
      const rule = classify(prefix, property, colour, opacity);
      if (!allowed.has(rule)) violations.push({ line: index + 1, rule, token });
    }
  });
  return violations;
}

/** Whether a repo-relative path is in the gate's scope. */
export function inScope(rel) {
  if (!rel.endsWith('.ts') && !rel.endsWith('.html')) return false;
  if (rel.endsWith('.spec.ts')) return false;
  if (!SCOPE.include.some((p) => rel.startsWith(p))) return false;
  const name = rel.split('/').pop();
  return !SCOPE.exclude.some((x) => name.includes(x));
}

/** Yield every in-scope file under `src/app`, as repo-relative POSIX paths. */
export function* iterScannedFiles(root = join(REPO_ROOT, 'src', 'app')) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
        continue;
      }
      const rel = relative(REPO_ROOT, full).split(sep).join('/');
      if (inScope(rel)) yield rel;
    }
  }
}

/** Return `[{file, line, rule, token}]` across the in-scope tree. */
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
  const lines = ['Colour-roles gate: FAIL — brand red is borrowed for a job that is not "act":', ''];
  for (const { file, line, rule, token } of violations) {
    lines.push(`  ${file}:${line}: ${rule} ${token} — ${RULES[rule]}`);
  }
  lines.push(
    '',
    `${violations.length} violation(s). See CLAUDE.md → Styling Rules → Colour tokens for the ` +
      'role each colour plays.',
  );
  return lines;
}

/**
 * Prove the matcher fires, on synthetic source, without touching the tree. Each positive
 * is a regrowth this gate exists to catch, labelled with the rule it must report; each
 * negative is a near-miss it must NOT catch.
 */
function selfTest() {
  // [label, source, expected rule ids (in order) — [] means clean, path?]
  const cases = [
    // R1 — state variants
    ['hover fill', '<button class="hover:bg-primary">', ['R1']],
    ['desktop-hover text', 'class="desktop-hover:text-d-red"', ['R1']],
    ['focus ring', 'class="focus:ring-primary focus:border-primary"', ['R1', 'R1']],
    ['focus-visible ring', 'class="focus-visible:ring-d-red"', ['R1']],
    ['focus-within + arbitrary opacity', 'class="focus-within:ring-d-red/[0.13]"', ['R1']],
    ['hover file button', 'class="hover:file:bg-primary/90"', ['R1']],
    ['hover tint in a TS class string', "  hover: 'hover:border-primary/40',", ['R1']],
    // R2 — tints and outlines
    ['pale-red pick', '[class.bg-primary/10]="on"', ['R2']],
    ['red outline', 'class="border-primary text-foreground"', ['R2']],
    ['red ring', "'ring-1 ring-primary/20'", ['R2']],
    ['accent-colour checkbox', '<input type="checkbox" class="accent-d-red">', ['R2']],
    ['soft red badge', 'class="bg-d-red-soft"', ['R2']],
    ['outline colour', 'class="outline-primary"', ['R2']],
    // R3 — red text
    ['red price', '<span class="font-semibold text-primary">', ['R3']],
    ['red link via binding', '[class.text-d-red]="x"', ['R3']],
    ['red text with opacity', 'class="text-primary/80"', ['R3']],
    ['ngClass key', "[ngClass]=\"{'text-primary': on}\"", ['R3']],
    // R4 — solid fill
    ['solid red chip', "c.on ? 'bg-primary text-primary-foreground' : ''", ['R4']],
    ['solid literal', 'class="bg-d-red text-white"', ['R4']],
    ['file button fill', 'class="file:bg-primary"', ['R4']],
    ['responsive prefix is not a state', 'class="sm:bg-primary"', ['R4']],
    // Token boundaries — must NOT match
    ['white text on red is the button\'s job', 'class="text-primary-foreground"', []],
    ['hover shade token', 'class="desktop-hover:bg-primary-hover"', []],
    ['d-red-hover literal', 'class="bg-d-red-hover"', []],
    ['a longer identifier', 'const textPrimaryish = "my-text-primary";', []],
    ['the neutral roles', 'class="bg-selected hover:bg-accent ring-ring text-foreground"', []],
    ['destructive is not brand red', 'class="bg-destructive text-destructive"', []],
    ['sidebar tokens', 'class="bg-sidebar-primary text-sidebar-primary-foreground"', []],
    // Comments are not classes
    ['html comment naming a class', '<!-- was text-primary, now ink -->', [], 'synthetic.html'],
    ['html comment in an inline template', '  <!-- bg-primary/10 was the pick -->', []],
    ['ts line comment', "// used to be 'bg-primary'", []],
    ['ts block comment', "/* border-primary */ const x = 'bg-selected';", []],
    ['class after a comment still counts', '<!-- note --><span class="text-d-red">', ['R3'], 'synthetic.html'],
  ];

  let failures = 0;
  for (const [label, source, expected, path] of cases) {
    const got = findViolationsInSource(source, path ?? 'synthetic.ts').map((v) => v.rule);
    if (got.join(',') !== expected.join(',')) {
      failures += 1;
      console.error(
        `  self-test FAIL: ${label} — expected [${expected.join(', ')}], got [${got.join(', ')}]`,
      );
    }
  }

  // The allowlist must scope by file AND rule: the button may darken red on hover (R1)
  // but must still not grow red text (R3).
  const button = 'src/app/_shared/ui/button/button.component.ts';
  const allowCheck = findViolationsInSource("'hover:bg-primary/90 text-primary'", button).map(
    (v) => v.rule,
  );
  if (allowCheck.join(',') !== 'R3') {
    failures += 1;
    console.error(`  self-test FAIL: allowlist scoping — expected [R3], got [${allowCheck.join(', ')}]`);
  }

  // Scope: the diner app, the kitchen, the Menu preview and specs are never scanned.
  const scopeCases = [
    ['src/app/restaurant-mgt/menu/menu.component.html', true],
    ['src/app/_shared/ui/button/button.component.ts', true],
    ['src/app/restaurant-mgt/menu/menu.component.spec.ts', false],
    ['src/app/diner-app/menu/menu.component.html', false],
    ['src/app/kitchen/board/board.component.html', false],
    ['src/app/restaurant-mgt/menu/components/preview-menu-drawer/preview-menu-drawer.component.html', false],
    ['src/app/_shared/ui/price-display/price-display.component.ts', false],
    ['src/app/auth/login/login.component.html', false],
  ];
  for (const [rel, expected] of scopeCases) {
    if (inScope(rel) !== expected) {
      failures += 1;
      console.error(`  self-test FAIL: scope — ${rel} should ${expected ? '' : 'not '}be scanned`);
    }
  }

  const total = cases.length + 1 + scopeCases.length;
  if (failures) {
    console.error(`\nColour-roles gate self-test: ${failures} case(s) failed.`);
    return 1;
  }
  console.log(`Colour-roles gate self-test: OK — ${total} cases, matcher fires.`);
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
    `Colour-roles gate: OK — scanned ${scanned} portal source file(s); brand red is only ` +
      'the act colour.',
  );
  return 0;
}

process.exit(main());
