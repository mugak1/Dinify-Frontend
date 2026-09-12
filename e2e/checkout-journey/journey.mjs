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

// ── the fixture's arithmetic, stated once, AS CANONICAL DECIMAL STRINGS ─────
//
// The goldens are strings because the WIRE is strings. `35000.3` and
// '35000.30' are the same number and only one of them is the contract, so a
// journey that compares through `Number` cannot tell a correct payload from one
// that lost its scale — which is the exact class of defect the canonical-string
// quote was introduced to close.
//
// Burger 10 000 + Large 3 500 + Extra Cheese 2 000, at quantity 2 = 31 000.
const ADD_BUTTON_TOTAL = 31000;
// TWO INDEPENDENT MONETARY GOLDENS, and neither substitutes for the other.
//
// 1. THE NONZERO FRACTION. The operator raises the burger to 12 000.15 AFTER
//    the basket is built, so the parent unit is 12 000.15 + 3 500.00 =
//    15 500.15 and the line is exactly 2 × that plus the 4 000.00 of extras:
//    35 000.30. It proves a real fractional amount survives ROUND-THEN-MULTIPLY
//    extension, formatting and the wire — 15 500.15 × 2 in doubles is
//    31000.299999999996, and `| number` would render the total '35,000.3'.
const REPRICED_BURGER = '12000.15';
const REVIEW_BURGER_LINE = '35000.30';
// 2. THE SUB-CENT ROUNDING CONTROL. `additionalCost` is '1.005' in an
//    unvalidated JSON blob. Each unit component is quantized ONCE at 2dp with
//    ROUND_HALF_EVEN, and 1.005 ties to EVEN — so the adjustment is 1.00 and
//    the line is 10.00 + 1.00 = 11.00. Round-half-up anywhere in the chain
//    gives 1.01 and 11.01, and this run fails by exactly one cent rather than
//    passing with a plausible number.
const ROUNDING_LINE = '11.00';
const ORDER_TOTAL = '35011.30';          // 35 000.30 + 11.00
const ORDER_TOTAL_DISPLAY = '35,011.30'; // as the diner reads it

/** A canonical wire amount: digits, a point, EXACTLY two decimals. */
const CANONICAL_MONEY = /^-?\d+\.\d{2}$/;
/** Every monetary key the quote publishes, at each of its two levels. */
const LINE_MONEY_KEYS = [
  'unit_price', 'reference_unit_price', 'discounted_price',
  'unit_cost_of_options', 'total_cost', 'reference_total_cost',
  'discounted_cost', 'savings', 'line_actual_cost', 'line_total_with_extras',
];
const EXTRA_MONEY_KEYS = ['unit_price', 'discounted_price', 'actual_cost'];

/**
 * EXACT MINOR UNITS FROM A CANONICAL DECIMAL STRING — the oracle, and it is
 * deliberately test-local.
 *
 * It replaced `Math.round(Number(v) * 100)`, which cannot be the oracle for an
 * exactness claim: it is neither an exact decimal parser
 * (`Number('1.005') * 100` is `100.49999999999999`) nor the backend's
 * ROUND_HALF_EVEN rule, so it agrees with a correct server for ordinary
 * amounts and quietly disagrees on exactly the values these goldens exist to
 * pin. `BigInt` means no float is constructed at any point.
 *
 * It also REFUSES a non-canonical amount rather than coercing one. A value
 * that is not `-?\d+\.\d{2}` has already broken the wire contract, and an
 * oracle that silently parsed it would hide the break it is here to catch.
 *
 * It does NOT import the production parser. A test that checked the product
 * against itself could not detect the product being wrong.
 */
