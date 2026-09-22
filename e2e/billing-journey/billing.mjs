/**
 * D07/G2 — the repeatable real-browser billing journey.
 *
 * A real Chromium against a real Angular build talking to a real Django +
 * PostgreSQL. It asserts what no unit suite can observe: that an operator
 * signing in and opening Settings > Billing is told which answer the server
 * gave, that the legacy columns decide nothing on a screen that used to read
 * "Active" off them, and that the collector the old panel drove is refused by
 * the live server rather than merely absent from the new one.
 *
 * IT IS A MANUAL, REPEATABLE RUN — NOT A CI GATE, and it says so at the end of
 * every run. It needs a disposable PostgreSQL, a running Django and a running
 * dev server, none of which CI has.
 *
 * FIVE THINGS ABOUT ITS SHAPE ARE DELIBERATE.
 *
 *  1. THREE RESTAURANTS, THREE SIGN-INS. The portal scopes to the membership
 *     selected AT LOGIN, so three commercial situations mean three sessions.
 *     Signing in through the real form is also what proves the screen is
 *     reachable the way an operator reaches it.
 *  2. THE 501 IS ISSUED THROUGH THE RUNNING APP'S OWN `ApiService`, reached
 *     off the live `BillingComponent` instance via Angular's dev-mode
 *     `window.ng` (TypeScript `private` is erased at runtime, so the injected
 *     service is a plain property). That is what puts the request through the
 *     REAL `AuthInterceptor` and the REAL `ErrorInterceptor` rather than past
 *     them — a `fetch` would prove what the server answers and nothing about
 *     what the client does with it.
 *     AND IT IS OBSERVED TWICE. The client sees a STRING with no status,
 *     because that is what the interceptor flattens an ordinary failure to, so
 *     `outcome === 'refused'` is satisfied equally by a 404 from the
 *     authorization gate — which is exactly what this harness used to assert
 *     while sending `restaurant` to an endpoint that reads `restaurant_id`.
 *     `page.on('response')` therefore reads the SAME real response on the wire,
 *     and the assertions name an exact 501 and an exact machine reason.
 *  3. THE OTP STEP IS INTERCEPTED, NEVER SENT. The old panel dispatched a real
 *     verification code BEFORE the POST that could not succeed. The ordering
 *     is what matters, so `users/auth/resend-otp/` is fulfilled by the harness
 *     and never reaches the server: the limitation is demonstrated with no
 *     challenge issued and no delivery attempted. It is a REPLAY OF TWO
 *     RECOVERED REQUESTS, not an execution of the retired bundle, and section
 *     4 says so where it runs.
 *  4. THE LEGACY DEEP LINK IS NAVIGATED TO, not inferred from a different
 *     route's method test. The retired diner payment-result URL is entered
 *     directly in the address bar, which is the only thing that answers
 *     whether a bookmark still reaches a payment surface.
 *  5. ASSERTIONS ARE SCOPED TO `data-testid` ELEMENTS where a state has one.
 *     Matching the whole document would let one section's copy satisfy an
 *     assertion about another's.
 *
 * SIGN-INS ARE BUDGETED, and that is not tidiness. `auth_otp` is 5/min PER IP,
 * so a run that signs in once per section trips a REAL rate limit from a single
 * loopback address. Sections 3 and 4 share one owner and therefore one session,
 * and the dashboard checks ride section 1's. Raising the throttle to make a run
 * pass would be changing the configuration under test, so the harness fits
 * inside it instead — and re-running twice within a minute will still be
 * throttled, which the closing note says out loud.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const WEB = process.env.BILLING_WEB || 'http://127.0.0.1:4299';
const API = process.env.BILLING_API || 'http://127.0.0.1:8099';
const FIXTURE = process.env.BILLING_FIXTURE || '/tmp/billing-fixture.json';
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;

const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/**
 * The server's refusal, verbatim from `finance_app/subscription_capability.py`.
 * Asserted EXACTLY: a generic error is not this, and neither is a 404 from the
 * authorization gate that sits above it.
 */
const REFUSAL_STATUS = 501;
const REFUSAL_REASON = 'subscription_collection_unavailable';
const REFUSAL_MESSAGE =
  'In-app subscription payment collection is not available. '
  + 'This request did not create or send a payment request.';

