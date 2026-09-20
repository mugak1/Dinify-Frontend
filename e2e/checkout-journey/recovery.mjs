/**
 * D04 — INDUCED LOSS, in a real browser against a real server.
 *
 * The sibling of `journey.mjs`, and it tests the thing that one deliberately
 * cannot: what happens when the checkout does NOT go cleanly. Every scenario
 * below reproduced a real defect before D04, and each one is now an assertion
 * rather than a narration.
 *
 *   RELOAD BETWEEN PRICING AND ACCEPTANCE. The idempotency key lived in an
 *   in-memory field, so the reload dropped it and the next attempt minted a
 *   NEW one — the server's whole guarantee bypassed by the single most likely
 *   thing a person does when a checkout appears stuck.
 *
 *   A LOST ACCEPTANCE RESPONSE. The server COMMITS and only the browser's
 *   view of the reply is suppressed. The retry was answered `This order
 *   cannot be submitted.` — a failure reported for an operation that
 *   succeeded, with the kitchen already cooking it.
 *
 *   RECOVERY WITH NO ORDER ID. A client that lost the response entirely held
 *   nothing to look the order up by, so it could not tell an accepted order
 *   from an abandoned draft without placing another one.
 *
 * THE SEAM IS `route.fetch()` THEN `route.abort()`, and the distinction is the
 * point: the backend really processes the request, and only the browser's view
 * of the reply is destroyed. Aborting BEFORE the fetch would test nothing —
 * the server would never have seen it.
 *
 * MANUAL, like the journey: it needs a disposable PostgreSQL, a running Django
 * and a running dev server, and it frees the table between scenarios through
 * the real kitchen API rather than by touching the database. Run it the same
 * way — see README.md — and give it a FRESH database: the fixture seed is
 * idempotent and reuses an existing restaurant, so orders left by an earlier
 * run occupy the table and every scenario here fails at a disabled Checkout
 * button.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const F = JSON.parse(readFileSync(
  process.env.JOURNEY_FIXTURE || '/tmp/journey-fixture.json', 'utf8'));
const WEB = process.env.JOURNEY_WEB || 'http://127.0.0.1:4299';
const API = process.env.JOURNEY_API || 'http://127.0.0.1:8099';

let passed = 0;
let failed = 0;
const check = (label, ok, detail = '') => {
  (ok ? passed++ : failed++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

// -- the operator channel, for ground truth and for freeing the table -------

const api = async (path, init = {}) => {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* not every reply is JSON */ }
  return { status: res.status, body };
};

