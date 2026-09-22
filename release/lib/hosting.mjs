/**
 * The hosting configuration the publish tool will ACTUALLY use — resolved, checked
 * and then REGENERATED narrowly, rather than handed through from the candidate.
 *
 * WHAT WAS MISSING (R3.4). The gate read `firebase.json` for hooks and for
 * `hosting.public`, and never read `.firebaserc` at all. But the tool resolves its
 * destination through BOTH, and two ordinary-looking edits to a certified commit
 * change what gets published without tripping either check:
 *
 *  - `.firebaserc` `projects: {"dinify-dev": "<other>"}`. firebase-tools'
 *    `applyRC` maps an explicit `--project dinify-dev` through that alias, so the
 *    credential deploys to a different project. (Read from firebase-tools'
 *    command.js, and pinned by the oracle test against the installed tool.)
 *  - `firebase.json` `ignore: ["**\/*.js"]`. The upload is
 *    `glob('**\/*', {dot: true})` under `public` minus the tool's own ignores and
 *    these, so a certified script can be dropped from a deploy that then reports
 *    success.
 *
 * WHAT THIS DOES. It resolves the destination the way the tool does (a site match
 * first, then a target through `.firebaserc`), refuses anything outside a narrow
 * allow-list, proves every certified file survives the effective ignore set, and
 * then GENERATES the `firebase.json` and `.firebaserc` the publisher hands the
 * tool — containing only allow-listed keys, the policy's own project, site, public
 * directory and ignore list, and the certified serving rules after validation. The
 * generated pair's digest is part of the admitted release record, so the publisher
 * can prove it is deploying with exactly what the gate evaluated.
 *
 * REFUSE, NEVER OVERRIDE. If the certified configuration disagrees with the policy,
 * that is refused rather than silently replaced by the generated one: a reviewed
 * change to hosting that the policy does not know about is a question for a person.
 */

import { digestOfValue } from './canonical.mjs';
import { partitionByIgnore, supportedIgnorePattern } from './glob.mjs';
import { hostingHooks } from './source.mjs';

/** Keys a hosting entry may carry. Anything else — `source` (web frameworks, which
 *  run a build), `redirects`, `i18n`, `appAssociation`, a functions/run rewrite —
 *  is refused until a reviewed change adds it here. */
export const ALLOWED_ENTRY_KEYS = Object.freeze(['site', 'target', 'public', 'ignore', 'rewrites', 'headers']);

/** Ignores firebase-tools applies to every upload on its own (lib/listFiles.js). */
export const TOOL_BUILTIN_IGNORES = Object.freeze(['**/firebase-debug.log', '**/firebase-debug.*.log', '.firebase/*']);

