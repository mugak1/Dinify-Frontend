/**
 * SHARED SUPPORT FOR RUNNING THE ACCEPTED JOURNEYS AGAINST WHAT SERVES.
 *
 * Imported by the orchestrator (`run.mjs`), the provisioner (`provision.mjs`),
 * the probes (`probes.mjs`) and — through `journeyTarget()` — by each journey.
 * It holds no assertion of any journey. What it holds is the few facts a served
 * run needs that a seeded local run never did:
 *
 *   * ONE CANONICAL CATALOGUE, the same values `checkout-journey/seed.py` writes
 *     through the ORM, stated once so provisioning, the per-journey restores and
 *     the verification after each journey cannot disagree about "put back";
 *   * THE INTERLOCK — no write is made unless the restaurant's id, name and
 *     server-reported `is_test` all match what the operator configured;
 *   * MASKING — every runtime secret is announced to the Actions runner as soon
 *     as it exists, and everything printed or written goes through `redact.mjs`;
 *   * PACING and NAMED SKIPS — the only two ways a journey's behaviour differs on
 *     a served target, both visible in its output.
 *
 * Node 24, no dependency outside the standard library.
 */

/** The OTP the journeys verify with. ENV=dev on the UAT backend fixes it; that is
 *  a protected decision, and it is deliberately NOT configurable here, so this
 *  harness can never be pointed at a real code. */
export const DEV_OTP = '1234';

/** The accepted check counts of each journey (their READMEs, 2026-10). A served
 *  run reports PASS + FAIL + SKIP against these; a different total means a
 *  different path from the accepted evidence and fails the run. */
export const ACCEPTED_COUNTS = Object.freeze({
  journey: 43, recovery: 154, equivalence: 21, kitchen: 55, billing: 56,
});

// ── the declared served-target skips ─────────────────────────────────────────
//
// EVERY check a served run does not execute, by its exact label, with the reason
// it cannot run there. A journey may skip ONLY a label listed here (anything
// else throws), and the orchestrator fails a run whose skips differ from this
// list in either direction. `tests/served.test.mjs` pins that every label here
// is a label the journey's own source really asserts. A skip is never a pass.

const SIGN_IN_ONCE = 'signing in is done ONCE per run by e2e/served/run.mjs, to stay inside the D11 OTP budget '
  + '(one issuance per run); the sign-in itself is the orchestrator check "the operator signs in with password and '
  + 'the development OTP"';
const NO_DEV_HANDLE = 'needs Angular\'s dev-mode `window.ng` handle, and the served bundle is the optimized '
  + '`ng build --configuration=uat`, which exposes none (measured: `typeof window.ng === "undefined"`)';
const DASHBOARD_REAL_BRANCH = `${NO_DEV_HANDLE} to flip DashboardService.USE_MOCK_DATA at runtime; the committed build `
  + 'serves the mock dashboard, so no real dashboard-v2 request can be produced on the served stack';
const LEGACY_RESTAURANT = 'needs a SECOND restaurant carrying the legacy billable columns (subscription_expiry_date, '
  + 'flat_fee, preferred_subscription_method); no operator API writes them, and a served run acts on one restaurant';
const RECORDED_RESTAURANT = 'needs a SECOND restaurant with canonical subscription terms (written only on the Admin '
  + 'plane) and a subscription transaction row (no API creates one: the collector answers 501); the 501 itself is '
  + `replayed on the wire by the served probe "D07: …"; the client half also ${NO_DEV_HANDLE}`;
const RETIRED_SEQUENCE = `replays the retired OTP-then-collect sequence through the app's own ApiService, which ${NO_DEV_HANDLE}; `
  + 'it also runs in the recorded-terms restaurant\'s session';

const named = (reason, ...names) => names.map((name) => ({ name, reason }));

