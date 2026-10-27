/**
 * THE OFF-HOURS ADMIN NOTE (lib/off-hours.mjs) — an explanation, and nothing more.
 *
 * The development server Admin and the Backend share runs 11:00–23:00 Europe/London. A
 * readiness evaluation outside that window cannot read Admin's release.txt, refuses
 * `peers.admin_serving_unreadable`, and is red — correctly, because nothing was
 * observed. These tests pin that the red run now says why, by its own decision time, and
 * that saying so changes nothing else: the decision, its reasons, the readiness
 * classification, both exit statuses, the decisionDigest and every retained document
 * are byte-identical with the note removed.
 *
 * LABELS: REGRESSION — reproduced on e43c832 before the change (the off-hours refusal's
 * summary named the code and nothing else); CONTRACT — a rule this change introduces;
 * CONTROL — a path that must stay exactly as it was.
 */

import { strict as assert } from 'node:assert';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { digestOfValue } from '../lib/canonical.mjs';
import { effectiveHosting } from '../lib/hosting.mjs';
import {
  ADMIN_UNREADABLE, DEV_SERVER_WINDOW, adminReadNote, scheduleAt, wallClock, windowLiteral,
} from '../lib/off-hours.mjs';
import { receiptDigest } from '../lib/peers.mjs';
import { NOT_WAITING } from '../lib/readiness.mjs';
import { POLICY, baseline } from './fixtures.mjs';
import { ROOT, cli, removeOffHoursNote, startOrigin, tempDir, writeDependencyInputs } from './harness.mjs';

// ── the schedule ────────────────────────────────────────────────────────────────

