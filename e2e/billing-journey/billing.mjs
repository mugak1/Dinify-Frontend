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
 *  3. THE OTP STEP IS INTERCEPTED, NEVER SENT. The old panel dispatched a real
 *     verification code BEFORE the POST that could not succeed. The ordering
 *     is what matters, so `users/auth/resend-otp/` is fulfilled by the harness
 *     and never reaches the server: the limitation is demonstrated with no
 *     challenge issued and no delivery attempted.
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

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const text = (s) => (s || '').replace(/\s+/g, ' ').trim();

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
    // The measurement decision is a property of the RESPONSE, not of the
    // restaurant, so it is the same on every one of the three; it is checked
    // here to spend one sign-in rather than four.
    await page.goto(`${WEB}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-revenue-card', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const dash = text(await page.locator('app-dashboard, app-restaurant-mgt').first().innerText());

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
      JSON.stringify(wire.body?.data ?? wire).slice(0, 200));
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

    // ── the old client's collector, through the REAL interceptor ──────────
    collectorProbe = await page.evaluate(async (rid) => {
      const host = document.querySelector('app-billing');
      const ng = window.ng;
      if (!ng || !host) return { reached: false, why: 'no dev-mode ng handle' };
      const cmp = ng.getComponent(host);
      const api = cmp && cmp.api;
      if (!api || typeof api.postPatch !== 'function') return { reached: false, why: 'no ApiService on the component' };
      // The body the RETIRED billing dialog sent, verbatim.
      const payload = {
        restaurant: rid,
        transaction_type: 'subscription',
        payment_mode: 'momo',
        msisdn: '256700000803',
      };
      return await new Promise((resolve) => {
        api.postPatch('finances/transactions/', payload, 'post').subscribe({
          next: (r) => resolve({ reached: true, outcome: 'accepted', body: r }),
          error: (e) => resolve({
            reached: true,
            outcome: 'refused',
            status: e?.status ?? null,
            // The ErrorInterceptor flattens an ordinary failure to a string.
            flattened: typeof e === 'string' ? e : (e?.message ?? null),
          }),
        });
      });
    }, fx.restaurants.recorded.id);

    check('the collector request really went through the app',
      collectorProbe?.reached === true, JSON.stringify(collectorProbe).slice(0, 200));
    check('the live server REFUSES it', collectorProbe?.outcome === 'refused',
      JSON.stringify(collectorProbe).slice(0, 200));
    check('no verification code was dispatched before it',
      otpAttempts.length === 0, `intercepted ${otpAttempts.length}`);

    // The toast the real ErrorInterceptor raised, on the real screen.
    await page.waitForTimeout(600);
    const toast = text(await page.locator('app-toast, [role="status"], [role="alert"]')
      .allInnerTexts().then((a) => a.join(' ')).catch(() => ''));
    check('the refusal is surfaced to the operator rather than swallowed',
      toast.length > 0 || collectorProbe?.flattened,
      `toast="${toast.slice(0, 120)}" flattened="${collectorProbe?.flattened}"`);

    // ── 4. THE OLD PRE-SUBMIT OTP ORDERING, WITH NO CHALLENGE SENT ────────
    // Same session deliberately: see the sign-in budget in the header.
    console.log('\n4. the retired pre-submit OTP ordering (no challenge dispatched)');
    const order = [];
    page.on('request', (r) => {
      const u = r.url();
      if (u.includes('users/auth/resend-otp/')) order.push('otp');
      if (u.includes('finances/transactions/')) order.push('collect');
    });

    const replay = await page.evaluate(async (rid) => {
      const cmp = window.ng?.getComponent(document.querySelector('app-billing'));
      const api = cmp && cmp.api;
      if (!api) return { ran: false };
      // The retired sequence, in its original order: OTP, THEN the POST.
      const otp = await new Promise((resolve) => {
        api.postPatch('users/auth/resend-otp/', { username: '256700000803' }, 'post')
          .subscribe({ next: () => resolve('ok'), error: () => resolve('err') });
      });
      const post = await new Promise((resolve) => {
        api.postPatch('finances/transactions/', {
          restaurant: rid, transaction_type: 'subscription', payment_mode: 'momo',
        }, 'post').subscribe({
          next: () => resolve({ outcome: 'accepted' }),
          error: (e) => resolve({ outcome: 'refused', status: e?.status ?? null }),
        });
      });
      return { ran: true, otp, post };
    }, fx.restaurants.recorded.id);

    check('the retired sequence ran', replay?.ran === true);
    check('THE OTP CAME FIRST, then the collection attempt',
      order[0] === 'otp' && order.includes('collect'), JSON.stringify(order));
    check('the collection attempt is refused, so the code was spent for nothing',
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