export const SERVED_SKIPS = Object.freeze({
  journey: named(SIGN_IN_ONCE, 'the fixture operator can sign in'),
  equivalence: named(SIGN_IN_ONCE, 'the fixture operator can sign in'),
  recovery: [],
  kitchen: named(SIGN_IN_ONCE, 'the fixture operator can sign in'),
  billing: [
    ...named(DASHBOARD_REAL_BRANCH,
      'the real-data branch was selected by a TEST-ONLY runtime flip',
      'an AUTHORIZED dashboard-v2 request really reached the server',
      'the SERVER declares that settlement is not measured',
      'the revenue headline is WITHHELD, not rendered',
      'the revenue chart is not drawn',
      'no percentage is computed for the comparison window',
      'the unmeasured pills are withheld and REFUNDS is not',
      'the paid/unpaid split is withheld on Total Orders',
      'the Tables card is wired to the decision at last',
      'the tables history tiles are withheld',
      'the payment-methods card claims nothing about the period',
      'occupancy is NOT withheld — it is live floor state'),
    ...named(LEGACY_RESTAURANT,
      'the fixture really is legacy-billable on the wire',
      '...with NO canonical terms beside it',
      'THE SCREEN STILL SAYS NO CURRENT TERMS',
      'no "Active" badge is derived from the legacy flag',
      'no next-billing date is derived from the legacy expiry',
      'the legacy flat_fee is not rendered as a price'),
    ...named(RECORDED_RESTAURANT,
      'the recorded terms are rendered',
      'the canonical decimal scale survives to the screen',
      'the recurrence is stated as an interval, not a plan name',
      'no absence or unavailable state is shown beside it',
      'the history row renders the amount the serializer emits',
      'history is not in a failed or loading state',
      'the financial-row witness is readable before the probe',
      'the collector request really went through the app',
      'THE SERVER ANSWERED 501 — observed on the wire, before any interceptor',
      '...carrying the machine reason a client branches on',
      '...and the sentence that is about THIS REQUEST and nothing else',
      'the client reports it as a refusal rather than a success',
      'the ErrorInterceptor surfaces the SERVER’s own sentence, not a generic one',
      'CONTROL: an id this operator cannot manage is 404 at the gate, NOT 501',
      'CONTROL: ...and both are refused at the client too',
      'NO FINANCIAL ROW WAS CREATED by any of the three attempts',
      'no verification code was dispatched before or during it',
      'the refusal is surfaced to the operator rather than swallowed'),
    ...named(RETIRED_SEQUENCE,
      'the retired sequence ran',
      'THE OTP CAME FIRST, then the collection attempt',
      'the collection attempt is refused 501 ON THE WIRE, so the code was spent for nothing',
      '...and the client reports that refusal',
      'NO REAL CHALLENGE WAS DISPATCHED — the harness answered it'),
  ],
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// ── the canonical catalogue ──────────────────────────────────────────────────
//
// Byte-for-byte the semantics of e2e/checkout-journey/seed.py. Names are the
// journeys' locators, prices are their goldens, option ids are in their
// assertions (`{"g-size":["c-large"]}`), and '1.005' stays a STRING because the
// sub-cent golden depends on the exact decimal, not on a float's repr.

export const SECTION_NAME = 'Mains';
export const AREA_NAME = 'E2E Journeys';

export const BURGER_OPTIONS = Object.freeze({
  hasModifiers: true,
  groups: [{
    id: 'g-size', name: 'Size', selectionType: 'single',
    minSelections: 1, maxSelections: 1,
    choices: [
      { id: 'c-reg', name: 'Regular', additionalCost: 0, available: true },
      { id: 'c-large', name: 'Large', additionalCost: 3500, available: true },
    ],
  }],
});

export const ROUNDING_OPTIONS = Object.freeze({
  hasModifiers: true,
  groups: [{
    id: 'g-round', name: 'Rounding', selectionType: 'single',
    minSelections: 1, maxSelections: 1,
    choices: [
      { id: 'c-half-even-down', name: 'Half Even Down', additionalCost: '1.005', available: true },
      { id: 'c-half-even-up', name: 'Half Even Up', additionalCost: '1.015', available: true },
    ],
  }],
});

/** The three dishes, keyed by the fixture field each one fills. */
export const CANONICAL_ITEMS = Object.freeze({
  cheese: {
    name: 'Extra Cheese', primary_price: '2000.00', is_extra: true,
    has_extras: false, options: null,
  },
  burger: {
    name: 'Signature Burger', primary_price: '10000.00', is_extra: false,
    has_extras: true, options: BURGER_OPTIONS,
    // ONE applicable extra, so the maximum is ONE — `menu_relationships`
    // validates the complete effective state on every write (see seed.py).
    extras_min_selections: 0, extras_max_selections: 1,
  },
  rounding: {
    name: 'Rounding Test', primary_price: '10.00', is_extra: false,
    has_extras: false, options: ROUNDING_OPTIONS,
    extras_min_selections: 0, extras_max_selections: 0,
  },
});

/**
 * THE TABLE POOL. A small, fixed set — so a run never creates a table it did not
 * already have, and growth is bounded by construction.
 *
 * `checkout` serves the three checkout scripts and the probes, which only need
 * the table FREE (no submitted order on it), and `closeOutBoard` makes it so.
 * The kitchen journey needs more: it finds its cards on the Completed board by
 * their daily ticket number, the Completed feed spans 24 hours, and the counter
 * restarts at midnight EAT — which falls inside the UAT window. A previous day's
 * `#005` can therefore sit beside today's. Each kitchen run takes a pool table
 * that has NO ticket on either board, and its cards are located by number AND by
 * that table's label, so nothing an earlier run left can satisfy or break them.
 * Labels are chosen so none is a substring of another.
 */
export const CHECKOUT_TABLE = Object.freeze({ number: 901, label: 'E2E checkout' });
export const KITCHEN_TABLES = Object.freeze(
  [1, 2, 3, 4, 5, 6, 7].map((n) => ({ number: 910 + n, label: `E2E kitchen ${n}` })),
);

// ── HTTP ─────────────────────────────────────────────────────────────────────

/** A bounded JSON request. Never throws on an HTTP status; throws on transport. */
export async function request(base, path, { method = 'GET', body, token, headers = {}, timeoutMs = 30000 } = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not every reply is JSON */ }
  return { status: res.status, body: json, text };
}

export const isLoopback = (url) => {
  try { return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(url).hostname); }
  catch { return false; }
};

