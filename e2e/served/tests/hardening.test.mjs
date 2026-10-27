/**
 * THE FOLLOW-UPS FROM THE INDEPENDENT REVIEW OF #770, offline.
 *
 * One block per follow-up, each driven through the code that does the work: a
 * loopback HTTP server, a stubbed `fetch`, a real child process, the real scan
 * CLI. Nothing here reaches UAT, Firebase or GitHub. Labels as in
 * served.test.mjs: REGRESSION (a defect that must stay closed), CONTRACT (a
 * promise the README or the workflow makes), CONTROL (what must keep working).
 *
 * The modules are imported as NAMESPACES on purpose: a name this change adds is
 * then `undefined` on an older tree, so each test fails on its own assertion
 * instead of one link error hiding the whole file.
 *
 *   node --test "e2e/served/tests/*.test.mjs"
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import * as lib from '../lib.mjs';
import * as probes from '../probes.mjs';
import * as redact from '../redact.mjs';
import * as run from '../run.mjs';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const SERVED = join(ROOT, 'e2e/served');
const source = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const ID = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const NAME = 'Dinify E2E Test Kitchen';
const SHA_A = '7cf5b459bef25c0c3ee5c6ff354c494b8db592a7';
const SHA_B = '0079b5450d1d7d6a8b7f5bb2f7a1c3e7d1a2b3c4';
const SHA_C = '9cf8c83aa1b2c3d4e5f60718293a4b5c6d7e8f90';

/** A loopback server whose reply each test sets; it records every request. */
function loopback() {
  const box = { reply: () => [404, {}], seen: [] };
  const server = createServer((req, res) => {
    box.seen.push(`${req.method} ${req.url}`);
    const [status, body] = box.reply(req);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  box.start = async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    box.api = `http://127.0.0.1:${server.address().port}`;
  };
  box.stop = () => server.close();
  return box;
}
const restaurantRow = (over = {}) => ({
  data: { id: ID, name: NAME, is_test: true, deleted: false, status: 'live', accepting_orders: true, ...over },
});

// ── 1. a missing serving identity must not pass ──────────────────────────────

describe('1 — the serving identity is complete, or the run fails', () => {
  const complete = () => ({
    frontend_deploy: { repo: 'mugak1/Dinify-Frontend', head_sha: SHA_A },
    backend_deploy: { repo: 'mugak1/Dinify-Backend', head_sha: SHA_B },
    backend_release: { state: 'unavailable', reason: 'not_started_by_release_launcher' },
    backend_health: { status: 'ok', database: 'connected' },
    admin_release: { status: 200, body: SHA_C },
    bundle: { main_script: 'main-OWTGDKLC.js', scripts_read: 4, api_origins: ['https://api-test.dinifyapp.com/uat'] },
    unread: {},
  });

  it('CONTROL: a complete identity raises no problem', () => {
    assert.deepEqual(run.servingProblems(complete()), []);
  });

  for (const [field, spoil, why] of [
    ['frontend_deploy.head_sha', (s) => { s.frontend_deploy = { repo: 'x', error: 'status 403' }; }, /status 403/],
    ['backend_deploy.head_sha', (s) => { s.backend_deploy = { repo: 'x', error: 'status 404' }; }, /status 404/],
    ['backend_deploy.head_sha', (s) => { s.backend_deploy.head_sha = 'not-a-sha'; }, null],
    ['backend_release', (s) => { s.backend_release = null; s.unread.backend_release = 'status 502'; }, /status 502/],
    ['backend_health', (s) => { s.backend_health = null; s.unread.backend_health = 'TimeoutError'; }, /TimeoutError/],
    ['admin_release.body', (s) => { s.admin_release = { error: 'TypeError' }; }, /TypeError/],
    ['admin_release.body', (s) => { s.admin_release = { status: 200, body: '<!doctype html><html>' }; }, /not a commit SHA/],
    ['admin_release.body', (s) => { s.admin_release = { status: 404, body: SHA_C }; }, /status 404/],
    ['bundle.main_script', (s) => { s.bundle.main_script = null; }, null],
  ]) {
    it(`REGRESSION: ${field} missing (${why ?? 'malformed'}) is a problem naming it`, () => {
      const s = complete();
      spoil(s);
      const problems = run.servingProblems(s);
      assert.equal(problems.length, 1, JSON.stringify(problems));
      assert.ok(problems[0].startsWith(`serving: ${field} was not read`), problems[0]);
      if (why) assert.match(problems[0], why);
    });
  }

  it('REGRESSION: no serving object at all (the run stopped before reading it) is a problem for every field', () => {
    assert.equal(run.servingProblems(undefined).length, 6);
  });

  it('REGRESSION: the identity problems join the run\'s problems, so the outcome cannot be passed', () => {
    const text = source('e2e/served/run.mjs');
    assert.match(text, /evidence\.problems\.push\(\.\.\.servingProblems\(evidence\.serving\)\)/);
    assert.ok(text.indexOf('servingProblems(evidence.serving)') < text.indexOf("evidence.outcome = evidence.problems.length ? 'failed' : 'passed'"));
  });

  describe('the reads, against a stubbed fetch', () => {
    const real = globalThis.fetch;
    const calls = [];
    before(() => {
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        const auth = init.headers?.Authorization ?? null;
        calls.push({ url: u, auth });
        const json = (status, body) => new Response(JSON.stringify(body), { status });
        if (u.startsWith('https://api.github.com/')) {
          if (auth !== 'Bearer ghs_test-token-0123456789') return json(403, { message: 'API rate limit exceeded' });
          return json(200, { workflow_runs: [{ id: 1, head_sha: u.includes('Dinify-Backend') ? SHA_B : SHA_A, conclusion: 'success' }] });
        }
        if (u.endsWith('/api/v1/release/')) return json(200, { state: 'unavailable' });
        if (u.endsWith('/api/v1/health/')) return json(503, { status: 'degraded' });
        if (u.endsWith('/release.txt')) return new Response(`${SHA_C}\n`, { status: 200 });
        return json(404, {});
      };
    });
    after(() => { globalThis.fetch = real; });
    const cfg = (githubToken) => ({ api: 'https://api.example.invalid/uat', adminRelease: 'https://admin.example.invalid/release.txt', githubToken });
    const bundle = { main: 'main-OWTGDKLC.js', scripts: 3, origins: [{ value: 'https://api.example.invalid/uat' }] };

    it('REGRESSION: the Actions API is read with the job token, and the token goes to api.github.com and nowhere else', async () => {
      calls.length = 0;
      const s = await run.servingIdentity(cfg('ghs_test-token-0123456789'), bundle);
      assert.equal(s.frontend_deploy.head_sha, SHA_A);
      assert.equal(s.backend_deploy.head_sha, SHA_B);
      for (const c of calls) {
        if (c.url.startsWith('https://api.github.com/')) assert.equal(c.auth, 'Bearer ghs_test-token-0123456789', c.url);
        else assert.equal(c.auth, null, `the token reached ${c.url}`);
      }
      // A 503 health answer is not an identity: it is null, and the reason is kept.
      assert.equal(s.backend_health, null);
      assert.equal(s.unread.backend_health, 'status 503');
      assert.deepEqual(run.servingProblems(s), ['serving: backend_health was not read (status 503)']);
    });

    it('REGRESSION: with no token the 403 is recorded and becomes a problem for both heads', async () => {
      const s = await run.servingIdentity(cfg(''), bundle);
      const problems = run.servingProblems(s);
      assert.ok(problems.includes('serving: frontend_deploy.head_sha was not read (status 403)'), problems.join('\n'));
      assert.ok(problems.includes('serving: backend_deploy.head_sha was not read (status 403)'), problems.join('\n'));
    });
  });

  it('CONTRACT: the token is masked like a credential and no journey is given it', () => {
    const text = source('e2e/served/run.mjs');
    assert.match(text, /mask\(cfg\.username\); mask\(cfg\.password\); mask\(cfg\.githubToken\);/);
    assert.match(text, /delete env\.JOURNEY_GITHUB_TOKEN;/);
  });
});