/** What a FIXED offset would conclude — the reading the tz database exists to avoid. */
function fixedOffsetState(utc, offsetMinutes) {
  const d = new Date(Date.parse(utc) + offsetMinutes * 60_000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (m >= 11 * 60 && m < 22 * 60 + 40) return 'on';
  return m >= 22 * 60 + 40 && m < 23 * 60 ? 'end-margin' : 'off';
}

describe('the development server window, written once', () => {
  test('CONTRACT: 11:00–23:00 Europe/London with a 20-minute end margin — the literal the deploy workflows carry', () => {
    assert.deepEqual({ ...DEV_SERVER_WINDOW }, { zone: 'Europe/London', start: '11:00', end: '23:00', endMarginMinutes: 20 });
    assert.ok(Object.isFrozen(DEV_SERVER_WINDOW));
    // Admin #49's and Backend #371's window jobs: DEV_SERVER_WINDOW: "11:00–23:00 Europe/London"
    // and DEV_SERVER_WINDOW_END_MARGIN_MINUTES: "20" (an en dash, as they write it).
    assert.equal(windowLiteral(), '11:00–23:00 Europe/London');
  });

  test('CONTRACT: inside is [start, end − margin) on the London minute — an ordinary winter and summer day', () => {
    const cases = [
      // winter (GMT): London = UTC
      ['2026-10-27T03:12:00Z', 'off', '2026-10-27 03:12 GMT'],
      ['2026-10-27T10:59:59Z', 'off', '2026-10-27 10:59 GMT'], // the last second before the start
      ['2026-10-27T11:00:00Z', 'on', '2026-10-27 11:00 GMT'], // the start is inside
      ['2026-10-27T22:39:59Z', 'on', '2026-10-27 22:39 GMT'], // the last second before the margin
      ['2026-10-27T22:40:00Z', 'end-margin', '2026-10-27 22:40 GMT'], // the margin begins
      ['2026-10-27T22:59:00Z', 'end-margin', '2026-10-27 22:59 GMT'],
      ['2026-10-27T23:00:00Z', 'off', '2026-10-27 23:00 GMT'], // the end is outside
      // summer (BST): London = UTC + 1
      ['2026-07-15T09:59:00Z', 'off', '2026-07-15 10:59 BST'],
      ['2026-07-15T10:00:00Z', 'on', '2026-07-15 11:00 BST'],
      ['2026-07-15T21:39:00Z', 'on', '2026-07-15 22:39 BST'],
      ['2026-07-15T21:40:00Z', 'end-margin', '2026-07-15 22:40 BST'],
      ['2026-07-15T22:30:00Z', 'off', '2026-07-15 23:30 BST'],
    ];
    for (const [utc, state, at] of cases) assert.deepEqual(scheduleAt(utc), { state, at }, utc);
  });
});

describe('both 2026 daylight-saving change days, from the tz database', () => {
  // [UTC instant, expected state, expected London label, the fixed offset a naive reading
  // would use that day (or null when it would agree)]
  test('CONTRACT: 29 March 2026 — GMT until 01:00 UTC, BST after; the start, the margin and the end', () => {
    const cases = [
      ['2026-03-29T00:30:00Z', 'off', '2026-03-29 00:30 GMT', null],
      ['2026-03-29T01:30:00Z', 'off', '2026-03-29 02:30 BST', null],
      ['2026-03-29T09:59:00Z', 'off', '2026-03-29 10:59 BST', null],
      ['2026-03-29T10:00:00Z', 'on', '2026-03-29 11:00 BST', 0], // UTC+0 would say 10:00, off
      ['2026-03-29T10:30:00Z', 'on', '2026-03-29 11:30 BST', 0], // Admin's self-test case
      ['2026-03-29T21:39:00Z', 'on', '2026-03-29 22:39 BST', null],
      ['2026-03-29T21:40:00Z', 'end-margin', '2026-03-29 22:40 BST', 0], // UTC+0 would say 21:40, on
      ['2026-03-29T21:59:00Z', 'end-margin', '2026-03-29 22:59 BST', 0],
      ['2026-03-29T22:00:00Z', 'off', '2026-03-29 23:00 BST', 0], // UTC+0 would say 22:00, on
      ['2026-03-29T22:30:00Z', 'off', '2026-03-29 23:30 BST', 0], // Admin's self-test case
    ];
    for (const [utc, state, at, naive] of cases) {
      assert.deepEqual(scheduleAt(utc), { state, at }, utc);
      if (naive !== null) assert.notEqual(fixedOffsetState(utc, naive), state, `${utc}: a fixed offset would have agreed`);
    }
  });

  test('CONTRACT: 25 October 2026 — BST until 01:00 UTC, GMT after; the start, the margin and the end', () => {
    const cases = [
      ['2026-10-25T00:30:00Z', 'off', '2026-10-25 01:30 BST', null],
      ['2026-10-25T01:30:00Z', 'off', '2026-10-25 01:30 GMT', null], // the repeated hour, second time
      ['2026-10-25T10:00:00Z', 'off', '2026-10-25 10:00 GMT', 60], // UTC+1 would say 11:00, on
      ['2026-10-25T10:30:00Z', 'off', '2026-10-25 10:30 GMT', 60], // Admin's self-test case
      ['2026-10-25T10:59:00Z', 'off', '2026-10-25 10:59 GMT', 60],
      ['2026-10-25T11:00:00Z', 'on', '2026-10-25 11:00 GMT', null],
      ['2026-10-25T21:40:00Z', 'on', '2026-10-25 21:40 GMT', 60], // UTC+1 would say 22:40, the margin
      ['2026-10-25T22:30:00Z', 'on', '2026-10-25 22:30 GMT', 60], // Admin's self-test case
      ['2026-10-25T22:39:00Z', 'on', '2026-10-25 22:39 GMT', 60],
      ['2026-10-25T22:40:00Z', 'end-margin', '2026-10-25 22:40 GMT', 60], // UTC+1 would say 23:40, off
      ['2026-10-25T23:00:00Z', 'off', '2026-10-25 23:00 GMT', null],
    ];
    for (const [utc, state, at, naive] of cases) {
      assert.deepEqual(scheduleAt(utc), { state, at }, utc);
      if (naive !== null) assert.notEqual(fixedOffsetState(utc, naive), state, `${utc}: a fixed offset would have agreed`);
    }
  });

  test('CONTRACT: a time or a zone it cannot read is no answer — never a guess, never UTC', () => {
    for (const now of [undefined, null, '', 42, new Date('2026-10-27T03:00:00Z'), '2026-10-27 03:00:00Z',
      '2026-10-27T03:00:00', '2026-10-27T03:00:00+00:00', '2026-02-30T03:00:00Z', '2026-10-27T24:00:00Z', 'not a time']) {
      assert.equal(wallClock(now), null, String(now));
      assert.equal(scheduleAt(now), null, String(now));
    }
    assert.equal(wallClock('2026-10-27T03:00:00Z', 'Europe/Nowhere'), null);
    assert.equal(scheduleAt('2026-10-27T03:00:00Z', { ...DEV_SERVER_WINDOW, zone: 'Europe/Nowhere' }), null);
    for (const broken of [{ ...DEV_SERVER_WINDOW, start: '11' }, { ...DEV_SERVER_WINDOW, endMarginMinutes: '20' },
      { ...DEV_SERVER_WINDOW, end: '11:10' }, null]) {
      assert.equal(scheduleAt('2026-10-27T03:00:00Z', broken), null, JSON.stringify(broken));
    }
  });
});

// ── which refusals get it ───────────────────────────────────────────────────────

const WAITS = POLICY.publication.readiness.awaiting.map((code) => ({ code, detail: `${code} detail` }));
const UNREADABLE = { code: ADMIN_UNREADABLE, detail: 'fetch failed' };
const refusal = (reasons) => ({ decision: 'REFUSE', allow: false, mode: 'deploy', trigger: 'automatic', reasons });

const OFF = '2026-10-27T03:12:00Z';
const MARGIN = '2026-10-27T22:45:00Z';
const IN = '2026-10-27T14:05:00Z';

const RECOVERY = '> Re-run "Readiness evaluation" inside the window: "Re-run all jobs" on this run, or a `workflow_dispatch`. '
  + 'A dispatched run is a manual attempt, so it stays red by design, but it shows whether Admin can be read.';
const SMALL_PRINT = "> _The time is this run's decision time, read in London from the tz database. The schedule is the likely cause, "
  + 'not an observation: nothing asked AWS whether the server is running, and this run stays red because nothing was observed._';

describe('which refusals get the note, and what it says', () => {
  test('CONTRACT: Admin unreadable while the server is scheduled off — the note, with its first line as a ::warning::', () => {
    const note = adminReadNote({ decision: refusal([UNREADABLE]), now: OFF });
    const headline = "Admin's release.txt couldn't be read: the development server is scheduled off at 2026-10-27 03:12 GMT "
      + '(window 11:00–23:00 London), so this is expected.';
    assert.deepEqual(note, {
      situation: 'scheduled-off',
      at: '2026-10-27 03:12 GMT',
      headline,
      markdown: [`> **${headline}**`, '>', RECOVERY, '>', SMALL_PRINT].join('\n'),
      annotation: `::warning::${headline}`,
    });
  });

  test('CONTRACT: in the window\'s last 20 minutes it is the note too, worded for the margin', () => {
    const note = adminReadNote({ decision: refusal([UNREADABLE]), now: MARGIN });
    const headline = "Admin's release.txt couldn't be read: at 2026-10-27 22:45 GMT the development server is within 20 minutes "
      + 'of its scheduled stop (window 11:00–23:00 London), so this is expected.';
    assert.equal(note.situation, 'end-margin');
    assert.equal(note.headline, headline);
    assert.equal(note.markdown, [`> **${headline}**`, '>', RECOVERY, '>', SMALL_PRINT].join('\n'));
    assert.equal(note.annotation, `::warning::${headline}`);
  });

  test('CONTRACT: inside the window the same refusal gets one short line — treat it as an outage — and no annotation', () => {
    const note = adminReadNote({ decision: refusal([UNREADABLE]), now: IN });
    const headline = "Admin's release.txt couldn't be read at 2026-10-27 14:05 GMT, inside the development server's window "
      + '(11:00–23:00 London). The development server should be up now. Treat this as an outage and check Admin.';
    assert.deepEqual(note, { situation: 'in-window', at: '2026-10-27 14:05 GMT', headline, markdown: `> ${headline}`, annotation: null });
  });

  test('CONTRACT: beside the recorded waits, in any order, it is the same note', () => {
    for (const now of [OFF, MARGIN, IN]) {
      const alone = adminReadNote({ decision: refusal([UNREADABLE]), now });
      assert.deepEqual(adminReadNote({ decision: refusal([...WAITS, UNREADABLE]), now }), alone, now);
      assert.deepEqual(adminReadNote({ decision: refusal([UNREADABLE, ...WAITS]), now }), alone, now);
    }
  });

  test('CONTROL: any refusal WITHOUT that reason gets nothing new, at every time of day', () => {
    const others = [
      [],
      WAITS,
      [{ code: 'peers.admin_serving_unapproved', detail: 'admin serves x' }],
      [{ code: 'peers.admin_serving_cacheable', detail: 'max-age=60' }],
      [{ code: 'peers.admin_receipt_unverified', detail: 'unreachable' }],
      [{ code: 'peers.backend_serving_unreadable', detail: 'fetch failed' }],
      [{ code: 'served.unreadable', detail: 'unexpected status 503' }],
      [...WAITS, { code: 'dependency.assessment_blocking', detail: 'blocking' }],
      [{ code: `${ADMIN_UNREADABLE}_x` }, { code: ` ${ADMIN_UNREADABLE}` }],
    ];
    for (const reasons of others) {
      for (const now of [OFF, MARGIN, IN]) assert.equal(adminReadNote({ decision: refusal(reasons), now }), null, `${JSON.stringify(reasons)} at ${now}`);
    }
  });

  test('CONTROL: only a REFUSE is explained — nothing else carries the reason, and nothing else is a red refusal', () => {
    for (const word of ['PROCEED', 'SKIP_IDENTICAL', 'SKIP_STALE', undefined]) {
      assert.equal(adminReadNote({ decision: { ...refusal([UNREADABLE]), decision: word }, now: OFF }), null, String(word));
    }
    for (const decision of [null, undefined, 'REFUSE', [], { decision: 'REFUSE' }, { decision: 'REFUSE', reasons: 'peers.admin_serving_unreadable' }]) {
      assert.equal(adminReadNote({ decision, now: OFF }), null, JSON.stringify(decision));
    }
    assert.equal(adminReadNote(), null);
  });

  test('CONTRACT: a decision time it cannot read gets nothing — it never guesses which side of the window it is on', () => {
    for (const now of [undefined, '', '2026-10-27 03:12', '2026-02-30T03:00:00Z', 1793000000]) {
      assert.equal(adminReadNote({ decision: refusal([UNREADABLE]), now }), null, String(now));
    }
  });

  test('CONTRACT: it reads the decision and never writes it, and it never throws', () => {
    const decision = refusal([...WAITS, UNREADABLE]);
    const before = JSON.stringify(decision);
    const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
    assert.ok(adminReadNote({ decision: deepFreeze(decision), now: OFF }));
    assert.equal(JSON.stringify(decision), before);
    const hostile = new Proxy({}, { get() { throw new Error('read'); } });
    assert.equal(adminReadNote({ decision: hostile, now: OFF }), null);
    assert.equal(adminReadNote({ decision: refusal([UNREADABLE]), now: OFF, window: { ...DEV_SERVER_WINDOW, zone: 'Europe/Nowhere' } }), null);
  });

  test('CONTRACT: it states the schedule, never the server\'s state', () => {
    for (const now of [OFF, MARGIN, IN]) {
      const note = adminReadNote({ decision: refusal([UNREADABLE]), now });
      assert.doesNotMatch(note.markdown, /server (is|was) (off|down|stopped|not running)/i, now);
      assert.doesNotMatch(note.markdown, /instance/i, now);
    }
    assert.match(adminReadNote({ decision: refusal([UNREADABLE]), now: OFF }).headline, /is scheduled off at /);
    assert.match(adminReadNote({ decision: refusal([UNREADABLE]), now: MARGIN }).headline, /of its scheduled stop/);
  });
});

// ── through the real CLI ────────────────────────────────────────────────────────

const ADMIN = POLICY.compatibleSet.peers.admin.approved[0].commit;
const IDENTITY_URL = `${POLICY.hosting.identityOrigin}${POLICY.hosting.identityPath}`;

/** Receipts exactly as `peer-facts` assembles them from the committed files. */
function committedReceipts() {
  const out = {};
  for (const [name, declared] of Object.entries(POLICY.compatibleSet.peers)) {
    out[name] = declared.approved.map((a) => {
      const receipt = JSON.parse(readFileSync(join(ROOT, a.receipt), 'utf8'));
      return { commit: a.commit, path: a.receipt, present: true, readable: true, receipt, digest: receiptDigest(receipt) };
    });
  }
  return out;
}

/** The committed receipts, the approved Admin publicly re-derived, and Admin's serving as given. */
const peersWith = (adminServing) => ({
  receipts: committedReceipts(),
  verification: { admin: { [ADMIN]: { state: 'verified', detail: '' } } },
  serving: { admin: adminServing },
});
const ADMIN_OFF = { state: 'unreadable', url: 'https://admin.dinifyapp.com/release.txt', detail: 'fetch failed' };
const ADMIN_SERVING = { state: 'known', url: 'https://admin.dinifyapp.com/release.txt', commit: ADMIN, noStore: true, cacheControl: 'no-store' };

/** The facts `git-facts` reports for the committed policy over the fixture candidate. */
function committedFacts(input) {
  return {
    source: input.source,
    hosting: effectiveHosting({
      firebaseJson: JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')),
      firebaserc: JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8')),
      policy: POLICY,
      files: input.artifact.files,
    }),
    baseline: { state: 'none' },
    eligibility: { relationToMinimum: 'not-applicable' },
    trusted: { ...input.trusted, legacyPublisherPresent: existsSync(join(ROOT, POLICY.prerequisites.singlePublisher.legacyWorkflow)) },
    policy: { revision: 'f'.repeat(40), digest: digestOfValue(POLICY), verifierTree: { release: 'e'.repeat(40), dependencyAudit: 'd'.repeat(40) } },
  };
}

/**
 * FAULT INJECTION, labelled: a copy of the gate's own code (the CLI, its modules and the
 * committed policy) with the note REMOVED (harness.mjs → removeOffHoursNote).
 */
function rootWithoutNote() {
  const dir = tempDir('without-note');
  for (const rel of ['release/cli.mjs', 'release/policy.json']) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(dir, rel));
  }
  for (const rel of ['release/lib', 'dependency-audit/lib']) cpSync(join(ROOT, rel), join(dir, rel), { recursive: true });
  removeOffHoursNote(dir);
  return dir;
}

