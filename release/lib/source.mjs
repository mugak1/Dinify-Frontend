/**
 * Pure readers that turn SOURCE TEXT into release facts.
 *
 * They live apart from `release/cli.mjs` for one reason that matters: a test must be
 * able to import them without the command-line dispatcher running. They are also the
 * three places where this contract infers something from a file it did not write, so
 * each of them REFUSES AMBIGUITY rather than guessing — a renamed, duplicated, moved
 * or deleted constant fails the build instead of silently stamping a stale number
 * into a record the publisher then treats as authoritative.
 */

/** Exactly one `export const NAME = <integer>;` — or an error naming what it found. */
export function readIntConstant(source, name) {
  const matches = [...source.matchAll(new RegExp(`^export const ${name}\\s*=\\s*(-?\\d+)\\s*;`, 'gm'))];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one \`export const ${name}\`, found ${matches.length}`);
  }
  return Number.parseInt(matches[0][1], 10);
}

/** The three fields of an Angular environment literal that describe a destination. */
export function readEnvironmentLiteral(source) {
  const pick = (key) => {
    const m = [...source.matchAll(new RegExp(`^\\s*${key}:\\s*(true|false|'([^']*)')\\s*,?\\s*$`, 'gm'))];
    if (m.length !== 1) throw new Error(`expected exactly one \`${key}\` in the environment file, found ${m.length}`);
    return m[0][2] !== undefined ? m[0][2] : m[0][1] === 'true';
  };
  return { production: pick('production'), apiUrl: pick('apiUrl'), dinerBaseUrl: pick('dinerBaseUrl') };
}

/**
 * `predeploy` / `postdeploy` anywhere in a Firebase configuration.
 *
 * These are shell commands the publish tool executes. A trusted deploy tool may run
 * inside the one job holding the publishing credential; a hook specified by the thing
 * being published may not. Reported by path so a refusal names the exact key, and
 * searched at every depth because the hosting block is an array of site objects and a
 * future key could nest them further.
 */
export function hostingHooks(config) {
  const found = [];
  const scan = (node, path) => {
    if (Array.isArray(node)) { node.forEach((v, i) => scan(v, `${path}[${i}]`)); return; }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'predeploy' || key === 'postdeploy') found.push(`${path}.${key}`);
      scan(value, `${path}.${key}`);
    }
  };
  scan(config, '$');
  return found;
}

/** Firebase accepts `hosting` as one object or an array of them. */
function hostingEntries(config) {
  const hosting = config?.hosting;
  if (Array.isArray(hosting)) return hosting;
  if (hosting && typeof hosting === 'object') return [hosting];
  return [];
}

/** `./dist`, `dist` and `dist/` name the same directory to Firebase. */
function normalisePublicPath(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Does this Firebase configuration deploy the tree we verified, to the site we
 * approved?
 *
 * THIS IS THE FIELD THAT DECIDES WHAT GETS PUBLISHED, and until it was checked the
 * gate validated the payload exhaustively and validated almost nothing about the
 * configuration that says where the payload goes. `hosting.public` names the
 * directory Firebase uploads; the publish job places the verified artifact at
 * `dist` beside this file. Change `public` to `.` and Firebase deploys the whole
 * staging directory instead — a successful deployment of the wrong tree, which the
 * post-publish identity read would only notice afterwards, with the site already
 * broken.
 *
 * `site` is the weaker of the two: a mismatch there normally fails target
 * resolution loudly rather than publishing somewhere unintended. It is asserted
 * anyway, so that is a property of the gate rather than of Firebase's behaviour.
 */
export function hostingDestinationProblems(config, { site, publicDirectory }) {
  const problems = [];
  const entries = hostingEntries(config);
  if (entries.length === 0) {
    problems.push('the hosting configuration declares no hosting block');
    return problems;
  }
  const selected = entries.filter((entry) => entry?.site === site);
  if (selected.length === 0) {
    problems.push(`no hosting block declares site ${site}`);
    return problems;
  }
  if (selected.length > 1) {
    problems.push(`${selected.length} hosting blocks declare site ${site}`);
    return problems;
  }
  const declared = normalisePublicPath(selected[0].public);
  const expected = normalisePublicPath(publicDirectory);
  if (declared !== expected) {
    problems.push(`hosting.public is ${JSON.stringify(selected[0].public)}, expected ${JSON.stringify(publicDirectory)}`);
  }
  return problems;
}