// ── 3. always reset, and don't start a run that cannot finish ────────────────

describe('3 — the window, the budget and the final reset', () => {
  // London H:M in summer (BST, UTC+1) and in winter (GMT).
  const bst = (h, m = 0) => new Date(Date.UTC(2026, 6, 1, h - 1, m));
  const gmt = (h, m = 0) => new Date(Date.UTC(2026, 11, 1, h, m));

  it('CONTRACT: a run must end 20 minutes before 23:00 London, from the tz database, in both offsets', () => {
    assert.equal(run.minutesBeforeClose(bst(21, 55)), 45);
    assert.equal(run.minutesBeforeClose(gmt(21, 55)), 45);
    assert.equal(run.minutesBeforeClose(bst(22, 40)), 0);
    assert.equal(run.minutesBeforeClose(gmt(23, 30)), -50);
    assert.equal(run.londonTime(bst(9, 5)), '09:05');
  });

  for (const [label, at] of [['BST', bst], ['GMT', gmt]]) {
    it(`REGRESSION (${label}): a healthy UAT is not started with fewer than 45 minutes left — 21:55 runs, 21:56 does not`, () => {
      assert.equal(run.classifyHealth({ healthy: true, at: at(21, 55) }), 'run');
      assert.equal(run.classifyHealth({ healthy: true, at: at(21, 56) }), 'closing');
      assert.equal(run.classifyHealth({ healthy: true, at: at(22, 45) }), 'closing');
      assert.equal(run.classifyHealth({ healthy: true, at: at(23, 30) }), 'closing', 'healthy after the stop is not a run either');
    });
  }

  it('CONTROL: healthy early in the day, or at the window\'s opening, still runs; unhealthy keeps its two answers', () => {
    assert.equal(run.classifyHealth({ healthy: true, at: gmt(3) }), 'run');
    assert.equal(run.classifyHealth({ healthy: true, at: bst(11) }), 'run');
    assert.equal(run.classifyHealth({ healthy: false, at: bst(21, 56) }), 'down-in-window');
    assert.equal(run.classifyHealth({ healthy: false, at: gmt(23, 30) }), 'outside-window');
  });

  it('CONTRACT: the gate\'s "closing" verdict is a NOT RUN that skips the journeys, not a failure', () => {
    const text = source('e2e/served/run.mjs');
    assert.match(text, /if \(verdict === 'outside-window' \|\| verdict === 'closing'\) console\.log\(`::notice/);
    assert.match(text, /process\.exit\(verdict === 'down-in-window' \? 1 : 0\)/);
  });

  it('REGRESSION: the run itself refuses a served start too late for its budget (re-running the job reuses the gate\'s verdict)', () => {
    const text = source('e2e/served/run.mjs');
    assert.match(text, /if \(before < BUDGET\.runMinutes\) \{\s*throw new RunError\('window_closing'/);
    assert.ok(text.indexOf("throw new RunError('window_closing'") < text.indexOf('await signIn('), 'before the sign-in issues an OTP');
  });

  it('REGRESSION: the final reset runs in `finally`, so a failure part-way still puts the restaurant back', () => {
    const text = source('e2e/served/run.mjs');
    const fin = text.indexOf('} finally {', text.indexOf('async function main()'));
    assert.ok(fin > 0);
    assert.ok(text.indexOf('evidence.final_reset = await finalReset(', fin) > fin, 'the final reset is inside the finally block');
    const tryBody = text.slice(text.indexOf('async function main()'), fin);
    assert.equal(tryBody.match(/resetBetweenJourneys\(/g)?.length, 1, 'only the per-journey reset is left in the try block');
  });

  const fixture = { restaurant: ID, burger: 'b', cheese: 'c', rounding: 'r' };

  it('CONTROL: with no fixture there is nothing to undo, and nothing is attempted', async () => {
    let touched = false;
    const r = await run.finalReset({ fixture: undefined, refresh: async () => { touched = true; }, reset: async () => { touched = true; } });
    assert.deepEqual({ attempted: r.attempted, result: r.result }, { attempted: false, result: null });
    assert.equal(touched, false);
  });

  it('CONTROL: a reset that reads back canonical is recorded as succeeded', async () => {
    const r = await run.finalReset({ fixture, refresh: async () => {}, reset: async () => ({ closed_out: 2 }) });
    assert.deepEqual(r, { attempted: true, result: 'succeeded', closed_out: 2 });
  });

  it('REGRESSION: a refused refresh (refresh_refused) still attempts the reset, with the token in hand', async () => {
    let reset = false;
    const r = await run.finalReset({
      fixture,
      refresh: async () => { throw Object.assign(new Error('refresh answered 401'), { code: 'refresh_refused' }); },
      reset: async () => { reset = true; return { closed_out: 0 }; },
    });
    assert.equal(reset, true);
    assert.equal(r.result, 'succeeded');
  });

  it('REGRESSION: a reset that fails (board_not_clear) is recorded as failed, its detail redacted, and never throws', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoib3duZXIifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    const r = await run.finalReset({
      fixture,
      refresh: async () => {},
      reset: async () => { throw Object.assign(new Error(`1 submitted order(s) are still on the active board ${jwt}`), { code: 'board_not_clear' }); },
    });
    assert.equal(r.attempted, true);
    assert.equal(r.result, 'failed');
    assert.match(r.detail, /^board_not_clear: /);
    assert.ok(!r.detail.includes(jwt));
  });

  it('REGRESSION: a reset that hangs (UAT stopped mid-run) is cut off at its limit and recorded as failed', async () => {
    const r = await run.finalReset({ fixture, refresh: async () => {}, reset: () => new Promise(() => {}), limitMs: 50 });
    assert.equal(r.result, 'failed');
    assert.match(r.detail, /^final_reset_timeout: /);
  });

  it('CONTRACT: no journey is started without its minimum, and each is limited to what is left of the run', () => {
    const text = source('e2e/served/run.mjs');
    assert.match(text, /if \(left\(\) < BUDGET\.minJourneyMinutes \* MINUTE\) throw outOfTime\(j\.name\);/);
    assert.match(text, /const timeoutMs = Math\.min\(BUDGET\.journeyMinutes \* MINUTE, left\(\)\);/);
    assert.match(text, /const left = \(\) => deadline - BUDGET\.finalResetMinutes \* MINUTE - Date\.now\(\);/);
  });
});

// ── 4. redaction gaps, and a scan that does not trust redaction ──────────────

describe('4 — the redaction gaps the review measured', () => {
  const SIGNED = '.eJwNzDEOgDAIBdCrdK4mKFi5ilc6SoPv_7vq6xYjZ-kbq6Nmj8_EUUs';
  const CRED = 'Qm9vbGVhbkNyZWRlbnRpYWw0Mg';
  for (const [label, text, secret] of [
    ['a Django-signed value with %3A separators', `?x=${SIGNED}%3A1vDpFU%3Aabcdefghijklmnopqrstuvwxyz0123456789ABCDEFG`, SIGNED],
    ['a Django-signed value with lowercase %3a separators', `${SIGNED}%3a1vDpFU%3aabcdefghijklmnop`, SIGNED],
    ['a Django-signed value with %253A separators', `${SIGNED}%253A1vDpFU%253Aabcdefghijklmnop`, SIGNED],
    ['a Django-signed value with a signature under 20 characters', `${SIGNED}:1vDpFU:abc123`, SIGNED],
    ['a credential after #c=', `https://dinify-prod.web.app/diner/h/x#c=${CRED}`, CRED],
    ['a credential inside an encoded returnUrl', `/login?returnUrl=%2Fdiner%2Fh%2Fx%3Fc%3D${CRED}`, CRED],
    ['a credential inside a twice-encoded returnUrl', `/login?returnUrl=%252Fdiner%252Fh%253Fc%253D${CRED}`, CRED],
    ['a JWT with only its header and payload', 'token eyJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIn0 end', 'eyJ0b2tlbl90eXBlIjoiYWNjZXNzIn0'],
    ['a phone number written 0700…', 'call 0700000901 now', '0700000901'],
    ['a phone number written 0 700 …', 'call 0 700 000 901 now', '0 700 000 901'],
    ['a phone number written 0700 000 901', 'call 0700 000 901 now', '0700 000 901'],
    ['a phone number written 256 700 …', 'call 256 700 000 901 now', '256 700 000 901'],
    ['a phone number written +256 700 …', 'call +256 700 000 901 now', '256 700 000 901'],
  ]) {
    it(`REGRESSION: ${label} is redacted, and nothing findable is left`, () => {
      const out = redact.redactText(text);
      assert.ok(!out.includes(secret), out);
      assert.deepEqual(redact.scanText(out), []);
      assert.ok(redact.scanText(text).length > 0, 'the scan finds it before redaction');
    });
  }

  it('CONTROL: identifiers the evidence must keep are not taken for secrets', () => {
    for (const clean of [
      ID, SHA_A, 'ab0700000901cd2567000009010000000000aaaa', '2026-10-27T12:32:13.713550+00:00',
      '39847908896', '35011.30', 'main-OWTGDKLC.js', 'chunk-AB12CD34.js', 'sha256:5c9fbd71aa', '2026-07-01',
      'https://dinify-prod.web.app/diner/basket/order-complete', 'not_started_by_release_launcher',
      'closed out 0 7 tables',
    ]) {
      assert.equal(redact.redactText(clean), clean, clean);
      assert.deepEqual(redact.scanText(clean), [], clean);
    }
  });

  it('CONTROL: no check label a journey prints, and no declared skip, is changed by redaction', () => {
    // A journey's lines are redacted BEFORE they are parsed, so a pattern that
    // rewrote a label would turn a declared skip into an undeclared one.
    let labels = 0;
    for (const j of run.JOURNEYS) {
      const text = source(`e2e/${j.script}`);
      for (const m of text.matchAll(/check\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
        labels += 1;
        assert.equal(redact.redactText(m[2]), m[2], `${j.script}: ${m[2]}`);
      }
    }
    for (const skips of Object.values(lib.SERVED_SKIPS)) {
      for (const { name, reason } of skips) {
        assert.equal(redact.redactText(name), name);
        assert.equal(redact.redactText(reason), reason);
      }
    }
    assert.ok(labels > 300, `only ${labels} labels were found`);
  });

  it('REGRESSION: masking registers the twice-encoded form, and redaction removes it', () => {
    const value = `${SIGNED}:1vDpFU:sig/with+chars`;
    lib.mask(value);
    const twice = encodeURIComponent(encodeURIComponent(value));
    assert.ok(lib.knownSecrets().includes(twice));
    assert.ok(!redact.redactText(`?returnUrl=${twice}`).includes(twice));
  });
});

describe('4 — the scan hashes known secrets, independently of the redaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'served-hash-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  // No token shape at all, so no pattern can find it: only its hash can. The
  // second carries quotes, which JSON writes escaped.
  const SECRET = 'correct horse battery/staple';
  const QUOTED = 'correct "horse" battery/staple';
  const hashesOf = (values) => {
    const file = join(dir, `h-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(redact.secretHashes(values)));
    return file;
  };
  const scan = (text, hashes) => {
    const file = join(dir, `e-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, text);
    return spawnSync(process.execPath, [join(SERVED, 'redact.mjs'), 'scan', file, ...(hashes ? ['--hashes', hashes] : [])], {
      env: { PATH: process.env.PATH }, encoding: 'utf8',
    });
  };

  it('CONTRACT: the hash file holds a SHA-256 and a length per secret, never the value', () => {
    const doc = redact.secretHashes([SECRET, 'abcd', 'abc']);
    assert.equal(doc.schema, 'dinify.frontend.served-journeys.secret-hashes/1');
    assert.equal(doc.hashes.length, 2, 'a value under 4 characters is never a mask');
    const text = JSON.stringify(doc);
    assert.ok(!text.includes(SECRET) && !text.includes('horse') && !text.includes('"abcd"'));
    for (const h of doc.hashes) assert.match(h.sha256, /^[0-9a-f]{64}$/);
  });

  it('CONTROL: clean evidence with a real hash table scans clean (exit 0)', () => {
    const r = scan(JSON.stringify({ restaurant: ID, sha: SHA_A, check: 'the order reached the board' }), hashesOf([SECRET]));
    assert.equal(r.status, 0, r.stdout);
  });

  for (const [label, text, secret] of [
    ['as written, where no pattern can see it', JSON.stringify({ note: `x ${SECRET} y` }), SECRET],
    ['inside a JSON string, escaped', JSON.stringify({ detail: `x ${QUOTED} y` }), QUOTED],
    ['percent-encoded once', JSON.stringify({ url: `/x?next=${encodeURIComponent(SECRET)}` }), SECRET],
    ['percent-encoded twice', JSON.stringify({ url: `/x?next=${encodeURIComponent(encodeURIComponent(SECRET))}` }), SECRET],
  ]) {
    it(`REGRESSION: a known secret ${label} fails closed (exit 1), and its value is never printed`, () => {
      const r = scan(text, hashesOf([secret]));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /FOUND known-secret-hash/);
      assert.ok(!r.stdout.includes('horse') && !r.stderr.includes('horse'));
    });
  }

  it('REGRESSION: a runtime token the run masked is found by its hash in evidence the patterns cannot see into', () => {
    // A table session cut short so no pattern matches it any more.
    const token = 'tbl-session-7f3a9c2e41d8b6';
    assert.deepEqual(redact.scanText(token), [], 'no pattern matches it');
    const r = scan(JSON.stringify({ detail: `session ${token}` }), hashesOf([token]));
    assert.equal(r.status, 1, r.stdout);
  });

  it('REGRESSION: without the hash file, or with an unreadable or malformed one, the scan fails closed (exit 2)', () => {
    const clean = JSON.stringify({ restaurant: ID });
    assert.equal(scan(clean, null).status, 2, 'no --hashes');
    assert.equal(scan(clean, join(dir, 'absent.json')).status, 2, 'a missing hash file');
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ schema: 'dinify.frontend.served-journeys.secret-hashes/1', hashes: [{ length: 12, sha256: 'xyz' }] }));
    assert.equal(scan(clean, bad).status, 2, 'a malformed entry');
  });

  it('CONTRACT: the run writes the hash file from every masked value, before the evidence', () => {
    const text = source('e2e/served/run.mjs');
    const hashes = text.indexOf('writeFileSync(hashesPath, `${JSON.stringify(secretHashes(knownSecrets()))}\\n`, { mode: 0o600 })');
    assert.ok(hashes > 0);
    assert.ok(hashes < text.indexOf('writeFileSync(evidencePath, serializeEvidence(evidence)'));
  });
});