const RC_KEYS = new Set(['projects', 'targets', '_comment', '_note']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normalisePublic = (v) => (typeof v === 'string' ? v.replace(/^\.\//, '').replace(/\/+$/, '') : null);

function problem(problems, code, detail) {
  problems.push({ code, detail });
}

function validRewrite(r) {
  return isObject(r)
    && Object.keys(r).every((k) => k === 'source' || k === 'destination')
    && typeof r.source === 'string' && r.source.length > 0
    && typeof r.destination === 'string' && r.destination.startsWith('/');
}

function validHeaderRule(h) {
  return isObject(h)
    && Object.keys(h).every((k) => k === 'source' || k === 'headers')
    && typeof h.source === 'string' && h.source.length > 0
    && Array.isArray(h.headers) && h.headers.length > 0
    && h.headers.every((kv) => isObject(kv)
      && Object.keys(kv).every((k) => k === 'key' || k === 'value')
      && typeof kv.key === 'string' && kv.key.length > 0
      && typeof kv.value === 'string');
}

/**
 * @param {object} input
 * @param {unknown} input.firebaseJson   the certified commit's firebase.json, parsed (or undefined if absent/unreadable)
 * @param {unknown} input.firebaserc     the certified commit's .firebaserc, parsed (or undefined)
 * @param {object}  input.policy         the trusted policy
 * @param {string[]} [input.files]       certified tree paths, relative to the public directory
 * @returns {{problems: object[], config: object|null, rc: object|null, digest: string|null, dropped: object[]}}
 */
export function effectiveHosting({ firebaseJson, firebaserc, policy, files = [] }) {
  const problems = [];
  const h = policy.hosting;

  if (!isObject(firebaseJson)) {
    problem(problems, 'hosting.config_unreadable', 'the certified commit carries no readable firebase.json');
  }
  if (!isObject(firebaserc)) {
    problem(problems, 'hosting.rc_unreadable', 'the certified commit carries no readable .firebaserc');
  }
  if (problems.length > 0) return { problems, config: null, rc: null, digest: null, dropped: [] };

  for (const hook of hostingHooks(firebaseJson)) problem(problems, 'hosting.hook_present', hook);
  for (const hook of hostingHooks(firebaserc)) problem(problems, 'hosting.hook_present', `.firebaserc ${hook}`);

  // ── .firebaserc: the PROJECT the explicit --project resolves to ──────────────
  for (const key of Object.keys(firebaserc)) {
    if (!RC_KEYS.has(key)) problem(problems, 'hosting.rc_unexpected_key', key);
  }
  const projects = firebaserc.projects ?? {};
  if (!isObject(projects)) {
    problem(problems, 'hosting.rc_unreadable', '.firebaserc projects is not an object');
  } else {
    // applyRC: `options.project = aliases[options.project] ?? options.project`.
    const resolved = typeof projects[h.project] === 'string' ? projects[h.project] : h.project;
    if (resolved !== h.project) {
      problem(problems, 'hosting.project_alias_redirect', `--project ${h.project} resolves to ${resolved} through .firebaserc`);
    }
    if (projects.default !== undefined && projects.default !== h.project) {
      problem(problems, 'hosting.project_default_mismatch', `projects.default is ${String(projects.default)}`);
    }
  }
  const targetMap = firebaserc.targets?.[h.project]?.hosting;
  const mappedSites = isObject(targetMap) ? targetMap[h.target] : undefined;
  if (mappedSites !== undefined
      && !(Array.isArray(mappedSites) && mappedSites.length === 1 && mappedSites[0] === h.site)) {
    problem(problems, 'hosting.target_mapping_mismatch', `target ${h.target} maps to ${JSON.stringify(mappedSites)}`);
  }

  // ── firebase.json: the ENTRY `--only hosting:<target>` selects ──────────────
  const entries = Array.isArray(firebaseJson.hosting)
    ? firebaseJson.hosting
    : isObject(firebaseJson.hosting) ? [firebaseJson.hosting] : [];
  for (const key of Object.keys(firebaseJson)) {
    if (key !== 'hosting' && !key.startsWith('_')) problem(problems, 'hosting.unexpected_product', key);
  }
  if (entries.length !== 1) {
    problem(problems, 'hosting.entry_count', `expected exactly one hosting entry, found ${entries.length}`);
    return { problems, config: null, rc: null, digest: null, dropped: [] };
  }
  const entry = entries[0];
  if (!isObject(entry)) {
    problem(problems, 'hosting.entry_unreadable', typeof entry);
    return { problems, config: null, rc: null, digest: null, dropped: [] };
  }
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_ENTRY_KEYS.includes(key)) problem(problems, 'hosting.unsupported_key', key);
  }
  // matchingConfigs: a `site` equal to the target name wins; otherwise a `target`
  // equal to it, resolved through .firebaserc to exactly one site.
  let site = null;
  if ('site' in entry && 'target' in entry) {
    problem(problems, 'hosting.site_and_target', 'an entry may declare site or target, not both');
  } else if (entry.site === h.target) {
    site = entry.site;
  } else if (entry.target === h.target) {
    site = Array.isArray(mappedSites) && mappedSites.length === 1 ? mappedSites[0] : null;
    if (site === null) problem(problems, 'hosting.target_unresolved', `target ${h.target} resolves to no single site`);
  } else {
    problem(problems, 'hosting.not_selected', `--only hosting:${h.target} selects no entry`);
  }
  if (site !== null && site !== h.site) {
    problem(problems, 'hosting.site_mismatch', `resolves to site ${site}, expected ${h.site}`);
  }
  if (normalisePublic(entry.public) !== normalisePublic(h.publicDirectory)) {
    problem(problems, 'hosting.public_mismatch', `public is ${JSON.stringify(entry.public)}, expected ${JSON.stringify(h.publicDirectory)}`);
  }
  const ignore = entry.ignore ?? [];
  if (!Array.isArray(ignore) || JSON.stringify(ignore) !== JSON.stringify(h.ignore)) {
    problem(problems, 'hosting.ignore_changed', `ignore is ${JSON.stringify(entry.ignore)}, expected ${JSON.stringify(h.ignore)}`);
  }
  const rewrites = entry.rewrites ?? [];
  if (!Array.isArray(rewrites) || !rewrites.every(validRewrite)) {
    problem(problems, 'hosting.rewrite_unsupported', 'only {source, destination:"/…"} rewrites are allowed');
  }
  const headers = entry.headers ?? [];
  if (!Array.isArray(headers) || !headers.every(validHeaderRule)) {
    problem(problems, 'hosting.header_unsupported', 'only {source, headers:[{key, value}]} rules are allowed');
  }

  // ── The file set: every certified file must survive the effective ignores ────
  let dropped = [];
  const effectiveIgnores = [...TOOL_BUILTIN_IGNORES, ...h.ignore];
  if (effectiveIgnores.every(supportedIgnorePattern)) {
    dropped = partitionByIgnore(files, effectiveIgnores).dropped;
    for (const d of dropped) problem(problems, 'hosting.certified_asset_filtered', `${d.path} (by ${d.pattern})`);
  } else {
    problem(problems, 'hosting.ignore_unsupported', 'an ignore pattern is outside the supported dialect');
  }

  if (problems.length > 0) return { problems, config: null, rc: null, digest: null, dropped };

  // ── The NARROW configuration the tool is actually given ─────────────────────
  const config = {
    hosting: [{
      site: h.site,
      public: h.publicDirectory,
      ignore: [...h.ignore],
      rewrites: rewrites.map((r) => ({ source: r.source, destination: r.destination })),
      headers: headers.map((r) => ({ source: r.source, headers: r.headers.map((kv) => ({ key: kv.key, value: kv.value })) })),
    }],
  };
  const rc = {
    projects: { default: h.project },
    targets: { [h.project]: { hosting: { [h.target]: [h.site] } } },
  };
  return { problems, config, rc, digest: digestOfValue({ config, rc }), dropped };
}
