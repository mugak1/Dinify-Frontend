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