// ── 5. the evidence stays valid JSON ─────────────────────────────────────────

describe('5 — redaction keeps the evidence valid JSON', () => {
  it('REGRESSION: a secret-named field keeps its key; only the value is replaced', () => {
    const text = JSON.stringify({ body: { token: 'abcd1234', status: 'ok' } }, null, 2);
    const parsed = JSON.parse(redact.redactText(text));
    assert.deepEqual(parsed, { body: { token: '[redacted:secret-field]', status: 'ok' } });
  });

  it('REGRESSION: an X-Diner-* header in JSON keeps its key; only the value is replaced', () => {
    const text = JSON.stringify({ headers: { 'X-Diner-Session': 'abcdefghij0123456789' } });
    const parsed = JSON.parse(redact.redactText(text));
    assert.deepEqual(Object.keys(parsed.headers), ['X-Diner-Session']);
    assert.ok(!JSON.stringify(parsed).includes('abcdefghij0123456789'));
  });

  it('REGRESSION: the evidence as written parses, whatever was redacted, and carries none of it', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoib3duZXIifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    const evidence = {
      schema: run.EVIDENCE_SCHEMA,
      serving: { backend_health: { status: 'ok', token: 'abcd1234', phone: 256700000901, 'X-Diner-Session': 'abcdefghij0123456789' } },
      orchestrator: [{ name: 'a check', status: 'fail', detail: `{"refresh": "abcd1234"} Bearer ${jwt}` }],
      [`key ${jwt}`]: 'a key carrying a token',
      outcome: 'failed',
    };
    const written = run.serializeEvidence(evidence);
    const parsed = JSON.parse(written);
    assert.equal(parsed.outcome, 'failed');
    assert.equal(parsed.serving.backend_health.token, '[redacted:secret-field]');
    assert.equal(parsed.serving.backend_health.phone, '[redacted:msisdn]');
    for (const secret of [jwt, 'abcd1234', 'abcdefghij0123456789', '256700000901']) assert.ok(!written.includes(secret), secret);
    assert.deepEqual(redact.scanText(written), []);
  });

  it('REGRESSION: the scan refuses evidence that is not valid JSON (exit 1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'served-json-test-'));
    try {
      const file = join(dir, 'e.json');
      const hashes = join(dir, 'h.json');
      writeFileSync(file, '{"outcome": "passed", [redacted]}');
      writeFileSync(hashes, JSON.stringify(redact.secretHashes([])));
      const r = spawnSync(process.execPath, [join(SERVED, 'redact.mjs'), 'scan', file, '--hashes', hashes], { encoding: 'utf8' });
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /not valid JSON/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── 6. one buffer per stream ─────────────────────────────────────────────────

describe('6 — a child\'s stdout and stderr are split into lines separately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'served-child-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const ONE = 'first-mask-value-4b1d9e';
  const TWO = 'second-mask-value-8c2f7a';
  // Each write lands in its own chunk; the pauses order them across the two pipes.
  const child = join(dir, 'child.mjs');
  writeFileSync(child, `
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    process.stdout.write('::add-mask::${ONE.slice(0, 10)}');
    await wait(250);
    process.stderr.write('a warning on stderr\\n');
    await wait(250);
    process.stdout.write('${ONE.slice(10)}\\n');
    await wait(250);
    process.stderr.write('stderr without its newline yet ');
    await wait(250);
    process.stdout.write('::add-mask::${TWO}\\n');
    await wait(250);
    process.stderr.write('done\\n');
    await wait(250);
    process.stdout.write('PASS  a check that names ${ONE} and ${TWO}\\n');
  `);

  it('REGRESSION: a partial ::add-mask:: line is completed by its own stream, so the right value is masked and none is echoed', async () => {
    const echoed = [];
    const res = await run.runChild(child, { PATH: process.env.PATH }, 20000, { echo: (l) => echoed.push(l) });
    assert.equal(res.code, 0);
    assert.ok(lib.knownSecrets().includes(ONE), 'the first value was masked whole');
    assert.ok(lib.knownSecrets().includes(TWO), 'the second value was masked');
    const all = echoed.join('\n');
    for (const part of [ONE, TWO, ONE.slice(10)]) assert.ok(!all.includes(part), `echoed: ${part}`);
    assert.ok(!all.includes('::add-mask::'), 'no mask command is echoed');
    assert.ok(echoed.includes('  | a warning on stderr'));
    assert.ok(echoed.includes('  | stderr without its newline yet done'));
    assert.ok(echoed.includes('  | PASS  a check that names *** and ***'), all);
    assert.equal(res.out.includes(ONE) || res.out.includes(TWO), false);
  });
});

// ── 7. the probes interlock themselves ───────────────────────────────────────

describe('7 — the probes run the interlock before their first request', () => {
  const srv = loopback();
  before(() => srv.start());
  after(() => srv.stop());
  const fixture = { restaurant: ID, burger: 'b', tables: { 901: { credential: 'c'.repeat(30) } } };
  const call = (over = {}) => probes.runProbes({
    api: srv.api, token: 't', fixture, check: () => {}, restaurantId: ID, restaurantName: NAME, ...over,
  });

  it('REGRESSION: a restaurant the server does not report as a test restaurant is refused after one read, before any probe request', async () => {
    srv.seen.length = 0;
    srv.reply = () => [200, restaurantRow({ is_test: false })];
    await assert.rejects(call(), (e) => e instanceof lib.InterlockError && /test restaurant/.test(e.message));
    assert.deepEqual(srv.seen, [`GET /api/v1/restaurant-setup/details/?record=restaurants&id=${ID}`]);
  });

  it('REGRESSION: a fixture naming another restaurant is refused before any request at all', async () => {
    srv.seen.length = 0;
    srv.reply = () => [200, restaurantRow()];
    await assert.rejects(call({ fixture: { ...fixture, restaurant: '00000000-0000-4000-8000-000000000000' } }), lib.InterlockError);
    assert.deepEqual(srv.seen, []);
  });

  it('REGRESSION: an unset restaurant name is refused before any request', async () => {
    srv.seen.length = 0;
    await assert.rejects(call({ restaurantName: '' }), lib.InterlockError);
    assert.deepEqual(srv.seen, []);
  });

  it('CONTROL: once the interlock passes, the probes go on and make their requests', async () => {
    srv.seen.length = 0;
    srv.reply = (req) => (req.url.includes('restaurant-setup/details') ? [200, restaurantRow()] : [404, { status: 404 }]);
    const r = await call();
    assert.deepEqual(r, { draftsCreated: 0 });
    assert.ok(srv.seen.includes('GET /api/v1/orders/journey/table-scan/'), srv.seen.join('\n'));
  });

  it('REGRESSION: the interlock read is the probes\' first request', async () => {
    srv.seen.length = 0;
    srv.reply = (req) => (req.url.includes('restaurant-setup/details') ? [200, restaurantRow()] : [404, { status: 404 }]);
    await call();
    assert.deepEqual(srv.seen.slice(0, 2), [
      `GET /api/v1/restaurant-setup/details/?record=restaurants&id=${ID}`,
      'GET /api/v1/orders/journey/table-scan/',
    ]);
  });

  it('CONTRACT: the orchestrator hands the probes the configured id and name', () => {
    assert.match(source('e2e/served/run.mjs'), /runProbes\(\{ \.\.\.base, token: auth\.session\.token, fixture, check: note\('probes'\) \}\)/);
  });
});

// ── 8. the kitchen journey never falls back to another membership ────────────

describe('8 — the kitchen membership fails closed on a served run', () => {
  const OTHER = '00000000-0000-4000-8000-000000000000';
  const session = { profile: { restaurant_roles: [{ restaurant_id: OTHER, roles: ['owner'] }] } };

  it('REGRESSION: a served session with no membership of the fixture restaurant is refused, not given the first one', () => {
    const T = lib.journeyTarget({ target: 'served', restaurant: ID }, { api: 'https://api.example.invalid', journey: 'kitchen' });
    assert.throws(() => T.membership(session, ID), lib.InterlockError);
  });

  it('CONTROL: a served session that holds the membership gets exactly it', () => {
    const mine = { restaurant_id: ID, roles: ['manager'] };
    const T = lib.journeyTarget({ target: 'served', restaurant: ID }, { api: 'https://api.example.invalid', journey: 'kitchen' });
    assert.equal(T.membership({ profile: { restaurant_roles: [session.profile.restaurant_roles[0], mine] } }, ID), mine);
  });

  it('CONTROL: a seeded local run keeps its old fallback to the first membership', () => {
    const T = lib.journeyTarget({ restaurant: ID }, { api: 'http://127.0.0.1:8099', journey: 'kitchen' });
    assert.equal(T.membership(session, ID), session.profile.restaurant_roles[0]);
  });

  it('REGRESSION: kitchen.mjs selects through T.membership — first right after the interlock, before any write — and has no `?? roles[0]`', () => {
    const text = source('e2e/kitchen-board/kitchen.mjs');
    assert.doesNotMatch(text, /\?\?\s*roles\[0\]/);
    assert.match(text, /const membership = T\.membership\(session, F\.restaurant\);/);
    const guard = text.indexOf('await T.guard(session?.token);');
    const early = text.indexOf('T.membership(session, F.restaurant);', guard);
    assert.ok(guard > 0 && early > guard);
    assert.ok(early < text.indexOf('await operator(', guard), 'before the first operator command');
  });
});