const signIn = async () => {
  const { username, password } = F.operator;
  const login = await api('/api/v1/users/auth/login/', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  if (login.body?.data?.require_otp) {
    const verified = await api('/api/v1/users/auth/verify-otp/', {
      method: 'POST',
      body: JSON.stringify({ user: login.body.data.user_id, otp: '1234' }),
    });
    return verified.body?.data?.token ?? null;
  }
  return login.body?.data?.token ?? null;
};

const main = async () => {
  const token = await signIn();
  const op = (path, init = {}) => api(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });

  const activeTickets = async () => {
    const res = await op(
      `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
    return res.body?.data ?? res.body?.orders ?? [];
  };

  /** Free the table the way a restaurant does: serve what is on the board.
   *  Never by touching the database — the point of this file is that the
   *  real system reaches these states.
   *
   *  D05: each command names an explicit ACTION and the REVISION it acts on.
   *  The revision comes from the ticket the board is showing and is re-read
   *  after every step, because every applied command advances it. There is no
   *  fallback to the retired `{fulfilment_status}` form — the server refuses it,
   *  which is the point. */
  const clearTheBoard = async () => {
    for (const ticket of await activeTickets()) {
      let revision = ticket.fulfilment_revision;
      for (const action of ['advance', 'advance', 'serve']) {
        const res = await op(
          `/api/v1/kitchen/orders/${ticket.id}/fulfilment-status/`, {
            method: 'PUT',
            body: JSON.stringify({ action, if_revision: revision }),
          });
        if (res.status !== 200) break;
        revision = res.body?.data?.fulfilment_revision ?? revision + 1;
      }
    }
  };

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });

  /** A fresh tab with the recorders every scenario reads. */
  const openTab = async () => {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const state = { keys: [], initiated: [], submits: [], errors: [] };
    page.on('pageerror', (e) => state.errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().includes('orders/initiate') && r.method() === 'POST') {
        try {
          state.keys.push(JSON.parse(r.postData() || '{}').client_order_id);
        } catch { state.keys.push(null); }
      }
      if (r.url().includes('orders/submit')) state.submits.push(r.method());
    });
    page.on('response', async (r) => {
      if (r.url().includes('orders/initiate')
          && r.request().method() === 'POST') {
        let body = null;
        try { body = await r.json(); } catch { /* aborted */ }
        state.initiated.push({
          status: r.status(),
          id: body?.data?.order_details?.id ?? null,
        });
      }
    });
    return { page, state };
  };

  /** Scan, configure the burger, add it — the real UI, every step. */
  const buildBasket = async (page) => {
    await page.goto(
      `${WEB}/diner/h/${F.table}?c=${encodeURIComponent(F.credential)}`,
      { waitUntil: 'domcontentloaded' });
    await page.getByText('Signature Burger').first()
      .waitFor({ state: 'visible', timeout: 20000 });
    await page.goto(`${WEB}/diner/h/${F.table}/item/${F.burger}`,
                    { waitUntil: 'domcontentloaded' });
    const large = page.locator('label:has-text("Large")').first();
    await large.waitFor({ state: 'visible', timeout: 20000 });
    await large.locator('input').first().check({ force: true });
    const add = page.getByRole('button', { name: /Add —/ }).first();
    await add.waitFor({ state: 'visible' });
    await add.click();
  };

  /**
   * THE BASKET IS EDITED ON THE PAGE BEFORE CHECKOUT, and that is not
   * decoration — it is what makes scenario 1 able to fail.
   *
   * `BasketService.revision()` is a counter on a `providedIn: 'root'`
   * service, so it restarts at 0 on every page load. Arriving here by
   * `page.goto` and clicking Checkout immediately mints the key at
   * revision 0 — and the reload mints the next one at revision 0 too. So
   * a key scoped to the REVISION rather than to the basket's CONTENTS
   * produced two identical keys here and the scenario passed against the
   * exact defect it exists to catch (Codex P1 on PR #663). One stepper
   * click leaves the counter at 1 before the reload and 0 after it, while
   * the contents are restored identical — which is the real diner's
   * situation and the only version of it that discriminates.
   */
  const openReview = async (page) => {
    await page.goto(`${WEB}/diner/basket`, { waitUntil: 'domcontentloaded' });
    const more = page.getByRole('button', { name: 'Increase quantity' })
      .first();
    await more.waitFor({ state: 'visible', timeout: 20000 });
    await more.click();
    const checkout = page.getByRole('button', { name: /Checkout —/ }).first();
    await checkout.waitFor({ state: 'visible', timeout: 20000 });
    await checkout.click();
    const place = page.getByRole('button', { name: /Place order/ }).first();
    await place.waitFor({ state: 'visible', timeout: 20000 });
    return place;
  };

  // ══ 1. A RELOAD BETWEEN PRICING AND ACCEPTANCE ═════════════════════════
  console.log('\n=== 1. the diner reloads mid-checkout ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    await openReview(page);
    const firstKey = state.keys[0];

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Checkout —/ }).first()
      .waitFor({ state: 'visible', timeout: 20000 });
    await page.getByRole('button', { name: /Checkout —/ }).first().click();
    await page.getByRole('button', { name: /Place order/ }).first()
      .waitFor({ state: 'visible', timeout: 20000 });

    check('the reload sends the SAME idempotency key, not a fresh one',
          state.keys.length === 2 && !!firstKey && state.keys[1] === firstKey,
          `keys=${JSON.stringify(state.keys)}`);
    check('the server answers with the SAME draft, not a second one',
          state.initiated.length === 2
          && !!state.initiated[0].id
          && state.initiated[0].id === state.initiated[1].id,
          `ids=${JSON.stringify(state.initiated.map((i) => i.id))}`);

    await page.getByRole('button', { name: /Place order/ }).first().click();
    await page.waitForURL(/order-complete/, { timeout: 20000 })
      .catch(() => {});
    const tickets = await activeTickets();
    check('exactly ONE order reaches the kitchen after the reload',
          tickets.length === 1, `tickets=${tickets.length}`);
    check('the reload raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ 2. A LOST ACCEPTANCE RESPONSE ══════════════════════════════════════
  console.log('\n=== 2. the acceptance commits and the reply is lost ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);

    let realStatus = null;
    let swallowed = false;
    await page.route('**/orders/submit/**', async (route) => {
      if (route.request().method() !== 'PUT' || swallowed) {
        return route.continue();
      }
      swallowed = true;                  // ONE-SHOT: the retry passes through
      const real = await route.fetch();  // the REAL backend commits here…
      realStatus = real.status();
      await route.abort('connectionreset');   // …and the browser sees nothing
    });

    await place.click();
    await page.waitForFunction(
      () => !!document.body.textContent
            && !/Placing/.test(document.body.textContent),
      null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    check('the server really did accept it', realStatus === 200,
          `backend replied ${realStatus} to the intercepted PUT`);
    check('the accepted order is on the kitchen board',
          (await activeTickets()).length === 1);

    // The diner sees a failure and retries — the app re-prices (the existing
    // recovery), and the SECOND submission is what must not be told the
    // order cannot be placed.
    const retry = page.getByRole('button', { name: /^Retry$/ }).first();
    const offered = await retry.isVisible().catch(() => false);
    check('the diner is offered a retry rather than a dead end', offered);
    if (offered) {
      await retry.click();
      await page.getByRole('button', { name: /Place order/ }).first()
        .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await page.getByRole('button', { name: /Place order/ }).first()
        .click().catch(() => {});
      await page.waitForTimeout(2500);
    }

    const after = await activeTickets();
    check('the retry produced NO second accepted order',
          after.length === 1, `tickets=${after.length}`);
    const visible = (await page.locator('app-basket-body').first()
      .innerText().catch(() => '')) || '';
    check('the diner is NOT told the order cannot be placed',
          !/cannot be submitted/i.test(visible),
          JSON.stringify(visible.split('\n')
            .filter((l) => /cannot|couldn|error|failed/i.test(l)).slice(0, 3)));
    check('the lost acceptance raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ 3. RECOVERY WITH NO ORDER ID ═══════════════════════════════════════
  console.log('\n=== 3. the tab is reloaded after a lost acceptance ===');
  {
    // SELF-CONTAINED, and it has to be: `browser.newPage()` opens a new
    // CONTEXT, so a scenario cannot inherit the previous tab's storage —
    // which is exactly the state being tested. This one loses its own
    // acceptance and then RELOADS instead of retrying, because a retry ends
    // in a definitive success and correctly forgets the attempt.
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);
    const acceptedId = state.initiated[0]?.id ?? null;

    let swallowed = false;
    await page.route('**/orders/submit/**', async (route) => {
      if (route.request().method() !== 'PUT' || swallowed) {
        return route.continue();
      }
      swallowed = true;
      await route.fetch();                    // the server commits…
      await route.abort('connectionreset');   // …the browser never learns
    });
    await place.click();
    await page.waitForFunction(
      () => !!document.body.textContent
            && !/Placing/.test(document.body.textContent),
      null, { timeout: 20000 }).catch(() => {});

    // READ BEFORE THE RELOAD. This is the fact the whole change turns on: the
    // key is in DURABLE storage at the moment the connection dies. It used to
    // be a field on a service instance, and there was nothing here to read.
    const key = await page.evaluate(() => {
      const raw = sessionStorage.getItem('[dinify]diner.checkout.attempt');
      return raw ? JSON.parse(raw)?.value?.key ?? null : null;
    });
    check('the interrupted tab holds its intent key durably', !!key,
          `key=${key}`);
    const session = await page.evaluate(() => {
      const raw = sessionStorage.getItem('[dinify]diner.session');
      return raw ? JSON.parse(raw).value : null;
    });

    // The diner gives up on the spinner and reloads — the very action that
    // used to destroy the key.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const notice = await page.locator('[data-testid="checkout-recovery"]')
      .first().innerText().catch(() => '');
    check('the reloaded page TELLS the diner what happened',
          /already placed/i.test(notice), JSON.stringify(notice));
    const basketAfter = await page.evaluate(() => {
      const raw = sessionStorage.getItem('[dinify]diner.basket');
      if (raw === null) return 0;
      try { return JSON.parse(raw)?.value?.items?.length ?? -1; }
      catch { return -1; }
    });
    check('the finished basket is cleared, not left to be ordered again',
          basketAfter === 0, `lines=${basketAfter}`);
    const settled = await page.evaluate(() =>
      sessionStorage.getItem('[dinify]diner.checkout.attempt'));
    check('and the resolved attempt is forgotten — a definitive outcome',
          settled === null, `stored=${settled}`);
    const lostOrderIdLocal = acceptedId;

    if (key) {
      // The same read the app just made, issued directly so the assertions
      // are about the SERVER's answer rather than about the rendering.
      const recovered = await api(
        `/api/v1/orders/journey/order-details/?intent=${key}`,
        { headers: { 'X-Diner-Session': session } });
      check('the key alone resolves the order the diner cannot name',
            recovered.status === 200
            && recovered.body?.data?.id === lostOrderIdLocal,
            `status=${recovered.status} id=${recovered.body?.data?.id}`);
      check('and the server says it was ACCEPTED',
            recovered.body?.data?.accepted === true,
            `accepted=${recovered.body?.data?.accepted}`);
      check('with the exact moment it was accepted',
            typeof recovered.body?.data?.accepted_at === 'string',
            `accepted_at=${recovered.body?.data?.accepted_at}`);
      check('and states what this server can promise a checkout client',
            recovered.body?.data?.checkout_protocol >= 2,
            `checkout_protocol=${recovered.body?.data?.checkout_protocol}`);

      // THE CORRELATED PROJECTION (protocol 3). A client that lost its
      // response has to be able to prove the answer is about ITS command,
      // and to tell a draft from an acceptance the server cannot date.
      const co = recovered.body?.data?.checkout;
      check('the answer names this key, this order and this table',
            co?.intent_key === key && co?.order_id === lostOrderIdLocal
            && typeof co?.scope?.table === 'string',
            `intent_key=${co?.intent_key} order_id=${co?.order_id} `
            + `table=${co?.scope?.table}`);
      check('the acceptance verdict is the three-state one, not a boolean',
            co?.acceptance?.state === 'accepted',
            `state=${co?.acceptance?.state}`);
      check('a READ carries no outcome — it is not an acceptance attempt',
            co?.acceptance?.outcome === null,
            `outcome=${co?.acceptance?.outcome}`);
      check('the ORIGINAL accepted reference is published, not recomputed',
            typeof co?.acceptance?.quote_ref === 'string'
            && co.acceptance.quote_ref.length > 0,
            `quote_ref=${co?.acceptance?.quote_ref}`);
      check('current order state is labelled apart from the acceptance',
            typeof co?.current?.order_status === 'string'
            && typeof co?.current?.fulfilment_status === 'string',
            `order_status=${co?.current?.order_status} `
            + `fulfilment_status=${co?.current?.fulfilment_status}`);
      check('and the level is stated explicitly, not inferred',
            co?.checkout_protocol >= 3,
            `checkout.checkout_protocol=${co?.checkout_protocol}`);

      // A key from nowhere must not resolve to somebody's order.
      const foreign = await api(
        '/api/v1/orders/journey/order-details/'
        + '?intent=00000000-0000-4000-8000-000000000000',
        { headers: { 'X-Diner-Session': session } });
      check('an unknown key resolves to nothing, non-disclosingly',
            foreign.status === 404, `status=${foreign.status}`);
      const malformed = await api(
        '/api/v1/orders/journey/order-details/?intent=not-a-uuid',
        { headers: { 'X-Diner-Session': session } });
      check('a malformed key is the same 404, never a 500',
            malformed.status === 404, `status=${malformed.status}`);
      const unsessioned = await api(
        `/api/v1/orders/journey/order-details/?intent=${key}`);
      check('and the recovery read still requires a diner session',
            unsessioned.status !== 200, `status=${unsessioned.status}`);
    }

    check('the recovery raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ 4. THE CART MOVES ON WHILE THE ACCEPTANCE IS UNRESOLVED ════════════
  //
  // D04 R2. Scenario 3 reloads with the cart UNTOUCHED, so the accepted
  // purchase is still the one on screen and clearing it is right. This one
  // edits the cart first — through the real stepper, which re-reserves
  // nothing, so the intent key and the table are both unchanged. The
  // completion guard compared exactly those two, so a valid acceptance for
  // the OLD purchase erased a basket it had never contained.
  //
  // BOTH HALVES ARE ASSERTED, because either alone is satisfiable by being
  // wrong in the other direction: the acceptance must still be ANNOUNCED (a
  // real order was placed) and the newer cart must still be THERE.
  console.log('\n=== 4. the cart is edited while an acceptance is lost ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);

    let swallowed = false;
    await page.route('**/orders/submit/**', async (route) => {
      if (route.request().method() !== 'PUT' || swallowed) {
        return route.continue();
      }
      swallowed = true;
      await route.fetch();                    // the server commits…
      await route.abort('connectionreset');   // …the browser never learns
    });
    await place.click();
    await page.waitForFunction(
      () => !!document.body.textContent
            && !/Placing/.test(document.body.textContent),
      null, { timeout: 20000 }).catch(() => {});

    const storedBasket = () => page.evaluate(() => {
      const raw = sessionStorage.getItem('[dinify]diner.basket');
      if (raw === null) return null;
      try { return JSON.parse(raw)?.value?.items ?? null; } catch { return null; }
    });
    const before = await storedBasket();
    const beforeQty = before?.[0]?.quantity ?? 0;

    // THE EDIT. Same table, same key, no reservation — the interleaving the
    // key/scope guard cannot see.
    const more = page.getByRole('button', { name: 'Increase quantity' })
      .first();
    await more.waitFor({ state: 'visible', timeout: 20000 });
    await more.click();
    await page.waitForFunction(
      (was) => {
        const raw = sessionStorage.getItem('[dinify]diner.basket');
        if (raw === null) return false;
        try {
          return (JSON.parse(raw)?.value?.items?.[0]?.quantity ?? 0) > was;
        } catch { return false; }
      }, beforeQty, { timeout: 20000 }).catch(() => {});
    const edited = await storedBasket();
    const editedQty = edited?.[0]?.quantity ?? 0;
    check('the cart really was edited while the checkout was unresolved',
          editedQty > beforeQty, `${beforeQty} -> ${editedQty}`);

    // The diner reloads. Startup recovery resolves the acceptance the
    // browser never saw.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const noticeEl = page.locator('[data-testid="checkout-recovery"]').first();
    await noticeEl.waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});
    const notice = await noticeEl.innerText().catch(() => '');
    check('the recovered page still ANNOUNCES the acceptance',
          /already placed/i.test(notice), JSON.stringify(notice));

    const after = await storedBasket();
    check('the cart edited after the lost acceptance is NOT erased',
          Array.isArray(after) && after.length > 0,
          `lines=${after ? after.length : after}`);
    check('and it still holds exactly what the diner put in it',
          (after?.[0]?.quantity ?? 0) === editedQty,
          `qty=${after?.[0]?.quantity} expected=${editedQty}`);

    // The operation itself IS retired — the acceptance was recorded — so the
    // diner is free to check the newer cart out rather than being blocked.
    const settled = await page.evaluate(() =>
      sessionStorage.getItem('[dinify]diner.checkout.attempt'));
    check('the resolved attempt is retired, so the newer cart can be ordered',
          settled === null, `stored=${settled}`);

    const tickets = await activeTickets();
    check('and exactly ONE order reached the kitchen',
          tickets.length === 1, `tickets=${tickets.length}`);
    check('the interleaving raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ D06. THE WORLD CHANGES WHILE THE REVIEW SHEET IS OPEN ══════════════
  //
  // The two cases that separate a TRANSIENT refusal from a TERMINAL one, and
  // the reason no unit spec can settle them: each needs a REAL operator write
  // landing between the diner pricing an order and confirming it, and then the
  // real server deciding. What is being checked is not the message — it is
  // whether the diner's QUOTE SURVIVES, and whether exactly one order reaches
  // the kitchen either way.

  console.log('\n=== D06a. the restaurant pauses while the diner reads the quote ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);
    const keyBefore = state.keys[0];

    // A REAL pause through the real operator write — the same PUT the owner's
    // settings screen issues.
    const paused = await op('/api/v1/restaurant-setup/restaurants/', {
      method: 'PUT',
      body: JSON.stringify({ id: F.restaurant, accepting_orders: false }),
    });
    check('the pause was really written', paused.status === 200,
          `status=${paused.status}`);

    await place.click();
    await page.waitForFunction(
      () => !!document.body.textContent
            && !/Placing/.test(document.body.textContent),
      null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);

    check('the paused restaurant refuses the acceptance',
          (await activeTickets()).length === 0,
          'nothing may reach the kitchen after trading stopped');

    // THE QUOTE MUST SURVIVE. A pause is TRANSIENT: re-pricing here would
    // discard a perfectly good quote and ask the diner to agree to the same
    // amount again, while the kitchen is closed.
    const stored = await page.evaluate(() =>
      sessionStorage.getItem('[dinify]diner.checkout.attempt'));
    check('the checkout attempt survives the pause',
          stored !== null, `stored=${stored}`);

    // The owner resumes, and the diner taps again — the SAME key, and one order.
    await op('/api/v1/restaurant-setup/restaurants/', {
      method: 'PUT',
      body: JSON.stringify({ id: F.restaurant, accepting_orders: true }),
    });
    const retry = page.getByRole('button', { name: /Retry|Checkout —/ }).first();
    await retry.waitFor({ state: 'visible', timeout: 20000 });
    await retry.click();
    const place2 = page.getByRole('button', { name: /Place order/ }).first();
    await place2.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    if (await place2.isVisible().catch(() => false)) await place2.click();
    await page.waitForURL(/order-complete/, { timeout: 20000 }).catch(() => {});

    check('the resumed attempt reuses the SAME idempotency key',
          state.keys.every((k) => k === keyBefore),
          `keys=${JSON.stringify(state.keys)}`);
    check('exactly ONE order reaches the kitchen once trading resumes',
          (await activeTickets()).length === 1);
    check('the pause raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  console.log('\n=== D06b. the dish sells out while the diner reads the quote ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);

    // A REAL sold-out toggle through the kitchen's own "86" panel.
    const soldOut = await op(`/api/v1/kitchen/menu-items/${F.burger}/stock/`, {
      method: 'PUT', body: JSON.stringify({ in_stock: false }),
    });
    check('the dish was really taken off', soldOut.status === 200,
          `status=${soldOut.status}`);

    await place.click();
    await page.waitForFunction(
      () => !!document.body.textContent
            && !/Placing/.test(document.body.textContent),
      null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);

    check('the changed purchase refuses the acceptance',
          (await activeTickets()).length === 0,
          'the kitchen must not be sent a dish nobody agreed to');

    // TERMINAL, so the server RECORDED it — and the record is what makes a
    // replacement quote safe. Bringing the dish back must NOT resurrect the
    // old quote: a queued acceptance for it can never execute afterwards.
    await op(`/api/v1/kitchen/menu-items/${F.burger}/stock/`, {
      method: 'PUT', body: JSON.stringify({ in_stock: true }),
    });
    await page.waitForTimeout(500);
    check('the retired quote is not resurrected by the dish coming back',
          (await activeTickets()).length === 0);

    // CHANGED EXPECTATION, DELIBERATELY (D06/O1) — and this is its SECOND
    // move, so both are recorded.
    //
    // It first required every key to be the SAME, on the reasoning that the
    // basket has not changed so the purchase has not changed. That holds for a
    // `quote_ref_stale` reprice and is FATAL for a closure: the key is bound to
    // the order the closure was written against, so re-pricing under it
    // REPLAYS that retired draft. G3b inverted it to require a NEW key.
    //
    // It then required the client to have re-priced AT ALL (`keys.length >= 2`)
    // by the time the refusal settled — i.e. it pinned an AUTOMATIC renewal
    // inside a failure handler. O1 removed that: a terminal refusal now
    // establishes the closure and STOPS, and the successor is minted by the
    // diner's deliberate "Review updated order" tap. Asserting the old shape
    // would pin exactly the auto-renew this change exists to remove, so the
    // assertion moves to what the contract now says: no key is minted by the
    // refusal, the review is offered rather than a dead Retry, and the tap
    // mints exactly one successor under a NEW key.
    check('the refusal alone mints NO replacement key',
          state.keys.length === 1,
          `keys=${JSON.stringify(state.keys)}`);

    const review = page.getByRole('button', { name: /Review updated order/ })
      .first();
    await review.waitFor({ state: 'visible', timeout: 20000 });
    check('the retired quote offers a review, never a dead Retry',
          !(await page.getByRole('button', { name: /^Retry$/ }).first()
              .isVisible().catch(() => false)));

    await review.click();
    await page.waitForTimeout(1500);
    check('and the deliberate tap re-prices under a NEW key',
          state.keys.length === 2
          && new Set(state.keys).size === state.keys.length,
          `keys=${JSON.stringify(state.keys)}`);
    check('the sold-out interleaving raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ D06c. THE CLOSURE RESPONSE IS LOST, AND THE SUCCESSOR IS DELIBERATE ══
  //
  // THE ONE INTERLEAVING NO UNIT SPEC CAN PRODUCE, and the dead end the C1/C3
  // work exists to close. D06b drops nothing: the client SEES the terminal
  // refusal and re-prices from it. Here the server COMMITS the closure and the
  // browser never learns — which is the single response D06 was built around
  // losing — so the only way the client can find out is the authorized read,
  // and the only way forward is a deliberate successor.
  //
  // Before C1 this looped: the read answered `not_accepted`, the client called
  // that an ordinary draft, re-sent the acceptance the server had permanently
  // refused, filed the refusal as unknown, and offered a Retry that came back
  // to the same place.
  console.log('\n=== D06c. the closure commits and the refusal is lost ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);
    const firstKey = state.keys[0];
    const firstOrder = state.initiated[0].id;

    // V1 — THE SAVED MONEY, READ BEFORE ANYTHING IS RETIRED. The final
    // assertion below claims the retired order was "never repriced", and a
    // claim about money has to be checked against money: an order that came
    // back with a different payable would satisfy every status check here and
    // still be exactly the thing a closure exists to prevent.
    const dinerSession = await page.evaluate(() => {
      const raw = sessionStorage.getItem('[dinify]diner.session');
      try { return JSON.parse(raw || 'null')?.value ?? null; } catch { return null; }
    });
    const readOrder = (id) => api(
      `/api/v1/orders/journey/order-details/?order=${id}`,
      { headers: { 'X-Diner-Session': dinerSession } });
    const priced = await readOrder(firstOrder);
    // THE PATH IS THE READ'S OWN, NOT THE INITIATE RESPONSE'S. `?order=`
    // publishes `quote_total` / `actual_cost` / `quote_closure` at the TOP of
    // `data` (D04/U1 + G3a); only the INITIATE response nests them under
    // `order_details`. Reading the nested path here inspected `undefined` and
    // compared two absences as equal — an assertion about money that could
    // never fail. `journey.mjs` records the same distinction at its own read.
    const savedMoney = {
      quote_total: priced.body?.data?.quote_total ?? null,
      actual_cost: priced.body?.data?.actual_cost ?? null,
    };
    check('the priced order is readable and names a payable',
          priced.status === 200 && savedMoney.quote_total !== null,
          `status=${priced.status} money=${JSON.stringify(savedMoney)}`);

    // Make the purchase genuinely unacceptable, through the kitchen's own
    // panel — so the server writes a REAL closure rather than a simulated one.
    await op(`/api/v1/kitchen/menu-items/${F.burger}/stock/`, {
      method: 'PUT', body: JSON.stringify({ in_stock: false }),
    });

    // THE SEAM: the server processes the acceptance and commits the closure;
    // the browser's view of the reply is destroyed.
    let swallowed = false;
    await page.route('**/orders/submit/**', async (route) => {
      if (route.request().method() !== 'PUT' || swallowed) {
        return route.continue();
      }
      swallowed = true;
      await route.fetch();                    // the server commits the closure…
      await route.abort('connectionreset');   // …the browser never learns
    });
    await place.click();
    await page.waitForTimeout(1500);

    check('the closure was really written and nothing reached the kitchen',
          swallowed && (await activeTickets()).length === 0);

    // The dish comes back. The closure is DURABLE, so this must not resurrect
    // the retired quote — and the successor needs an orderable dish.
    await op(`/api/v1/kitchen/menu-items/${F.burger}/stock/`, {
      method: 'PUT', body: JSON.stringify({ in_stock: true }),
    });

    // THE RELOAD. Recovery reads the published closure off the authorized
    // order read — the level-2 projection that exists for exactly this client.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const notice = await page.locator('[data-testid="checkout-recovery"]')
      .textContent().catch(() => '');
    check('the reloaded page states the quote could not be honoured',
          /could not be placed/i.test(notice || ''), `notice=${notice}`);

    // THE FOOTER IS READ ONCE THE ACTION IT BELONGS TO HAS RENDERED. The
    // recovery read and the footer it drives settle on their own schedule, so
    // reading the prompt on a fixed delay races them — and the first version of
    // this check did, reporting an empty string for an element that was about
    // to appear. Waiting for the button is the honest barrier: they render from
    // the same branch, so once it is there the sentence above it is too.
    const review = page.getByRole('button', { name: /Review updated order/ })
      .first();
    await review.waitFor({ state: 'visible', timeout: 20000 });
    // `.first()` IS LOAD-BEARING, and the reason is the point of the durable
    // record: the shell mounts a SECOND `app-basket-body` as the desktop
    // sidebar, which is CSS-hidden at this width but present in the DOM — and
    // it never runs recovery, so without the persisted closure it would still
    // be offering Checkout for a purchase that can never be placed. Both
    // mounts render the prompt, which is asserted below rather than worked
    // around; a bare `page.locator(...)` matches two and throws in strict mode,
    // which is what an earlier version of this check silently swallowed.
    const prompts = page.locator('[data-testid="updated-review-prompt"]');
    const prompt = await prompts.first().textContent().catch(() => '');

    check('and it offers a REVIEW, not a Retry that would be refused again',
          /nothing has been sent to the kitchen/i.test(prompt || ''),
          `prompt=${prompt}`);
    check('BOTH mounts read the established closure, not just the one that '
          + 'recovered', await prompts.count() === 2,
          `mounts=${await prompts.count()}`);
    check('no Retry button is offered for a quote that can never be accepted',
          !(await page.getByRole('button', { name: /^Retry$/ }).first()
              .isVisible().catch(() => false)));
    check('and nothing was re-sent to find that out',
          state.submits.length === 1,
          `submits=${JSON.stringify(state.submits)}`);

    // THE DELIBERATE SUCCESSOR. One tap, one new attempt.
    await review.click();
    // REPEATED CLICKS SHARE ONE SUCCESSOR. The button is replaced by the review
    // sheet, so a second tap is attempted before waiting for it.
    await review.click({ timeout: 1500 }).catch(() => {});
    const place2 = page.getByRole('button', { name: /Place order/ }).first();
    await place2.waitFor({ state: 'visible', timeout: 20000 });

    const secondKey = state.keys[state.keys.length - 1];
    const secondOrder = state.initiated[state.initiated.length - 1].id;
    check('the successor carries a NEW key — the old one is bound to a '
          + 'retired order',
          !!secondKey && secondKey !== firstKey,
          `k1=${firstKey} k2=${secondKey}`);
    check('and the server priced a NEW order under it',
          !!secondOrder && secondOrder !== firstOrder,
          `o1=${firstOrder} o2=${secondOrder}`);
    check('repeated taps produced exactly ONE successor',
          new Set(state.keys).size === 2,
          `keys=${JSON.stringify(state.keys)}`);

    // AND THE SUCCESSOR IS ITSELF RECOVERABLE. Drop its acceptance the same
    // way: the reload must resolve O2/K2, never mint a third attempt.
    let swallowed2 = false;
    await page.unroute('**/orders/submit/**');
    await page.route('**/orders/submit/**', async (route) => {
      if (route.request().method() !== 'PUT' || swallowed2) {
        return route.continue();
      }
      swallowed2 = true;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await place2.click();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    check('the lost successor resolves to the SAME attempt, not a third',
          new Set(state.keys).size === 2,
          `keys=${JSON.stringify(state.keys)}`);
    const resumed = await page.locator('[data-testid="checkout-recovery"]')
      .textContent().catch(() => '');
    check('and the diner is told the successor was placed',
          /already placed/i.test(resumed || ''), `notice=${resumed}`);

    const tickets = await activeTickets();
    check('exactly ONE order reaches the kitchen across the whole sequence',
          tickets.length === 1, `tickets=${tickets.length}`);
    check('and it is the SUCCESSOR, not the order whose quote was retired',
          tickets.length === 1 && tickets[0].id === secondOrder,
          `ticket=${tickets[0] && tickets[0].id} o2=${secondOrder}`);

    // O1 STAYS EXACTLY AS IT WAS. A closure is never deleted to recover, the
    // retired order is never repriced, and it never becomes an order.
    //
    // V1 — POSITIVELY ESTABLISHED, not satisfied by an unreadable answer.
    // This used to accept `status !== 200` as success, so a 404, a 500 or a
    // server that had stopped answering passed it — and it asserted nothing
    // about the saved money, which is the fact "never repriced" is about.
    const original = await op(
      `/api/v1/kitchen/orders/${firstOrder}/state/`, { method: 'GET' });
    check('the retired order is still READABLE and still an unaccepted draft',
          original.status === 200
          && original.body?.data?.order_status === 'initiated',
          `status=${original.status} `
          + `state=${JSON.stringify(original.body?.data ?? null)}`);

    const retired = await readOrder(firstOrder);
    check('its saved payable is byte-identical to what was priced',
          retired.status === 200
          && retired.body?.data?.quote_total === savedMoney.quote_total
          && retired.body?.data?.actual_cost === savedMoney.actual_cost,
          `before=${JSON.stringify(savedMoney)} after=${JSON.stringify({
            quote_total: retired.body?.data?.quote_total,
            actual_cost: retired.body?.data?.actual_cost,
          })}`);
    check('the closure the server wrote is still there — never deleted to '
          + 'recover',
          typeof retired.body?.data?.quote_closure?.reason === 'string',
          `closure=${JSON.stringify(
            retired.body?.data?.quote_closure ?? null)}`);
    check('and it never became an accepted order',
          retired.body?.data?.accepted !== true,
          `accepted=${retired.body?.data?.accepted}`);
    check('the lost-closure sequence raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ D06d. A PRE-COMMIT FAILURE IS NOT A CLOSURE ════════════════════════
  //
  // THE CONTROL FOR EVERYTHING ABOVE. The acceptance never reaches the server,
  // so nothing is closed and nothing is retired — and the client must NOT
  // invent a closure from a failure it merely observed. It keeps the key,
  // offers a Retry, and re-sends the SAME command.
  console.log('\n=== D06d. the acceptance never reaches the server ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);
    const key = state.keys[0];

    let blocked = false;
    await page.route('**/orders/submit/**', async (route) => {
      if (route.request().method() !== 'PUT' || blocked) {
        return route.continue();
      }
      blocked = true;
      await route.abort('connectionreset');   // NOTHING reaches the server
    });
    await place.click();
    await page.waitForTimeout(1500);

    check('nothing was accepted, because nothing arrived',
          (await activeTickets()).length === 0);
    check('the client offers a RETRY, never a review',
          await page.getByRole('button', { name: /^Retry$/ }).first()
            .isVisible().catch(() => false));
    check('no closure was invented from a failure the client merely observed',
          !(await page.locator('[data-testid="updated-review-prompt"]')
              .isVisible().catch(() => false)));

    await page.getByRole('button', { name: /^Retry$/ }).first().click();
    await page.waitForURL(/order-complete/, { timeout: 20000 }).catch(() => {});
    check('the retry re-sent the SAME command under the SAME key',
          state.keys.every((k) => k === key),
          `keys=${JSON.stringify(state.keys)}`);
    check('and exactly ONE order reaches the kitchen',
          (await activeTickets()).length === 1);
    check('the pre-commit failure raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ D06e. THE SUCCESSOR'S *INITIATION* IS LOST ═════════════════════════
  //
  // V1 — THE INTERLEAVING THE OTHERS DO NOT REACH. D06c loses the acceptance
  // that WRITES a closure, and then loses the successor's ACCEPTANCE. This
  // loses the successor's INITIATION: the server prices O2 under K2 and the
  // browser never learns that it exists.
  //
  // It is the state the record can least afford to get wrong. After the tap
  // the record holds K2 with NO command and NO order — so a client that reads
  // its own silence as "nothing happened" mints a THIRD key, the server
  // prices a third order, and the diner's one purchase has three drafts
  // behind it. A client that reads it as "an acceptance may be outstanding"
  // is equally wrong in the other direction: nothing was accepted, and
  // offering only a Retry for a command that was never issued is the dead end
  // this whole programme exists to remove.
  //
  // SEVEN STEPS, and each one is an assertion below:
  //   1. price O1 under K1 and open the review
  //   2. make the purchase unacceptable, so the server writes a REAL closure
  //   3. submit — the closure commits and the refusal is SEEN (not lost here)
  //   4. the client establishes the closure and offers the review
  //   5. tap Review — K2 is minted and the INITIATE response is destroyed
  //   6. reload — recovery must resolve K2 rather than mint a third key
  //   7. complete: ONE order reaches the kitchen, and O1 is still a retired,
  //      unaccepted, un-repriced draft
  console.log('\n=== D06e. the successor\'s initiation is lost ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);
    const place = await openReview(page);                       // 1
    const firstKey = state.keys[0];
    const firstOrder = state.initiated[0].id;

    const session = await page.evaluate(() => {
      const raw = sessionStorage.getItem('[dinify]diner.session');
      try { return JSON.parse(raw || 'null')?.value ?? null; } catch { return null; }
    });
    const read = (id) => api(
      `/api/v1/orders/journey/order-details/?order=${id}`,
      { headers: { 'X-Diner-Session': session } });
    const pricedFirst = await read(firstOrder);
    // Top-level on this read — see the note in D06c.
    const firstMoney = pricedFirst.body?.data?.quote_total ?? null;
    check('the first order is readable and names a payable',
          pricedFirst.status === 200 && firstMoney !== null,
          `status=${pricedFirst.status} quote_total=${firstMoney}`);

    await op(`/api/v1/kitchen/menu-items/${F.burger}/stock/`, {   // 2
      method: 'PUT', body: JSON.stringify({ in_stock: false }),
    });

    await place.click();                                          // 3
    await page.waitForTimeout(1500);
    check('the refusal is SEEN here — this scenario is about the next step',
          state.submits.length === 1,
          `submits=${JSON.stringify(state.submits)}`);
    check('and nothing reached the kitchen',
          (await activeTickets()).length === 0);

    await op(`/api/v1/kitchen/menu-items/${F.burger}/stock/`, {
      method: 'PUT', body: JSON.stringify({ in_stock: true }),
    });

    const review = page.getByRole('button', { name: /Review updated order/ })
      .first();
    await review.waitFor({ state: 'visible', timeout: 20000 });    // 4
    check('the retired quote offers a review rather than a Retry',
          !(await page.getByRole('button', { name: /^Retry$/ }).first()
              .isVisible().catch(() => false)));

    // THE SEAM, moved one request earlier than D06c's: the server PRICES the
    // successor and the browser's view of the reply is destroyed.
    let swallowed = false;
    await page.route('**/orders/initiate/**', async (route) => {   // 5
      if (route.request().method() !== 'POST' || swallowed) {
        return route.continue();
      }
      swallowed = true;
      await route.fetch();                    // the server creates O2…
      await route.abort('connectionreset');   // …the browser never learns
    });
    await review.click();
    await page.waitForTimeout(1500);

    const secondKey = state.keys[state.keys.length - 1];
    check('the successor was minted under a NEW key before it was sent',
          swallowed && !!secondKey && secondKey !== firstKey,
          `k1=${firstKey} k2=${secondKey}`);
    check('exactly TWO keys have ever been used',
          new Set(state.keys).size === 2,
          `keys=${JSON.stringify(state.keys)}`);

    await page.reload({ waitUntil: 'domcontentloaded' });          // 6
    await page.waitForTimeout(2000);

    check('the reload resolves the SAME attempt — no third key is minted',
          new Set(state.keys).size === 2,
          `keys=${JSON.stringify(state.keys)}`);
    const stored = await page.evaluate(() =>
      sessionStorage.getItem('[dinify]diner.checkout.attempt'));
    check('and the successor record survives the reload',
          typeof stored === 'string' && stored.includes(secondKey),
          `stored=${stored}`);
    check('a lost INITIATION is not read as an outstanding acceptance',
          !(await page.locator('[data-testid="checkout-recovery"]')
              .first().textContent().catch(() => ''))
          || !/still being confirmed/i.test(
              await page.locator('[data-testid="checkout-recovery"]')
                .first().textContent().catch(() => '')),
          'notice must not claim an acceptance that was never issued');

    // 7. THE DINER COMPLETES. One order, one key, and O1 untouched.
    const checkout = page.getByRole('button', { name: /Checkout —/ }).first();
    await checkout.waitFor({ state: 'visible', timeout: 20000 });
    await checkout.click();
    const place2 = page.getByRole('button', { name: /Place order/ }).first();
    await place2.waitFor({ state: 'visible', timeout: 20000 });
    await place2.click();
    await page.waitForURL(/order-complete/, { timeout: 20000 }).catch(() => {});

    check('still exactly TWO keys across the whole sequence',
          new Set(state.keys).size === 2,
          `keys=${JSON.stringify(state.keys)}`);
    const tickets = await activeTickets();
    check('exactly ONE order reaches the kitchen',
          tickets.length === 1, `tickets=${tickets.length}`);
    check('and it is NOT the order whose quote was retired',
          tickets.length === 1 && tickets[0].id !== firstOrder,
          `ticket=${tickets[0] && tickets[0].id} o1=${firstOrder}`);

    const retired = await read(firstOrder);
    check('O1 is still an unaccepted draft with its closure intact',
          retired.status === 200
          && retired.body?.data?.accepted !== true
          && typeof retired.body?.data?.quote_closure?.reason === 'string',
          `accepted=${retired.body?.data?.accepted} closure=${JSON.stringify(
            retired.body?.data?.quote_closure ?? null)}`);
    check('and its saved payable never moved',
          retired.body?.data?.quote_total === firstMoney,
          `before=${firstMoney} after=${retired.body?.data?.quote_total}`);
    check('the lost-initiation sequence raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  // ══ I1. A HELD INITIATION ANSWER, LANDING OVER A NEWER ACCEPTANCE ══════
  //
  // THE ONE SCHEDULE THE SINGLE FLIGHT MAKES REACHABLE, and the one no unit
  // spec can produce end to end: an initiation answer that is still coming
  // when a LATER acceptance has already been issued under the same key.
  //
  // The app-wide flight means two surfaces cannot both be pricing — so the
  // only way to overlap is for the first to give it back, which is what
  // `ngOnDestroy` does. An in-app navigation (the row's Edit control, a real
  // `router.navigate`) destroys the routed basket page while leaving its XHR
  // open; `page.goto` would not, because a document navigation cancels it.
  //
  //   1. price under K1 — the server creates O1 and the REPLY IS HELD
  //   2. tap Edit — the routed page is destroyed, the flight is released,
  //      the request is still in flight
  //   3. come back and tap Checkout — the SAME key, a second initiate, a
  //      real review
  //   4. Place order — the acceptance COMMITS and its reply is destroyed, so
  //      the record is K1 / accepting / {O1,Q1}
  //   5. release the held reply from step 1
  //
  // On the pre-fix client that reply wrote `reviewing` over the record, and
  // `isOutstanding` reads the STAGE — so the issued command stopped being
  // protected and the next changed purchase minted a fresh key, erasing the
  // only handle the unsettled acceptance could be recovered by.
  console.log('\n=== I1. a held initiation answer lands after an acceptance ===');
  {
    await clearTheBoard();
    const { page, state } = await openTab();
    await buildBasket(page);

    // THE SEAM: the server really prices O1; the browser's view of the reply
    // is held open until step 5.
    let release = null;
    let fulfilErr = null;
    const held = new Promise((resolve) => { release = resolve; });
    let holding = false;
    await page.route('**/orders/initiate/**', async (route) => {
      if (route.request().method() !== 'POST' || holding) {
        return route.continue();
      }
      holding = true;
      const response = await route.fetch();   // the server creates O1…
      await held;                             // …the browser waits
      try { await route.fulfill({ response }); }
      catch (e) { fulfilErr = e.message; }
    });

    await page.goto(`${WEB}/diner/basket`, { waitUntil: 'domcontentloaded' });
    const more = page.getByRole('button', { name: 'Increase quantity' })
      .first();
    await more.waitFor({ state: 'visible', timeout: 20000 });
    await more.click();
    const checkout1 = page.getByRole('button', { name: /Checkout —/ }).first();
    await checkout1.waitFor({ state: 'visible', timeout: 20000 });
    await checkout1.click();                                       // 1
    await page.waitForTimeout(1200);
    const firstKey = state.keys[0];
    check('the first initiation is in flight and its reply is held',
          holding && !!firstKey, `key=${firstKey}`);

    // 2. IN-APP navigation destroys the routed basket page. The flight is
    //    given back (`ngOnDestroy`); the request is not cancelled.
    await page.getByRole('button', { name: /^Edit / }).first().click();
    await page.waitForTimeout(800);
    await page.goBack();
    await page.waitForTimeout(800);

    // 3. A NEW routed instance prices under the SAME key. The server replays
    //    K1 and hands back the very order it created in step 1.
    const checkout2 = page.getByRole('button', { name: /Checkout —/ }).first();
    await checkout2.waitFor({ state: 'visible', timeout: 20000 });
    await checkout2.click();
    const place = page.getByRole('button', { name: /Place order/ }).first();
    await place.waitFor({ state: 'visible', timeout: 20000 });
    check('the second initiation reuses the SAME key',
          new Set(state.keys.filter(Boolean)).size === 1,
          `keys=${JSON.stringify(state.keys)}`);

    // 4. THE ACCEPTANCE COMMITS AND ITS REPLY IS DESTROYED.
    let dropped = false;
    await page.route('**/orders/submit/**', async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();                    // the server ACCEPTS O1…
      await route.abort('connectionreset');   // …the browser never learns
    });
    await place.click();
    await page.waitForTimeout(2000);

    // The record is stored INSIDE a `{value: ...}` envelope, exactly as every
    // other reader in this file unwraps it. Reading the raw object yields
    // `undefined` for every field, which makes an equality oracle pass
    // vacuously — the one failure mode a regression harness must not have.
    const readRecord = () => page.evaluate(() => {
      const raw = sessionStorage.getItem('[dinify]diner.checkout.attempt');
      return raw ? JSON.parse(raw)?.value ?? null : null;
    });
    const before = await readRecord();
    check('the record is ACCEPTING with the issued command',
          before?.stage === 'accepting' && !!before?.command?.orderId,
          `stage=${before?.stage} command=${JSON.stringify(before?.command)}`);
    check('and the server really accepted it',
          (await activeTickets()).length === 1);

    // 5. THE HELD REPLY FROM STEP 1 FINALLY LANDS.
    release();
    await page.waitForTimeout(3000);
    // THE PREMISE, ASSERTED. Every check below is about what the browser does
    // with that reply, so a reply that never arrived would make all of them
    // pass vacuously — which is the one failure mode a regression scenario
    // must not have. `ngOnDestroy` does NOT cancel the request, so the
    // destroyed instance's subscriber really is still waiting on it.
    check('the held reply really did land on the destroyed instance',
          state.initiated.length === 2 && fulfilErr === null,
          `initiated=${JSON.stringify(state.initiated)} err=${fulfilErr}`);

    const after = await readRecord();
    check('THE REGRESSION: the old answer does not move the record back to '
          + '`reviewing`',
          after?.stage === 'accepting',
          `stage=${after?.stage}`);
    // NOT a bare equality — two `undefined`s would satisfy that while proving
    // nothing. The command must still be THERE, and be the same one.
    check('THE REGRESSION: and the issued command survives it',
          !!after?.command?.orderId
            && after.command.orderId === before?.command?.orderId,
          `before=${JSON.stringify(before?.command)} `
          + `after=${JSON.stringify(after?.command)}`);
    check('the key never moved',
          !!after?.key && after.key === before?.key,
          `${before?.key} -> ${after?.key}`);
    check('no review sheet reopened for the stale answer',
          !(await page.getByRole('button', { name: /Place order/ }).first()
              .isVisible().catch(() => false)));

    // THE CONSEQUENCE, driven rather than asserted on storage: a changed
    // basket must NOT be allowed to mint a fresh key while that acceptance
    // is unresolved.
    const bump = page.getByRole('button', { name: 'Increase quantity' })
      .first();
    const bumped = await bump.isVisible().catch(() => false);
    if (bumped) {
      await bump.click();
      await page.waitForTimeout(600);
    }
    // EXERCISED, NOT SKIPPED. A conditional click that never happened would
    // leave the key set trivially unchanged, so the fact that the cart really
    // was edited is asserted rather than assumed.
    check('the cart really was edited while that acceptance was unresolved',
          bumped);
    const keysBefore = new Set(state.keys.filter(Boolean)).size;
    // BY ROLE AND ACCESSIBLE NAME, as every other scenario here locates it:
    // `:has-text` also matches ANCESTORS carrying the text, so it resolved to
    // an outer control that is never enabled and the press never happened.
    const cta = page
      .getByRole('button', { name: /^Retry$|^Checkout —/ }).first();
    // BEST-EFFORT AND REPORTED. A `.click()` on a disabled control throws and
    // would abort the whole harness — a crash where a FAIL belongs — and a
    // silent skip would make the check below pass for the wrong reason. So
    // whether the press happened is carried in the message.
    //
    // MEASURED: it does not happen, on the fixed tree OR the mutated one, and
    // that is correct rather than a gap. The acceptance really committed, so
    // the table is occupied and the footer's FIRST branch
    // (`tableHasOngoingOrder`) renders a disabled control — there is no
    // mutating CTA to press. The discriminating evidence in this scenario is
    // therefore the STAGE, which fails against main's shape; the key-minting
    // consequence is pinned deterministically by
    // `basket-body.initiation-ownership.spec.ts`, which drives `reserveIntent`
    // directly instead of through a UI that correctly refuses to offer it.
    const pressed = await cta.isEnabled().catch(() => false);
    if (pressed) {
      await cta.click();
      await page.waitForTimeout(2500);
    }
    check('THE CONSEQUENCE: no fresh key is minted for the changed basket',
          new Set(state.keys.filter(Boolean)).size === keysBefore,
          `pressed=${pressed} keys=${JSON.stringify(state.keys)}`);
    check('still exactly ONE order in the kitchen',
          (await activeTickets()).length === 1);
    check('the held-answer sequence raised no uncaught errors',
          state.errors.length === 0, JSON.stringify(state.errors));
    await page.close();
  }

  await browser.close();
  console.log(`\n${passed}/${passed + failed} induced-loss checks passed`);
  console.log('This is a MANUAL repeatable run against disposable fixtures '
              + '— not a CI gate.');
  if (failed) process.exit(1);
};

main().catch((error) => {
  console.error('HARNESS ERROR', error);
  process.exit(2);
});