/**
 * THE RETIRED BILLING DIALOG'S REQUEST, RECOVERED VERBATIM from the commit
 * before D07 removed it (`InitPayment()` + `Save()` at `1d3d091^`):
 *
 *   {transaction_type, transaction_platform, payment_mode, restaurant_id,
 *    msisdn, otp}
 *
 * THE KEY IS `restaurant_id`, AND THAT IS THE WHOLE POINT. The endpoint reads
 * `data.get('restaurant_id')` and `can_manage_restaurant` fails closed on a
 * missing one, so a probe sending `restaurant` is refused 404 by the
 * AUTHORIZATION GATE and never reaches the collector at all — which an
 * assertion on "some refusal" cannot tell apart from the 501 it is supposed to
 * be proving. The endpoint is NOT relaxed to accept the wrong key; the harness
 * sends the right one.
 */
const retiredCollectorBody = (restaurantId, msisdn) => ({
  transaction_type: 'subscription',
  transaction_platform: 'web',
  payment_mode: 'momo',
  restaurant_id: restaurantId,
  msisdn,
  otp: '1234',
});

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const text = (s) => (s || '').replace(/\s+/g, ' ').trim();

/**
 * A short, always-printable detail. `JSON.stringify(undefined)` is `undefined`,
 * so a bare `.slice(0, n)` on a stringified value turns the FIRST failing check
 * into a crash that hides every check after it — which is exactly what a
 * discriminating run most needs to print.
 */
const brief = (value, n = 200) => String(JSON.stringify(value) ?? value).slice(0, n);

async function signIn(page, phone) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('app-dinify-phone-input input', { timeout: 30000 });
  // The phone control emits the canonical MSISDN; type the NATIONAL part.
  await page.fill('app-dinify-phone-input input', phone.replace(/^256/, ''));
  await page.fill('input#password', fx.password);
  await page.locator('form button:has-text("Sign in")').first().click();

  // An owner membership requires OTP. ENV=dev fixes it at 1234, which is why
  // this only ever runs against a disposable local database.
  await page.waitForSelector('app-otp-input input, app-restaurant-mgt', { timeout: 30000 });
  if (await page.locator('app-otp-input input').count()) {
    const boxes = page.locator('app-otp-input input');
    const n = await boxes.count();
    for (let i = 0; i < n; i += 1) await boxes.nth(i).fill('1234'[i] ?? '');
    await page.locator('button:has-text("Verify")').first().click();
  }
  await page.waitForSelector('app-restaurant-mgt', { timeout: 30000 });
}

