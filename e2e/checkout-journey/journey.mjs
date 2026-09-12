/**
 * D02/D03 — the repeatable real-browser journey.
 *
 * A real Chromium against a real Angular build talking to a real Django +
 * PostgreSQL. It asserts what no unit suite can observe: that the diner SEES the
 * server's amount before agreeing to it, that agreeing is something they DO —
 * through the application's own Place order button — that the amount they agreed
 * to is the one saved and sent to the kitchen, and that a quote the server does
 * not recognise is refused rather than quietly accepted.
 *
 * IT IS A MANUAL, REPEATABLE RUN — NOT A CI GATE, and it says so at the end of
 * every run. It needs a disposable PostgreSQL, a running Django and a running
 * dev server, none of which CI has. Treat it as a pre-merge gate for changes to
 * the checkout pricing or confirmation path.
 *
 * FOUR THINGS ABOUT ITS SHAPE ARE DELIBERATE.
 *
 *  1. THE POSITIVE PATH GOES THROUGH THE REAL BUTTON. Submitting by fetch would
 *     prove the SERVER accepts a quote and nothing whatever about the screen the
 *     diner uses: the click is what exercises `confirmQuote`, the payload it
 *     builds, the navigation, and the basket clearing that must follow only a
 *     definitive success.
 *  2. RAW FETCH IS KEPT FOR THE NEGATIVE REFERENCE CASES. A stale and an absent
 *     `quote_ref` cannot be produced through the UI — the app always sends the
 *     one it rendered — so they are issued through the same diner capability
 *     channel the app uses, from inside the page. They are refusals, so they
 *     mutate nothing and the real click still has a live draft to accept.
 *  3. ASSERTIONS ABOUT THE REVIEW ARE SCOPED TO THE REVIEW. Matching the whole
 *     document would let the basket behind the sheet satisfy an assertion about
 *     what the diner is being asked to confirm — which is the one thing this
 *     journey exists to tell apart.
 *  4. THE PRICE CHANGES MID-RUN, through the operator's real API, after the
 *     basket is built and before the review is requested. The review must show
 *     the CURRENT server price; the basket's own figure is the browser's and is
 *     allowed to differ. That is the whole claim of the confirmation screen, and
 *     it cannot be made by seeding a price and reading it back.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const F = JSON.parse(readFileSync(process.env.JOURNEY_FIXTURE || '/tmp/journey-fixture.json', 'utf8'));
const WEB = process.env.JOURNEY_WEB || 'http://127.0.0.1:4299';
const API = process.env.JOURNEY_API || 'http://127.0.0.1:8099';

// ── the fixture's arithmetic, stated once ───────────────────────────────────
// Burger 10 000 + Large 3 500 + Extra Cheese 2 000, at quantity 2 = 31 000.
const ADD_BUTTON_TOTAL = 31000;
// The operator raises the burger to 12 000 AFTER the basket is built, so the
// server prices 2 × (12 000 + 3 500 + 2 000) = 35 000.
const REPRICED_BURGER = '12000.00';
const REVIEW_BURGER_LINE = 35000;
// THE SUB-CENT GOLDEN. `additionalCost` is '1.005' in an unvalidated JSON blob.
// Each unit component is quantized ONCE at 2dp with ROUND_HALF_EVEN, and 1.005
// ties to EVEN — so the adjustment is 1.00 and the line is 10.00 + 1.00 = 11.00.
// Round-half-up anywhere in the chain gives 1.01 and 11.01, and this run fails
// by exactly one cent rather than passing with a plausible number.
const ROUNDING_LINE = 11.0;
const ORDER_TOTAL = REVIEW_BURGER_LINE + ROUNDING_LINE;   // 35 011.00

const results = [];
const pageErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const money = (s) => Number(String(s).replace(/[^0-9.]/g, ''));

// ── operator-side helpers ───────────────────────────────────────────────────
//
// The journey needs two things only an authenticated operator can do: change a
// dish price mid-run, and read the accepted order back off the kitchen board.
// Both go through the REAL APIs as the REAL fixture owner, so a break in either
// contract shows up here rather than being simulated away.
const api = async (path, init = {}) => {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
};

const signInAsOperator = async () => {
  const { username, password } = F.operator;
  const login = await api('/api/v1/users/auth/login/', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  // An OWNER membership sets `require_otp`, so login deliberately hands out no
  // token. ENV=dev fixes the code at 1234 — which is why this is a disposable
  // local database and never anything else.
  if (login.body?.data?.require_otp) {
    const verified = await api('/api/v1/users/auth/verify-otp/', {
      method: 'POST',
      body: JSON.stringify({ user: login.body.data.user_id, otp: '1234' }),
    });
    return verified.body?.data?.token ?? null;
  }
  return login.body?.data?.token ?? null;
};

const asOperator = (token) => (path, init = {}) => api(path, {
  ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
});

// Issue a request from INSIDE the page, carrying the real diner session the app
// minted — so the negative cases exercise the same capability channel the UI
// uses, not a hand-made one.
const asDiner = (page, path, init) => page.evaluate(
  async ([api, path, init]) => {
    const raw = sessionStorage.getItem('[dinify]diner.session');
    const token = raw ? JSON.parse(raw).value : null;
    const res = await fetch(api + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Diner-Session': token, ...(init.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body };
  },
  [API, path, init],
);

// The basket lives in sessionStorage under the app's prefixed key as
// `{"value": {items, totalAmount}}`. The success handler wipes sessionStorage
// wholesale, so an ABSENT key is the CLEARED state and reads as zero — while a
// key holding something unreadable reads as -1, which is a failure rather than a
// quiet pass.
const readBasketCount = (page) => page.evaluate(() => {
  try {
    const raw = sessionStorage.getItem('[dinify]diner.basket');
    if (raw === null) return 0;
    const items = JSON.parse(raw)?.value?.items;
    return Array.isArray(items) ? items.length : -1;
  } catch { return -2; }
});

const main = async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  // AN UNCAUGHT PAGE ERROR FAILS THE RUN. Logging it and carrying on meant a
  // screen could throw on every render while every check below still passed.
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror]', e.message); });

  // Capture what the app ACTUALLY received and sent, rather than asking a second
  // endpoint what it thinks happened.
  let initiateBody = null;
  const submitRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('orders/submit')) {
      submitRequests.push({ method: req.method(), body: req.postData() });
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('orders/initiate') && res.status() === 200) {
      try { initiateBody = await res.json(); } catch { /* ignore */ }
    }
  });

  const operatorToken = await signInAsOperator();
  const operator = asOperator(operatorToken);
  check('the fixture operator can sign in', typeof operatorToken === 'string' && operatorToken.length > 0);

  // ── 1. QR scan → menu ────────────────────────────────────────────────────
  await page.goto(`${WEB}/diner/h/${F.table}?c=${encodeURIComponent(F.credential)}`,
                  { waitUntil: 'domcontentloaded' });
  // A LOCATOR CONDITION, not a sleep: the assertion and the wait are the same
  // statement, so a slow menu makes the run slower rather than red.
  const menuDish = page.getByText('Signature Burger').first();
  await menuDish.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  check('menu renders after a QR scan', await menuDish.isVisible().catch(() => false));

  // ── 2. Configure a variant with a paid modifier and an extra ─────────────
  const addBurger = async () => {
    await page.goto(`${WEB}/diner/h/${F.table}/item/${F.burger}`, { waitUntil: 'domcontentloaded' });
    const large = page.locator('label:has-text("Large")').first();
    await large.waitFor({ state: 'visible', timeout: 20000 });
    check('item detail offers the modifier group and the extra',
          await large.isVisible()
          && await page.locator('label:has-text("Extra Cheese")').first().isVisible());

    // A single-select group renders radios and the extras render checkboxes, so
    // pick by LABEL rather than by control type — the journey should not depend
    // on how the control happens to be drawn.
    const pick = async (label) => {
      const input = page.locator(`label:has-text("${label}")`).first().locator('input').first();
      await input.check({ force: true });
    };
    await pick('Large');          // +3 500
    await pick('Extra Cheese');   // +2 000
    await page.getByLabel('Increase quantity').first().click();   // qty 2

    const addBtn = page.getByRole('button', { name: /Add —/ }).first();
    // Poll the LABEL rather than sleeping: it re-renders as the selection lands.
    await page.waitForFunction(
      (expected) => {
        const b = [...document.querySelectorAll('button')]
          .find((el) => /Add —/.test(el.textContent || ''));
        return !!b && Number((b.textContent || '').replace(/[^0-9.]/g, '')) === expected;
      },
      ADD_BUTTON_TOTAL, { timeout: 15000 },
    ).catch(() => {});
    const addLabel = (await addBtn.textContent()) || '';
    // 2 × (10 000 base + 3 500 Large + 2 000 Cheese) = 31 000 — the extra scales
    // with the parent, which is the D02 defect this line would have shown.
    check('the add button shows the configured line total',
          money(addLabel) === ADD_BUTTON_TOTAL, addLabel.trim());
    await addBtn.click();
  };

  const addRoundingDish = async () => {
    await page.goto(`${WEB}/diner/h/${F.table}/item/${F.rounding}`, { waitUntil: 'domcontentloaded' });
    const choice = page.locator('label:has-text("Half Even Down")').first();
    await choice.waitFor({ state: 'visible', timeout: 20000 });
    await choice.locator('input').first().check({ force: true });
    const addBtn = page.getByRole('button', { name: /Add —/ }).first();
    await addBtn.waitFor({ state: 'visible' });
    await addBtn.click();
  };

  await addBurger();
  await addRoundingDish();

  // ── 3. Basket ────────────────────────────────────────────────────────────
  await page.goto(`${WEB}/diner/basket`, { waitUntil: 'domcontentloaded' });
  const basket = page.locator('app-basket-body').first();
  await basket.getByText('Signature Burger').first()
    .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  // ONE line, not two: the modifier + extra selection is one configuration.
  const basketLines = await basket.getByText('Signature Burger').count().catch(() => -1);
  check('basket holds ONE line for the configured dish', basketLines === 1,
        `lines=${basketLines}`);

  // ── 4. THE PRICE MOVES, after the basket and before the review ───────────
  const repriced = await operator('/api/v1/restaurant-setup/menuitems/', {
    method: 'PUT',
    body: JSON.stringify({ id: F.burger, primary_price: REPRICED_BURGER }),
  });
  check('the operator raises the dish price mid-journey',
        repriced.status === 200, `${repriced.status}`);

  // ── 5. Checkout → THE AUTHORITATIVE REVIEW ───────────────────────────────
  const initiated = page.waitForResponse(
    (r) => r.url().includes('orders/initiate') && r.status() === 200,
    { timeout: 30000 },
  ).catch(() => null);
  await page.getByRole('button', { name: /Checkout/i }).first().click();
  await initiated;

  // SCOPED TO THE REVIEW. The panel is the heading's parent, so every assertion
  // below is about what the diner is being asked to confirm — never about the
  // basket still rendered behind it.
  const reviewHeading = page.getByRole('heading', { name: 'Review your order' });
  await reviewHeading.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  check('the review sheet appears BEFORE anything is submitted',
        await reviewHeading.isVisible().catch(() => false));
  const panel = reviewHeading.locator('xpath=..');
  const reviewText = await panel.textContent().catch(() => '');

  // NOTHING HAS BEEN ACCEPTED YET, asserted two independent ways: the app has
  // issued no submit at all, and the saved order is still a draft.
  check('no submission has been issued at review time',
        submitRequests.length === 0, `submits=${submitRequests.length}`);
  const od = initiateBody?.data?.order_details;
  const orderId = od?.id;
  const draft = await asDiner(page, `/api/v1/orders/journey/order-details/?order=${orderId}`, {});
  check('the saved order is still an unaccepted draft',
        draft.body?.data?.order_status === 'initiated',
        `order_status=${draft.body?.data?.order_status}`);

  check('the review prices the extra as its own row', /Extra Cheese/.test(reviewText));

  // The reviewed amount is the SERVER's — taken from the very response the app
  // rendered, so the two cannot be different numbers that merely agree.
  const serverTotal = Number(od?.quote_total ?? od?.actual_cost);
  check('the reviewed amount is the server amount, shown in the review',
        Number.isFinite(serverTotal) && new RegExp(
          serverTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        ).test(reviewText),
        `server=${serverTotal}`);
  check('the review shows the CURRENT server price, not the browser\'s',
        serverTotal === ORDER_TOTAL, `server=${serverTotal} browser-basket=${ADD_BUTTON_TOTAL + ROUNDING_LINE}`);

  const burgerLine = (initiateBody?.data?.quote || []).find((l) => l.item === F.burger);
  check('the server quote carries the extra as a child of its parent line',
        (burgerLine?.extras || []).length === 1
        && Number(burgerLine?.line_total_with_extras) === REVIEW_BURGER_LINE,
        `line_total_with_extras=${burgerLine?.line_total_with_extras}`);

  // THE SUB-CENT GOLDEN, asserted on the canonical decimal STRING rather than a
  // number: '11.00' and 11 are the same value and only one of them is the wire
  // contract the review is rendered from.
  const roundingLine = (initiateBody?.data?.quote || []).find((l) => l.item === F.rounding);
  check('a sub-cent adjustment is quantized ROUND_HALF_EVEN, once, per unit',
        roundingLine?.line_total_with_extras === '11.00'
        && roundingLine?.unit_cost_of_options === '1.00',
        `line=${roundingLine?.line_total_with_extras} modifier=${roundingLine?.unit_cost_of_options}`);

  const quoteRef = od?.quote_ref;
  const version = od?.pricing_version;
  check('the saved draft is CORRECTED-priced and carries an acknowledgement',
        version === 1 && typeof quoteRef === 'string' && quoteRef.length > 0,
        `pricing_version=${version}`);

  // ── 6. Negative reference cases, via the same capability channel ─────────
  //
  // Neither is producible through the UI — the app always sends the quote it
  // rendered — and both are REFUSALS, so they mutate nothing and the real click
  // below still has a live draft to accept.
  const bogus = await asDiner(page, '/api/v1/orders/submit/', {
    method: 'PUT', body: JSON.stringify({ order: orderId, quote_ref: 'not-the-quote' }),
  });
  check('a quote reference the server does not recognise is refused',
        bogus.status === 400 && bogus.body?.reason === 'quote_ref_stale',
        `${bogus.status} ${bogus.body?.reason}`);

  const missing = await asDiner(page, '/api/v1/orders/submit/', {
    method: 'PUT', body: JSON.stringify({ order: orderId }),
  });
  check('an ABSENT quote reference is refused, never treated as agreement',
        missing.status === 400 && missing.body?.reason === 'quote_ref_required',
        `${missing.status} ${missing.body?.reason}`);

  // READ FROM STORAGE, not from the screen. "The sheet is still up" would be a
  // vacuous assertion — nothing was going to navigate — whereas the basket's
  // CONTENTS are the thing that must survive everything short of acceptance,
  // and this is the before half of the pair the post-success check completes.
  const basketDuringReview = await readBasketCount(page);
  check('a refused submission leaves the basket intact',
        basketDuringReview === 2, `lines=${basketDuringReview}`);

  // ── 7. THE DINER PLACES THE ORDER, through the real button ───────────────
  const placeBtn = panel.getByRole('button', { name: /^Place order/ });
  const placeLabel = (await placeBtn.textContent().catch(() => '')) || '';
  check('the Place order button states the reviewed amount',
        money(placeLabel) === ORDER_TOTAL, placeLabel.trim());

  const accepted = page.waitForResponse(
    (r) => r.url().includes('orders/submit') && r.request().method() === 'PUT'
           && (r.status() === 200 || r.status() === 201),
    { timeout: 30000 },
  ).catch(() => null);
  await placeBtn.click();
  const acceptedResponse = await accepted;
  check('clicking Place order submits and is accepted', !!acceptedResponse,
        acceptedResponse ? String(acceptedResponse.status()) : 'no accepted submit');

  // THE APP SENT THE QUOTE IT RENDERED — not a recomputed one, and not none.
  const sent = submitRequests[submitRequests.length - 1];
  let sentPayload = null;
  try { sentPayload = JSON.parse(sent?.body || 'null'); } catch { /* ignore */ }
  check('the submission echoes the reviewed quote reference',
        sentPayload?.quote_ref === quoteRef && sentPayload?.order === orderId,
        `quote_ref=${sentPayload?.quote_ref === quoteRef ? 'match' : 'MISMATCH'}`);

  await page.waitForURL(/\/diner\/basket\/order-complete/, { timeout: 20000 }).catch(() => {});
  check('a definitive success navigates to the confirmation',
        /\/diner\/basket\/order-complete/.test(page.url()), page.url());

  // CLEARED ONLY ON A DEFINITIVE SUCCESS — it held both lines through the review
  // sheet and both refusals above, and is empty only now.
  const remaining = await readBasketCount(page);
  check('the basket is cleared only after the order is accepted', remaining === 0,
        `remaining=${remaining}`);

  // ── 8. What was SAVED, and what reaches the kitchen ─────────────────────
  //
  // TWO DIFFERENT CLAIMS, READ FROM THE TWO SURFACES THAT CARRY THEM. The money
  // is on the diner's own order read; the kitchen ticket deliberately carries no
  // amount at all (it carries what to COOK), so asserting a total against it
  // would be asserting against a field that does not exist.
  const saved = await asDiner(page, `/api/v1/orders/journey/order-details/?order=${orderId}`, {});
  check('the accepted order stores the amount the diner agreed to',
        Number(saved.body?.data?.actual_cost) === ORDER_TOTAL,
        `saved=${saved.body?.data?.actual_cost} agreed=${ORDER_TOTAL}`);
  check('the accepted order is no longer a draft',
        saved.body?.data?.order_status === 'pending',
        `order_status=${saved.body?.data?.order_status}`);

  const board = await operator(`/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const list = Array.isArray(board.body?.data) ? board.body.data : [];
  const mine = list.filter((t) => String(t.id) === String(orderId));
  check('exactly ONE accepted order reaches the kitchen', mine.length === 1,
        `matching=${mine.length} of ${list.length} active`);
  const burgerTicketLine = (mine[0]?.items || [])
    .find((l) => l.item_name_snapshot === 'Signature Burger');
  check('the kitchen is told to cook what the diner configured',
        burgerTicketLine?.quantity === 2
        && (burgerTicketLine?.extras || []).length === 1
        && burgerTicketLine.extras[0].item_name_snapshot === 'Extra Cheese',
        `qty=${burgerTicketLine?.quantity} extras=${(burgerTicketLine?.extras || []).length}`);

  check('the page raised no uncaught errors', pageErrors.length === 0,
        pageErrors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  console.log('This is a MANUAL repeatable run against disposable fixtures — not a CI gate.');
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error('JOURNEY ERROR', e); process.exit(2); });