// ── masking ──────────────────────────────────────────────────────────────────

const KNOWN = new Set();

/**
 * Announce a runtime secret. Under GitHub Actions the runner then replaces it in
 * every later log line; everywhere, `redact.mjs` replaces it in anything this
 * harness prints or writes. Call it the moment the value exists — before any
 * other line could carry it.
 */
export function mask(value) {
  if (typeof value !== 'string' || value.length < 4) return;
  KNOWN.add(value);
  // An encoded form can reach a URL, so it is masked too.
  const encoded = encodeURIComponent(value);
  if (encoded !== value) KNOWN.add(encoded);
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::add-mask::${value}\n`);
    if (encoded !== value) process.stdout.write(`::add-mask::${encoded}\n`);
  }
}
export const knownSecrets = () => [...KNOWN];

// ── the interlock ────────────────────────────────────────────────────────────

export class InterlockError extends Error {
  constructor(message) { super(message); this.name = 'InterlockError'; }
}

/**
 * REFUSE TO ACT unless the server says the configured restaurant is the one we
 * think it is, and that it is a TEST restaurant.
 *
 * Read off `restaurant-setup/details/` — the owner's settings-module read of the
 * canonical row (`SerializerGetRestaurantDetail`, `fields='__all__'`), which is
 * the customer-plane surface that exposes `is_test`. A 404 there means the
 * restaurant is unknown, deleted or not this principal's, and is a refusal too.
 * All three facts are required: an id alone could be mistyped into a real
 * customer's, a name alone is not unique, and `is_test` is what keeps these
 * orders out of every report a real restaurant reads.
 */
export async function assertTestRestaurant({ api, token, restaurantId, restaurantName }) {
  if (!isUuid(restaurantId)) throw new InterlockError('JOURNEY_RESTAURANT_ID is not a canonical lowercase UUID');
  if (typeof restaurantName !== 'string' || restaurantName.trim() === '') {
    throw new InterlockError('JOURNEY_RESTAURANT_NAME is not set');
  }
  const r = await request(api, `/api/v1/restaurant-setup/details/?record=restaurants&id=${restaurantId}`, { token });
  if (r.status !== 200) throw new InterlockError(`the restaurant details read answered ${r.status}, not 200`);
  const d = r.body?.data;
  if (!d || typeof d !== 'object') throw new InterlockError('the restaurant details read carried no data object');
  if (d.id !== restaurantId) throw new InterlockError('the server returned a different restaurant id');
  if (d.name !== restaurantName) throw new InterlockError('the restaurant name does not equal JOURNEY_RESTAURANT_NAME');
  if (d.is_test !== true) throw new InterlockError(`the server does not report it as a test restaurant (is_test=${JSON.stringify(d.is_test)})`);
  if (d.deleted === true) throw new InterlockError('the restaurant is soft-deleted');
  return { status: d.status, accepting_orders: d.accepting_orders };
}

/** The interlock configuration a run was given, from the environment. */
export const interlockConfig = () => ({
  restaurantId: process.env.JOURNEY_RESTAURANT_ID,
  restaurantName: process.env.JOURNEY_RESTAURANT_NAME,
});

// ── what a journey needs to know about its target ────────────────────────────

/**
 * The served-target adapter a journey calls ONCE, at the top.
 *
 * On a seeded local run (`F.target` absent, loopback API) it changes nothing:
 * `served` is false, `pace` is the identity, and `guard` only enforces the
 * interlock if one was configured. On anything else it requires a provisioned
 * fixture AND the interlock, and refuses outright otherwise — so a journey
 * pointed at a non-local API without them does nothing at all.
 */
export function journeyTarget(F, { api, journey, format = 'checkout' }) {
  const served = F?.target === 'served';
  const scale = Number(process.env.JOURNEY_WAIT_SCALE || '1');
  const factor = Number.isFinite(scale) && scale >= 1 ? scale : 1;
  const declared = new Map((SERVED_SKIPS[journey] ?? []).map((s) => [s.name, s.reason]));
  // Set only when this journey's own interlock PASSED on a served run, so the
  // restore below can never write to a restaurant the interlock refused.
  let cleared = false;
  return {
    served,
    /** Fixed pauses are multiplied on a remote target and never shortened. A
     *  longer pause makes a negative check stricter and a positive one more
     *  patient; it changes no assertion. */
    pace: (ms) => Math.round(ms * factor),
    /** The shared operator session, in served mode. */
    session: served ? F.operator?.session ?? F.session ?? null : null,
    token: served ? (F.operator?.session ?? F.session)?.token ?? null : null,
    /** A DECLARED, NAMED skip, printed in the journey's own format and counted
     *  by the orchestrator. Never a pass; an undeclared label is a programming
     *  error, not a quiet skip. */
    skip(name) {
      if (!declared.has(name)) throw new Error(`"${name}" is not a declared served skip for ${journey}`);
      console.log(format === 'billing' ? `  SKIP ${name}  — ${declared.get(name)}` : `SKIP  ${name}  — ${declared.get(name)}`);
    },
    /** Announce a value this journey minted (a table session) the moment it
     *  exists. The orchestrator intercepts the line, registers the value for
     *  redaction and passes the command to the runner; it is never echoed. */
    mask(value) {
      const piped = process.env.JOURNEY_MASK_PIPE === '1' || process.env.GITHUB_ACTIONS === 'true';
      if (served && piped && typeof value === 'string' && value.length >= 4) {
        process.stdout.write(`::add-mask::${value}\n`);
      }
    },
    /** The interlock, before the journey writes or reads anything else. */
    async guard(token) {
      const cfg = interlockConfig();
      const configured = Boolean(cfg.restaurantId || cfg.restaurantName);
      if (!served && isLoopback(api) && !configured) return;
      if (!served && !isLoopback(api)) {
        throw new InterlockError('a non-loopback API needs a fixture written by e2e/served/provision.mjs');
      }
      if (served && F.restaurant !== cfg.restaurantId) {
        throw new InterlockError('the fixture names a different restaurant from JOURNEY_RESTAURANT_ID');
      }
      await assertTestRestaurant({ api, token, ...cfg });
      cleared = served;
    },
    /** The journey's last act on every exit path: put back what it changed. A
     *  served run ONLY, and only once its interlock passed; a seeded local run
     *  restores nothing, exactly as before. */
    async restore(token) {
      if (!served || !cleared || !token) return [];
      return restoreCanonical({ api, token, F });
    },
  };
}

/**
 * Put the catalogue back to its canonical state — what each journey's `finally`
 * calls, so a journey that throws half-way never leaves a price raised, a dish
 * sold out or the restaurant paused. Best-effort by design: it reports, and the
 * orchestrator VERIFIES the canonical state after every journey anyway.
 */
export async function restoreCanonical({ api, token, F }) {
  const problems = [];
  const put = async (path, body) => {
    try {
      const r = await request(api, path, { method: 'PUT', body, token });
      // "no changes" is the expected answer when nothing moved.
      if (r.status !== 200 && !/no changes/i.test(r.body?.message || '')) {
        problems.push(`${path} ${r.status}`);
      }
    } catch (e) { problems.push(`${path} ${e.name}`); }
  };
  if (F.burger) {
    await put('/api/v1/restaurant-setup/menuitems/', {
      id: F.burger, primary_price: CANONICAL_ITEMS.burger.primary_price,
      options: JSON.stringify(BURGER_OPTIONS), in_stock: true, available: true,
    });
  }
  if (F.rounding) {
    await put('/api/v1/restaurant-setup/menuitems/', {
      id: F.rounding, primary_price: CANONICAL_ITEMS.rounding.primary_price,
      options: JSON.stringify(ROUNDING_OPTIONS), in_stock: true, available: true,
    });
  }
  if (F.restaurant) {
    await put('/api/v1/restaurant-setup/restaurants/', { id: F.restaurant, accepting_orders: true });
  }
  if (problems.length) console.log(`RESTORE  incomplete — ${problems.join('; ')}`);
  return problems;
}
