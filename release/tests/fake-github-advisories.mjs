/**
 * A RECORDED GITHUB ADVISORY SERVICE FOR THE RELEASE TESTS — the clock's analogue of the
 * recorded npm (fake-npm.mjs) and the recorded `gh` (harness.mjs).
 *
 * WHY. Since CI-signal A-2 the real `assess` asks `GET https://api.github.com/advisories/{id}`
 * when each advisory became reportable (dependency-audit/lib/advisories.mjs), from a child
 * process it spawns. In a test that must not reach the network, and the answer has to be
 * controllable. This module is that seam: loaded with `--import` (harness.mjs puts it in
 * NODE_OPTIONS for every child), it replaces `fetch` for advisory URLs ONLY and leaves
 * every other request — the local HTTPS origins the tests serve — to the real one.
 *
 * WHERE SYNTHETIC ANSWERS ENTER, AND NOWHERE ELSE: the table named by
 * FAKE_GITHUB_ADVISORIES, delivered at the process boundary where GitHub's answer enters.
 * Absent a table, every advisory is a 404 — what GitHub answers for an id it does not
 * hold — so a test that does not set one sees no date, and blocks, as before A-2. Each
 * request is logged to FAKE_GITHUB_ADVISORIES_LOG with whether it carried a token.
 *
 * A table entry is either {status, body} verbatim, {reviewed, published} (a record of that
 * advisory with those instants), or {hang: true} (no answer until the caller gives up).
 *
 * It is not a production seam: nothing in release/ or dependency-audit/ reads these
 * variables, and the scanner never receives NODE_OPTIONS (npm.mjs scannerEnvironment).
 */

import { appendFileSync, readFileSync } from 'node:fs';

const PREFIX = 'https://api.github.com/advisories/';
const realFetch = globalThis.fetch;

export const recordFor = (id, { reviewed = null, published = null } = {}) => JSON.stringify({
  ghsa_id: id, type: 'reviewed', severity: 'high', published_at: published, updated_at: published, github_reviewed_at: reviewed, nvd_published_at: null, withdrawn_at: null,
});

function table() {
  try { return JSON.parse(readFileSync(process.env.FAKE_GITHUB_ADVISORIES, 'utf8')); } catch { return {}; }
}

globalThis.fetch = async function fakeAdvisoryFetch(input, init = {}) {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input?.url);
  if (!url.startsWith(PREFIX)) return realFetch(input, init);
  const id = url.slice(PREFIX.length);
  const headers = new Headers(init.headers ?? {});
  if (process.env.FAKE_GITHUB_ADVISORIES_LOG) {
    appendFileSync(process.env.FAKE_GITHUB_ADVISORIES_LOG, `${JSON.stringify({ id, authorized: headers.has('authorization') })}\n`);
  }
  const entry = table()[id];
  if (entry?.hang) {
    // A real request in flight holds the event loop open (its socket); an AbortSignal.timeout
    // timer does not. Without this the process would simply exit before the bound fired,
    // and a "timeout" would never be the answer observed.
    const held = setInterval(() => {}, 1_000);
    await new Promise((_, reject) => {
      const stop = () => { clearInterval(held); reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })); };
      if (init.signal?.aborted) stop(); else init.signal?.addEventListener('abort', stop, { once: true });
    });
  }
  if (!entry) return new Response('{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}', { status: 404 });
  const body = entry.body ?? recordFor(id, entry);
  return new Response(body, { status: entry.status ?? 200, headers: { 'content-type': 'application/json' } });
};