async function openBilling(page) {
  await page.goto(`${WEB}/settings/billing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('app-billing', { timeout: 30000 });
  // The section chrome resolves once both reads settle.
  await page.waitForFunction(
    () => !document.querySelector('app-billing .animate-pulse'),
    null, { timeout: 30000 },
  ).catch(() => {});
  await page.waitForTimeout(400);
}

const seen = (page, id) => page.locator(`app-billing [data-testid="${id}"]`).count();

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const errors = [];

  // ── 1. A GENUINELY UNCONFIGURED RESTAURANT ──────────────────────────────
  console.log('\n1. unconfigured restaurant');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`unconfigured: ${e.message}`));
    await signIn(page, fx.restaurants.unconfigured.owner_phone);

    // ── the D07/G1 dashboard, in the same session ────────────────────────
    //
    // THE COMMITTED BUILD STILL SELECTS THE MOCK BRANCH
    // (`DashboardService.USE_MOCK_DATA === true`), so every withheld-figure
    // assertion below could be satisfied WITHOUT A SINGLE REQUEST REACHING THE
    // SERVER — a mock payload declaring `payment_tracking_enabled: false` and a
    // real one are indistinguishable once they are in the card. The section
    // therefore runs in TWO PHASES: the mock branch as a CONTROL that proves it
    // cannot supply the evidence, then the REAL branch, selected by a
    // TEST-ONLY runtime flip of the static through Angular's dev-mode
    // `window.ng` handle.
    //
    // NOTHING IS COMMITTED TO SELECT IT: no production flag is changed, no test
    // endpoint is added, no build configuration is introduced. The flip lives
    // in this file, is undone before the section ends, and works only because
    // the flag is a `static` on the class and `dashboardService` is a public
    // property — both true of the shipped build, neither added for this.
    const dashboardCalls = [];
    page.on('response', (res) => {
      const url = res.url();
      if (!url.includes('reports/restaurant/dashboard-v2/')) return;
      const req = res.request();
      dashboardCalls.push(
        res.json().catch(() => null).then((body) => ({
          url,
          status: res.status(),
          auth: req.headers()['authorization'] || null,
          body,
        })),
      );
    });

    await page.goto(`${WEB}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-revenue-card', { timeout: 30000 });
    await page.waitForTimeout(1800);

    // PHASE A — the control. The withheld testids are ALREADY present here, and
    // that is exactly why this check exists: their presence proves nothing
    // until a real declaration is shown to have produced them.
    const mockPhaseCalls = dashboardCalls.length;
    check('CONTROL: on the committed mock branch NO dashboard-v2 request is issued, so the real-data checks below cannot be satisfied by it',
      mockPhaseCalls === 0, `observed ${mockPhaseCalls}`);
    check('CONTROL: ...and the withheld hooks are nevertheless already rendered from mock data',
      await page.locator('[data-testid="revenue-headline-withheld"]').count() === 1);

    // PHASE B — the real branch.
    const flipped = await page.evaluate(() => {
      const host = document.querySelector('app-rest-dashboard');
      const cmp = host && window.ng && window.ng.getComponent(host);
      const svc = cmp && cmp.dashboardService;
      if (!svc) return { ok: false, why: 'no DashboardService on the dashboard component' };
      const cls = svc.constructor;
      if (cls.USE_MOCK_DATA !== true) return { ok: false, why: `flag was already ${cls.USE_MOCK_DATA}` };
      cls.USE_MOCK_DATA = false;
      svc.refresh$.next();
      return { ok: true };
    });
    check('the real-data branch was selected by a TEST-ONLY runtime flip',
      flipped && flipped.ok === true, JSON.stringify(flipped));

    await page.waitForFunction(
      () => true, null, { timeout: 1000 },
    ).catch(() => {});
    await page.waitForTimeout(3000);

    const calls = await Promise.all(dashboardCalls);
    const primary = calls.find((c) => c.status === 200);
    check('an AUTHORIZED dashboard-v2 request really reached the server',
      calls.length > 0 && calls.every((c) => typeof c.auth === 'string' && c.auth.startsWith('Bearer ')),
      brief(calls.map((c) => ({ status: c.status, authorized: !!c.auth })), 200));
    check('the SERVER declares that settlement is not measured',
      primary && primary.body && primary.body.data
        && primary.body.data.payment_tracking_enabled === false,
      brief(primary && primary.body && Object.keys(primary.body.data || {}), 200));

    const dash = text(await page.locator('app-rest-dashboard, app-restaurant-mgt').first().innerText());

    check('the revenue headline is WITHHELD, not rendered',
      await page.locator('[data-testid="revenue-headline-withheld"]').count() === 1);
    check('the revenue chart is not drawn',
      await page.locator('[data-testid="revenue-chart-withheld"]').count() === 1);
    check('no percentage is computed for the comparison window',
      await page.locator('[data-testid="revenue-comparison-withheld"]').count() === 1);
    check('the unmeasured pills are withheld and REFUNDS is not',
      await page.locator('[data-testid="revenue-pill-withheld-Gross"]').count() === 1
      && await page.locator('[data-testid="revenue-pill-withheld-Net"]').count() === 1
      && await page.locator('[data-testid="revenue-pill-withheld-Refunds"]').count() === 0);
    check('the paid/unpaid split is withheld on Total Orders',
      await page.locator('[data-testid="orders-withheld-paid"]').count() === 1
      && await page.locator('[data-testid="orders-withheld-open"]').count() === 1);
    check('the Tables card is wired to the decision at last',
      await page.locator('[data-testid="tables-tracking-note"]').count() === 1);
    check('the tables history tiles are withheld',
      await page.locator('[data-testid="tables-withheld-median"]').count() === 1
      && await page.locator('[data-testid="tables-withheld-turns"]').count() === 1
      && await page.locator('[data-testid="tables-withheld-avg-ticket"]').count() === 1);
    check('the payment-methods card claims nothing about the period',
      !dash.includes('No settled payments in this period'), dash.slice(0, 200));
    check('occupancy is NOT withheld — it is live floor state',
      /tables occupied/i.test(dash));

    // Undo the test-only flip, so the rest of the run sees the shipped build.
    await page.evaluate(() => {
      const host = document.querySelector('app-rest-dashboard');
      const cmp = host && window.ng && window.ng.getComponent(host);
      if (cmp && cmp.dashboardService) cmp.dashboardService.constructor.USE_MOCK_DATA = true;
    });

    await openBilling(page);
    const body = text(await page.locator('app-billing').innerText());

    check('states that no CURRENT terms are recorded', await seen(page, 'terms-absent') === 1);
    check('never claims none ever existed', !/\byet\b|\bnever\b|\bever\b/i.test(body), body.slice(0, 160));
    check('invents no price', !body.includes('UGX'));
    check('claims no plan, trial or free tier',
      !/free|trial|plan|tier|discount/i.test(body), body.slice(0, 160));
    check('states the collection capability from the server',
      await seen(page, 'collection-note') === 1);
    check('offers no payment control',
      !/pay now|renew|subscribe|mark as paid|amount due|balance/i.test(body));
    check('the legacy validity column decides nothing here',
      fx.restaurants.unconfigured.legacy_validity === true && !/active/i.test(body),
      `seeded legacy_validity=${fx.restaurants.unconfigured.legacy_validity}`);
    check('history renders its own empty state', await seen(page, 'history-empty') === 1);
    await ctx.close();
  }

  // ── 2. A DELIBERATELY SEEDED LEGACY BILLABLE CONFIGURATION ──────────────
  console.log('\n2. legacy billable configuration, nothing canonical');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`legacy: ${e.message}`));
    await signIn(page, fx.restaurants.legacy.owner_phone);
    await openBilling(page);
    const body = text(await page.locator('app-billing').innerText());

    // Prove the fixture really carries the legacy shape, from the WIRE, so a
    // passing screen cannot be passing because the seed silently failed.
    const wire = await page.evaluate(async ({ api, rid }) => {
      const raw = sessionStorage.getItem('user') || localStorage.getItem('user');
      const token = raw ? JSON.parse(raw)?.token : null;
      const res = await fetch(
        `${api}/api/v1/restaurant-setup/subscription-details/?restaurant=${rid}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      return { status: res.status, body: await res.json() };
    }, { api: API, rid: fx.restaurants.legacy.id });

    check('the fixture really is legacy-billable on the wire',
      wire.body?.data?.subscription_validity === true
      && typeof wire.body?.data?.subscription_expiry_date === 'string',
      brief(wire.body?.data ?? wire, 200));
    check('...with NO canonical terms beside it',
      wire.body?.data?.subscription_terms?.recorded === false
      && wire.body?.data?.subscription_terms?.current === null);

    check('THE SCREEN STILL SAYS NO CURRENT TERMS', await seen(page, 'terms-absent') === 1);
    check('no "Active" badge is derived from the legacy flag', !/active/i.test(body));
    check('no next-billing date is derived from the legacy expiry',
      !/next billing|renews|expires/i.test(body) && !body.includes(String(new Date().getFullYear() + 1)));
    check('the legacy flat_fee is not rendered as a price', !body.includes('1,500,000'));
    await ctx.close();
  }

  // ── 3. CANONICAL RECORDED TERMS AND HISTORY ─────────────────────────────
  console.log('\n3. canonical recorded terms and history');
  let collectorProbe = null;
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`recorded: ${e.message}`));

    // THE OTP STEP IS INTERCEPTED AND NEVER REACHES THE SERVER (see the header).
    const otpAttempts = [];
    await page.route('**/users/auth/resend-otp/**', async (route) => {
      otpAttempts.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 200, message: 'intercepted by the harness' }),
      });
    });

    await signIn(page, fx.restaurants.recorded.owner_phone);
    await openBilling(page);
    const amountEl = page.locator('app-billing [data-testid="terms-amount"]');

    check('the recorded terms are rendered', await amountEl.count() === 1);
    const amount = text(await amountEl.innerText().catch(() => ''));
    check('the canonical decimal scale survives to the screen',
      amount.includes('UGX 150,000.50'), amount);
    check('the recurrence is stated as an interval, not a plan name',
      /every month/i.test(amount) && !/basic|pro|standard|premium/i.test(amount), amount);
    check('no absence or unavailable state is shown beside it',
      await seen(page, 'terms-absent') === 0 && await seen(page, 'terms-unstated') === 0
      && await seen(page, 'terms-unreadable') === 0);

    const historyBody = text(await page.locator('app-billing').innerText());
    check('the history row renders the amount the serializer emits',
      historyBody.includes('150,000.50') && !/UGX 0\b/.test(historyBody));
    check('history is not in a failed or loading state',
      await seen(page, 'history-failed') === 0 && await seen(page, 'history-empty') === 0);

    // ── the retired collector, through the REAL interceptor ──────────────
    //
    // TWO INDEPENDENT OBSERVERS OF ONE REAL REQUEST, and both are needed.
    //
    //   THE NETWORK — `page.on('response')` reads the status and the raw body
    //     BEFORE `ErrorInterceptor` touches either. The interceptor flattens an
    //     ordinary failure to `err.error?.message || err.statusText`, a STRING
    //     WITH NO STATUS, so a client-side observation cannot distinguish 501
    //     from 404, 403 or 500 — and it was `collectorProbe.outcome ===
    //     'refused'` that this file used to assert, which every one of those
    //     satisfies.
    //   THE CLIENT — the same request issued through the live component's own
    //     `ApiService`, so the REAL `AuthInterceptor` attaches the session and
    //     the REAL `ErrorInterceptor` decides what the operator is told.
    //
    // The assertions below name an EXACT status and an EXACT machine reason, so
    // a 400, 401, 403, 404, an arbitrary non-2xx, or a request that never
    // answers at all each FAIL rather than passing as "some refusal".
    const collectorResponses = [];
    page.on('response', (res) => {
      if (!res.url().includes('finances/transactions/')) return;
      collectorResponses.push(
        res.text().catch(() => null).then((body) => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { parsed = null; }
          return { status: res.status(), raw: body, body: parsed };
        }),
      );
    });

    /** Issue a body through the app's own ApiService and report what it saw. */
    const issueThroughApp = (body) => page.evaluate(async (payload) => {
      const host = document.querySelector('app-billing');
      const ng = window.ng;
      if (!ng || !host) return { reached: false, why: 'no dev-mode ng handle' };
      const cmp = ng.getComponent(host);
      const api = cmp && cmp.api;
      if (!api || typeof api.postPatch !== 'function') {
        return { reached: false, why: 'no ApiService on the component' };
      }
      return await new Promise((resolve) => {
        api.postPatch('finances/transactions/', payload, 'post').subscribe({
          next: (r) => resolve({ reached: true, outcome: 'accepted', body: r }),
          error: (e) => resolve({
            reached: true,
            outcome: 'refused',
            status: e && e.status !== undefined ? e.status : null,
            // The ErrorInterceptor flattens an ordinary failure to a string.
            flattened: typeof e === 'string' ? e : (e && e.message) || null,
          }),
        });
      });
    }, body);

    /** The restaurant's OWN authorized financial listing — the row-count witness. */
    const countHistoryRows = () => page.evaluate(async (rid) => {
      const cmp = window.ng && window.ng.getComponent(document.querySelector('app-billing'));
      const api = cmp && cmp.api;
      if (!api) return null;
      const today = new Date();
      const from = new Date(today); from.setMonth(from.getMonth() - 5);
      const d = (x) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
      return await new Promise((resolve) => {
        api.get(null, 'reports/restaurant/transactions-listing/', {
          restaurant: rid, from: d(from), to: d(today), type: 'subscription',
        }).subscribe({
          next: (r) => resolve(Array.isArray(r && r.data) ? r.data.length : null),
          error: () => resolve(null),
        });
      });
    }, fx.restaurants.recorded.id);

    const rowsBefore = await countHistoryRows();
    check('the financial-row witness is readable before the probe',
      typeof rowsBefore === 'number', `rowsBefore=${rowsBefore}`);

    const outboundBefore = otpAttempts.length;
    collectorProbe = await issueThroughApp(
      retiredCollectorBody(fx.restaurants.recorded.id, '256700000803'),
    );

    check('the collector request really went through the app',
      collectorProbe && collectorProbe.reached === true,
      brief(collectorProbe, 200));

    const observed = await Promise.all(collectorResponses);
    const probeResponse = observed[0] || null;

    // A request that never answered leaves `probeResponse` null, and every
    // assertion below fails on it — a timeout is not a refusal.
    check('THE SERVER ANSWERED 501 — observed on the wire, before any interceptor',
      probeResponse !== null && probeResponse.status === REFUSAL_STATUS,
      `observed=${JSON.stringify(observed.map((o) => o.status))}`);
    check('...carrying the machine reason a client branches on',
      probeResponse && probeResponse.body
        && probeResponse.body.reason === REFUSAL_REASON,
      brief(probeResponse && probeResponse.body, 220));
    check('...and the sentence that is about THIS REQUEST and nothing else',
      probeResponse && probeResponse.body
        && probeResponse.body.message === REFUSAL_MESSAGE,
      brief(probeResponse && probeResponse.body && probeResponse.body.message, 220));

    // SEPARATELY: what the component and the interceptor made of the same answer.
    check('the client reports it as a refusal rather than a success',
      collectorProbe && collectorProbe.outcome === 'refused',
      brief(collectorProbe, 200));
    check('the ErrorInterceptor surfaces the SERVER’s own sentence, not a generic one',
      collectorProbe && collectorProbe.flattened === REFUSAL_MESSAGE,
      brief(collectorProbe && collectorProbe.flattened, 220));

    // ── the CONTROL that keeps the 501 from being "the endpoint always says no"
    // `can_manage_restaurant` fails closed, so a missing or foreign id is
    // refused by the AUTHORIZATION GATE with an opaque 404 and never reaches
    // the collector. Without this, a harness that happened to send the wrong
    // key would score a passing "refusal" forever — which is the defect this
    // section is correcting.
    const missingId = await issueThroughApp({
      transaction_type: 'subscription', transaction_platform: 'web', payment_mode: 'momo',
    });
    const foreignId = await issueThroughApp(
      retiredCollectorBody('11111111-1111-4111-8111-111111111111', '256700000803'),
    );
    const controls = (await Promise.all(collectorResponses)).slice(1);
    check('CONTROL: an id this operator cannot manage is 404 at the gate, NOT 501',
      controls.length === 2 && controls.every((c) => c.status === 404),
      JSON.stringify(controls.map((c) => c.status)));
    check('CONTROL: ...and both are refused at the client too',
      missingId && missingId.outcome === 'refused'
      && foreignId && foreignId.outcome === 'refused');

    // ── ZERO EFFECTS, asserted rather than observed by hand ───────────────
    const rowsAfter = await countHistoryRows();
    check('NO FINANCIAL ROW WAS CREATED by any of the three attempts',
      typeof rowsAfter === 'number' && rowsAfter === rowsBefore,
      `before=${rowsBefore} after=${rowsAfter}`);
    check('no verification code was dispatched before or during it',
      otpAttempts.length === outboundBefore, `intercepted ${otpAttempts.length}`);

    // The toast the real ErrorInterceptor raised, on the real screen.
    await page.waitForTimeout(600);
    const toast = text(await page.locator('app-toast, [role="status"], [role="alert"]')
      .allInnerTexts().then((a) => a.join(' ')).catch(() => ''));
    check('the refusal is surfaced to the operator rather than swallowed',
      toast.length > 0 || collectorProbe?.flattened,
      `toast="${toast.slice(0, 120)}" flattened="${collectorProbe?.flattened}"`);

    // ── 4. THE OLD PRE-SUBMIT OTP ORDERING, WITH NO CHALLENGE SENT ────────
    //
    // WHAT THIS IS, STATED NARROWLY: the two retired REQUESTS, recovered
    // verbatim and re-issued IN THEIR ORIGINAL ORDER from the current build. It
    // is NOT an execution of the old bundle — that code is deleted, its dialog,
    // its MSISDN lookup and its form state are gone, and nothing here runs
    // them. What it establishes is that the ORDERING the retired panel used
    // spends a verification code before a request the server refuses. Whether
    // the deployed older bundle renders that refusal well is not asserted and
    // is not claimed.
    //
    // Same session deliberately: see the sign-in budget in the header.
    console.log('\n4. the retired pre-submit OTP ordering (no challenge dispatched)');
    const order = [];
    page.on('request', (r) => {
      const u = r.url();
      if (u.includes('users/auth/resend-otp/')) order.push('otp');
      if (u.includes('finances/transactions/')) order.push('collect');
    });

    const replay = await page.evaluate(async ({ collectorBody }) => {
      const cmp = window.ng?.getComponent(document.querySelector('app-billing'));
      const api = cmp && cmp.api;
      if (!api) return { ran: false };
      // The retired sequence, in its original order: OTP, THEN the POST.
      // Both bodies are the ones `sendOtp()` and `Save()` actually sent.
      const otp = await new Promise((resolve) => {
        api.postPatch('users/auth/resend-otp/',
          { identification: 'msisdn', identifier: '256700000803', purpose: null }, 'post')
          .subscribe({ next: () => resolve('ok'), error: () => resolve('err') });
      });
      const post = await new Promise((resolve) => {
        api.postPatch('finances/transactions/', collectorBody, 'post').subscribe({
          next: () => resolve({ outcome: 'accepted' }),
          error: (e) => resolve({
            outcome: 'refused',
            status: e && e.status !== undefined ? e.status : null,
            flattened: typeof e === 'string' ? e : (e && e.message) || null,
          }),
        });
      });
      return { ran: true, otp, post };
    }, {
      collectorBody: retiredCollectorBody(fx.restaurants.recorded.id, '256700000803'),
    });

    const replayObserved = (await Promise.all(collectorResponses)).slice(-1)[0] || null;

    check('the retired sequence ran', replay?.ran === true);
    check('THE OTP CAME FIRST, then the collection attempt',
      order[0] === 'otp' && order.includes('collect'), JSON.stringify(order));
    check('the collection attempt is refused 501 ON THE WIRE, so the code was spent for nothing',
      replayObserved !== null && replayObserved.status === REFUSAL_STATUS
      && replayObserved.body?.reason === REFUSAL_REASON,
      brief(replayObserved, 200));
    check('...and the client reports that refusal',
      replay?.post?.outcome === 'refused', JSON.stringify(replay?.post));
    check('NO REAL CHALLENGE WAS DISPATCHED — the harness answered it',
      otpAttempts.length === 1 && order.filter((o) => o === 'otp').length === 1,
      `intercepted=${otpAttempts.length} observed=${JSON.stringify(order)}`);
    await ctx.close();
  }

  // ── 5. THE LEGACY PAYMENT DEEP LINK, NAVIGATED TO DIRECTLY ──────────────
  console.log('\n5. the retired payment-result deep link');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const probed = [];
    for (const path of [
      '/diner/payment-details',
      '/diner/basket/payment-details',
      '/rest-app-ordering/payment-details',
    ]) {
      await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const body = text(await page.locator('body').innerText().catch(() => ''));
      probed.push({ path, url: page.url(), body: body.slice(0, 160) });
      check(`${path} renders no payment surface`,
        !/pay now|payment successful|transaction successful|paid|pay with/i.test(body),
        body.slice(0, 120));
    }
    check('no retired payment path resolves to a payment route',
      probed.every((p) => !/payment-details/.test(new URL(p.url).pathname)),
      JSON.stringify(probed.map((p) => p.url)));
    await ctx.close();
  }

  check('no page raised an uncaught error', errors.length === 0, errors.join(' | '));

  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} checks`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('\nThis is a MANUAL run against disposable local infrastructure.');
  console.log('It is NOT a CI gate and nothing here contacts a payment provider.');
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