const minor = (value) => {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(String(value));
  if (!match) throw new Error(`not a canonical amount: ${JSON.stringify(value)}`);
  const magnitude = BigInt(match[2]) * 100n + BigInt(match[3]);
  return match[1] === '-' ? -magnitude : magnitude;
};

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

  // ── THE WIRE CARRIES CANONICAL DECIMAL STRINGS ───────────────────────────
  //
  // ASSERTED ON THE CURRENT BACKEND'S OWN SHAPE, with NO `?? actual_cost`
  // FALLBACK. That fallback is a real and deliberate compatibility path for
  // backend #314, which shipped the itemised quote before `quote_total` existed
  // — but reading through it HERE would let a current-backend regression that
  // drops or mangles `quote_total` pass this run silently on the lossy numeric
  // field. The compatibility is the CLIENT's to apply against an older server;
  // this journey runs against the current one and holds it to the contract.
  check('the payable is published as a canonical decimal string',
        typeof od?.quote_total === 'string'
        && CANONICAL_MONEY.test(od.quote_total),
        `quote_total=${JSON.stringify(od?.quote_total)}`);
  check('the reviewed payable is exactly the expected amount',
        od?.quote_total === ORDER_TOTAL,
        `quote_total=${od?.quote_total} expected=${ORDER_TOTAL}`);

  const quoteLines = initiateBody?.data?.quote || [];
  const badMoney = [];
  for (const l of quoteLines) {
    for (const k of LINE_MONEY_KEYS) {
      if (typeof l[k] !== 'string' || !CANONICAL_MONEY.test(l[k])) {
        badMoney.push(`${l.item_name}.${k}=${JSON.stringify(l[k])}`);
      }
    }
    for (const x of l.extras || []) {
      for (const k of EXTRA_MONEY_KEYS) {
        if (typeof x[k] !== 'string' || !CANONICAL_MONEY.test(x[k])) {
          badMoney.push(`${l.item_name}/${x.item_name}.${k}=${JSON.stringify(x[k])}`);
        }
      }
    }
  }
  check('every quote amount, at both levels, is a canonical decimal string',
        quoteLines.length === 2 && badMoney.length === 0, badMoney.join(' '));

  // ── THE EXACT ELEMENTS THE DINER READS ───────────────────────────────────
  //
  // Located by test id and compared WHOLE, rather than searched for as a
  // substring of the panel's text: a substring match is satisfied by any
  // figure anywhere on the sheet, which is precisely what an assertion about
  // "the amount being confirmed" must not accept.
  const shownTotal = ((await panel.locator('[data-testid="quote-total"]')
    .textContent().catch(() => '')) || '').trim();
  check('the review states the server amount, exactly, in the total element',
        shownTotal === `UGX ${ORDER_TOTAL_DISPLAY}`, `shown=${JSON.stringify(shownTotal)}`);
  // The basket's own figure was built from the PRE-reprice menu, so the two
  // genuinely differ — which is what makes this an assertion rather than a
  // coincidence that would also hold if the price had never moved.
  const basketFigure = ADD_BUTTON_TOTAL + 11;   // 31 000 + 11.00, the browser's
  check('the review shows the CURRENT server price, not the browser\'s',
        od?.quote_total === ORDER_TOTAL
        && minor(ORDER_TOTAL) !== BigInt(basketFigure) * 100n,
        `server=${od?.quote_total} browser-basket=${basketFigure}`);

  const burgerRow = panel.locator(`[data-testid="quote-line"][data-line-item="${F.burger}"]`);
  const shownBurger = ((await burgerRow.locator('[data-testid="quote-line-amount"]')
    .textContent().catch(() => '')) || '').trim();
  check('the burger line states its own amount exactly, fraction and all',
        shownBurger === `UGX 35,000.30`, `shown=${JSON.stringify(shownBurger)}`);

  // THE MODIFIER INSTRUCTIONS ARE ON THE SCREEN. The diner chose Large; the
  // review must say so, or they are confirming an amount without seeing what
  // it is for.
  const shownModifiers = ((await burgerRow.locator('[data-testid="quote-line-modifiers"]')
    .textContent().catch(() => '')) || '').trim();
  check('the review shows the modifier instructions the diner selected',
        /Large/.test(shownModifiers), `modifiers=${JSON.stringify(shownModifiers)}`);
  check('the review shows the parent quantity',
        /× 2/.test((await burgerRow.textContent().catch(() => '')) || ''));
  const shownExtra = ((await burgerRow.locator('[data-testid="quote-line-extra"]')
    .textContent().catch(() => '')) || '').trim();
  check('the review shows the extra AND its own quantity, not just the parent\'s',
        /Extra Cheese/.test(shownExtra) && /× 2/.test(shownExtra),
        `extra=${JSON.stringify(shownExtra)}`);

  const burgerLine = quoteLines.find((l) => l.item === F.burger);
  // THE NONZERO-FRACTION GOLDEN, on the canonical string: 15 500.15 × 2 in
  // doubles is 31000.299999999996, so a float anywhere in extension or
  // rendering misses by a hundredth rather than passing with a plausible number.
  check('the server quote carries the extra as a child of its parent line',
        (burgerLine?.extras || []).length === 1
        && burgerLine?.line_total_with_extras === REVIEW_BURGER_LINE,
        `line_total_with_extras=${burgerLine?.line_total_with_extras}`);
  check('the extra child carries the parent\'s quantity',
        burgerLine?.quantity === 2 && burgerLine?.extras?.[0]?.quantity === 2,
        `parent=${burgerLine?.quantity} extra=${burgerLine?.extras?.[0]?.quantity}`);
  // Composed in integer CENTS, not in doubles: the whole point of the
  // fractional golden is that `31000.30 + 4000.00` is where a float loses it.
  const cents = minor;
  check('the parent-plus-extras aggregate composes from its own parts, exactly',
        cents(burgerLine?.line_actual_cost) + cents(burgerLine?.extras?.[0]?.actual_cost)
          === cents(REVIEW_BURGER_LINE),
        `${burgerLine?.line_actual_cost} + ${burgerLine?.extras?.[0]?.actual_cost}`);
  check('the canonical selections reached the saved line',
        JSON.stringify(burgerLine?.selected_modifiers) === JSON.stringify({ 'g-size': ['c-large'] }),
        JSON.stringify(burgerLine?.selected_modifiers));

  // THE SUB-CENT GOLDEN, a DIFFERENT control from the fraction above: this one
  // proves half-even TIES, asserted on the canonical decimal string rather than
  // a number — '11.00' and 11 are the same value and only one is the contract.
  const roundingLine = quoteLines.find((l) => l.item === F.rounding);
  check('a sub-cent adjustment is quantized ROUND_HALF_EVEN, once, per unit',
        roundingLine?.line_total_with_extras === ROUNDING_LINE
        && roundingLine?.unit_cost_of_options === '1.00',
        `line=${roundingLine?.line_total_with_extras} modifier=${roundingLine?.unit_cost_of_options}`);

  // THE LINES ADD UP TO THE PAYABLE, exactly, counting each child once —
  // the reconciliation the client now enforces, proved against a real server.
  const summed = quoteLines.reduce(
    (total, l) => total + minor(l.line_total_with_extras), 0n);
  check('the quoted lines reconcile to the payable, to the cent',
        summed === minor(ORDER_TOTAL),
        `lines=${summed} payable=${minor(ORDER_TOTAL)}`);
  check('the server declares its quote complete',
        od?.quote_complete === true, `quote_complete=${od?.quote_complete}`);

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
  const placeLabel = ((await placeBtn.textContent().catch(() => '')) || '').trim();
  // The WHOLE label, not a number parsed out of it: `money()` would accept
  // '35,011.3' — the shape `| number` produces and the canonical string does not.
  check('the Place order button states the reviewed amount exactly',
        placeLabel === `Place order — UGX ${ORDER_TOTAL_DISPLAY}`,
        JSON.stringify(placeLabel));

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
  // THE CANONICAL FIELD, compared as the string it is. The legacy numeric
  // `actual_cost` beside it is what `float()` produced and is deliberately not
  // what this assertion reads.
  check('the accepted order stores the amount the diner agreed to',
        saved.body?.data?.quote_total === ORDER_TOTAL,
        `saved=${saved.body?.data?.quote_total} agreed=${ORDER_TOTAL}`);
  // THE LINES COME FROM `data.quote`, which is where this read publishes them
  // (D04/U1). This assertion used to look at `body.quote` — a key no response
  // has ever carried — and then `|| []` summed the absence to zero, so it was
  // reporting a missing field as a reconciliation failure. Reading the real
  // lines is what makes it an assertion about money again.
  const savedLines = saved.body?.data?.quote;
  check('the accepted order still reconciles across its own lines',
        saved.body?.data?.quote_complete === true
        && Array.isArray(savedLines) && savedLines.length > 0
        && savedLines.reduce((c, l) => c + minor(l.line_total_with_extras), 0n)
           === minor(ORDER_TOTAL),
        `quote_complete=${saved.body?.data?.quote_complete} `
        + `lines=${Array.isArray(savedLines) ? savedLines.length : 'absent'}`);
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
        && burgerTicketLine.extras[0].item_name_snapshot === 'Extra Cheese'
        // THE CHILD QUANTITY, not only the parent's: an extra that scaled
        // wrongly produces a ticket the kitchen works from incorrectly while
        // every money assertion above still passes.
        && burgerTicketLine.extras[0].quantity === 2,
        `qty=${burgerTicketLine?.quantity} extraQty=${burgerTicketLine?.extras?.[0]?.quantity}`);
  // `modifiers`, NOT `modifiers_snapshot`: the kitchen serializer renames the
  // column on the wire (`serializers_kitchen.py::_line`), and reading the model
  // field name here made the assertion inspect `undefined` and fail every run.
  check('the kitchen is told which modifier to prepare',
        (burgerTicketLine?.modifiers || []).some((m) => /Large/.test(String(m))),
        JSON.stringify(burgerTicketLine?.modifiers));

  check('the page raised no uncaught errors', pageErrors.length === 0,
        pageErrors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  console.log('This is a MANUAL repeatable run against disposable fixtures — not a CI gate.');
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error('JOURNEY ERROR', e); process.exit(2); });