let origin;
let served;
let withoutNote;

before(async () => {
  // The site as the legacy writer leaves it: no release.json behind the committed
  // firebase.json, whose `**` rewrite answers with the SPA — classified absent.
  const site = tempDir('off-hours-site');
  writeFileSync(join(site, 'index.html'), '<!doctype html><html><body><app-root></app-root></body></html>\n');
  origin = await startOrigin({ name: 'site' });
  origin.serveSite(site, JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')));
  const r = await cli(['serve-state', '--origin', origin.origin]);
  assert.equal(r.status, 0, r.stderr);
  // Classified by the stand-in, located at the identity URL it stands in for.
  served = { ...JSON.parse(r.stdout), url: IDENTITY_URL };
  withoutNote = rootWithoutNote();
});

after(async () => { await origin?.close(); });

/**
 * The Decide step's two commands as publish.yml runs them — `decide`, then `readiness`
 * on its refusal — over the committed policy and the committed state's evidence, at one
 * decision time. Every file either command writes is returned as bytes.
 */
async function evaluate({ root = ROOT, now, peers }) {
  const input = baseline();
  const dir = tempDir('off-hours-eval');
  const at = (name) => join(dir, name);
  const inputs = {
    request: input.request, certification: input.certification, observation: input.artifact,
    facts: committedFacts(input), served, peers,
  };
  for (const [name, value] of Object.entries(inputs)) writeFileSync(at(`${name}.json`), JSON.stringify(value));
  for (const name of ['decide-outputs', 'readiness-outputs', 'summary.md']) writeFileSync(at(name), '');
  const decide = await cli(['decide', ...Object.keys(inputs).flatMap((n) => [`--${n}`, at(`${n}.json`)]),
    ...writeDependencyInputs(dir, input), '--now', now, '--record-out', at('record.json'),
    '--outputs', at('decide-outputs'), '--summary', at('summary.md')], { root });
  writeFileSync(at('decision.json'), decide.stdout);
  const readiness = await cli(['readiness', ...['decision', 'request', 'facts', 'served', 'peers'].flatMap((n) => [`--${n}`, at(`${n}.json`)]),
    '--enablement', '', '--out', at('readiness.json'), '--outputs', at('readiness-outputs'), '--summary', at('summary.md')], { root });
  const read = (name) => readFileSync(at(name), 'utf8');
  return {
    decide: { status: decide.status, stderr: decide.stderr },
    readiness: { status: readiness.status, stderr: readiness.stderr },
    documents: {
      'decision.json': read('decision.json'),
      'record.json': read('record.json'),
      'decide outputs': read('decide-outputs'),
      'readiness.json': read('readiness.json'),
      'readiness outputs': read('readiness-outputs'),
    },
    summary: read('summary.md'),
    decision: JSON.parse(decide.stdout),
    record: JSON.parse(read('readiness.json')),
  };
}

const codesOf = (decision) => decision.reasons.map((r) => r.code).sort();
// The decision times the CLI tests use: inside the fixture's 24-hour certification and
// assessment windows (certified 11:30Z, assessed 11:50Z on 22 September, BST).
const CLI_OFF = '2026-09-23T02:12:00Z'; // 03:12 BST
const CLI_MARGIN = '2026-09-22T21:45:00Z'; // 22:45 BST
const CLI_IN = '2026-09-22T13:05:00Z'; // 14:05 BST

describe('the Decide step\'s commands, through the real CLI', { concurrency: 4 }, () => {
  test('REGRESSION: an off-hours refusal explains itself — the note first, the annotation on stderr, and red stays red', async () => {
    const r = await evaluate({ now: CLI_OFF, peers: peersWith(ADMIN_OFF) });
    // RED, at both commands, for exactly the four recorded waits and the unreadable Admin.
    assert.equal(r.decide.status, 1);
    assert.equal(r.decision.decision, 'REFUSE');
    assert.equal(r.decision.allow, false);
    assert.deepEqual(codesOf(r.decision), [...POLICY.publication.readiness.awaiting, ADMIN_UNREADABLE].sort());
    assert.equal(r.readiness.status, 1);
    assert.equal(r.record.kind, NOT_WAITING);
    assert.deepEqual(r.record.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.match(r.record.problems[0].detail, /^peers\.admin_serving_unreadable: fetch failed$/);
    // The explanation: first in the decision section, before the evidence.
    const note = adminReadNote({ decision: r.decision, now: CLI_OFF });
    assert.equal(note.situation, 'scheduled-off');
    assert.match(note.headline, /scheduled off at 2026-09-23 03:12 BST \(window 11:00–23:00 London\)/);
    const section = r.summary.slice(r.summary.indexOf('### Publication decision: REFUSE'));
    assert.ok(section.indexOf(note.markdown) > 0, 'the note is in the decision section');
    assert.ok(section.indexOf(note.markdown) < section.indexOf('| target |'), 'the note comes before the evidence');
    assert.equal(r.summary.split(note.headline).length, 2, 'the note is written once');
    // The annotation carries the same first line, on decide's stderr (stdout is the decision).
    assert.equal(r.decide.stderr, `${note.annotation}\n`);
    assert.equal(note.annotation, `::warning::${note.headline}`);
    assert.ok(!r.documents['decision.json'].includes('::warning::'));
  });

  test('CONTRACT: inside the window the same refusal gets the short line, and no annotation', async () => {
    const r = await evaluate({ now: CLI_IN, peers: peersWith(ADMIN_OFF) });
    assert.equal(r.decide.status, 1);
    assert.equal(r.readiness.status, 1);
    const note = adminReadNote({ decision: r.decision, now: CLI_IN });
    assert.equal(note.situation, 'in-window');
    assert.ok(r.summary.includes(`${note.markdown}\n`));
    assert.match(r.summary, /The development server should be up now\. Treat this as an outage and check Admin\./);
    assert.doesNotMatch(r.summary, /so this is expected/);
    assert.equal(r.decide.stderr, '', 'no annotation inside the window');
  });

  test('CONTRACT: every document is byte-identical with and without the note — at every time of day', async () => {
    for (const now of [CLI_OFF, CLI_MARGIN, CLI_IN]) {
      const [real, bare] = await Promise.all([
        evaluate({ now, peers: peersWith(ADMIN_OFF) }),
        evaluate({ root: withoutNote, now, peers: peersWith(ADMIN_OFF) }),
      ]);
      // The decision, its reasons, the record, the step outputs (decision, allow, record,
      // digests), the readiness classification and its digest, and both exit statuses.
      for (const [name, bytes] of Object.entries(real.documents)) assert.equal(bytes, bare.documents[name], `${name} at ${now}`);
      assert.equal(real.decide.status, bare.decide.status, now);
      assert.equal(real.readiness.status, bare.readiness.status, now);
      assert.equal(real.readiness.stderr, bare.readiness.stderr, `readiness stderr at ${now}`);
      assert.equal(real.record.decisionDigest, digestOfValue(bare.decision), now);
      // ...and the comparison CAN see the note: the summary differs by exactly the note,
      // and decide's stderr by exactly the annotation.
      const note = adminReadNote({ decision: real.decision, now });
      assert.ok(note, now);
      assert.notEqual(real.summary, bare.summary, `${now}: the comparison saw no note`);
      assert.equal(real.summary.replace(`${note.markdown}\n\n`, ''), bare.summary, now);
      assert.equal(bare.decide.stderr, '', now);
      assert.equal(real.decide.stderr, note.annotation ? `${note.annotation}\n` : '', now);
    }
  });

  test('CONTRACT: the clock reaches only the note — the same evidence decides the same at every time of day', async () => {
    const times = [CLI_OFF, CLI_MARGIN, CLI_IN];
    const runs = await Promise.all(times.map((now) => evaluate({ now, peers: peersWith(ADMIN_OFF) })));
    for (const r of runs.slice(1)) {
      assert.equal(r.documents['decision.json'], runs[0].documents['decision.json']);
      assert.equal(r.documents['readiness.json'], runs[0].documents['readiness.json']);
    }
    assert.deepEqual(runs.map((r, i) => adminReadNote({ decision: r.decision, now: times[i] }).situation),
      ['scheduled-off', 'end-margin', 'in-window']);
  });

  test('CONTROL: off hours, a refusal without the reason gets nothing new — summary and stderr as before', async () => {
    const [real, bare] = await Promise.all([
      evaluate({ now: CLI_OFF, peers: peersWith(ADMIN_SERVING) }),
      evaluate({ root: withoutNote, now: CLI_OFF, peers: peersWith(ADMIN_SERVING) }),
    ]);
    assert.equal(codesOf(real.decision).includes(ADMIN_UNREADABLE), false);
    assert.equal(real.decide.status, 1);
    assert.equal(real.summary, bare.summary);
    assert.equal(real.decide.stderr, bare.decide.stderr);
    assert.doesNotMatch(real.summary, /release\.txt couldn't be read/);
    for (const [name, bytes] of Object.entries(real.documents)) assert.equal(bytes, bare.documents[name], name);
  });
});
