/**
 * WHICH CONFIRMATION A REAL QUOTE GETS, against a real server.
 *
 * The sibling of `journey.mjs` and `recovery.mjs`, for the one decision neither
 * makes: the plain "Are you sure you want to place this order?" prompt (#693)
 * versus the itemised review. The plain prompt lists nothing, so it may stand
 * in for the review only when the server's quote matches the basket LINE BY
 * LINE. An equal grand total is not enough, and these scenarios keep the grand
 * total exactly equal on purpose:
 *
 *   CONTROL       nothing changed        -> the plain prompt
 *   RELABEL       the operator renames the selected choice (same id, same
 *                 price) after the diner added it -> the itemised review,
 *                 showing the server's new label
 *   OFFSETTING    one dish goes up and another down by the same amount
 *                 -> the itemised review, showing the new line amounts
 *
 * The server really prices and snapshots each quote: every change goes through
 * the real operator API (`restaurant-setup/menuitems/`), after the basket was
 * built and before Checkout, which is the interval a relabel reaches a diner in.
 * Nothing is ever ACCEPTED — each scenario ends with Cancel, so the table stays
 * free — and every catalogue change is put back before the next scenario.
 *
 * MANUAL, like its siblings: a disposable PostgreSQL, the seed, a running
 * Django and a running dev server. See README.md.
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

/** The burger's option definition as the seed writes it, with one label
 *  swappable. Same ids, same prices: only the words change. */
const burgerOptions = (largeName) => ({
  hasModifiers: true,
  groups: [{
    id: 'g-size', name: 'Size', selectionType: 'single',
    minSelections: 1, maxSelections: 1,
    choices: [
      { id: 'c-reg', name: 'Regular', additionalCost: 0, available: true },
      { id: 'c-large', name: largeName, additionalCost: 3500, available: true },
    ],
  }],
});

const main = async () => {
  const token = await signIn();
  check('the fixture operator can sign in', !!token);
  const op = (path, init = {}) => api(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const edit = (body) => op('/api/v1/restaurant-setup/menuitems/', {
    method: 'PUT', body: JSON.stringify(body),
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });

  /** A fresh context, recording what was initiated and whether anything was
   *  ever submitted. */
  const openTab = async () => {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const state = { initiated: [], submits: 0, errors: [] };
    page.on('pageerror', (e) => state.errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().includes('orders/submit')) state.submits += 1;
    });
    page.on('response', async (r) => {
      if (r.url().includes('orders/initiate') && r.request().method() === 'POST') {
        try { state.initiated.push((await r.json())?.data); } catch { /* aborted */ }
      }
    });
    return { page, state };
  };

  /** Scan, then add one configured dish through the real item page. */
  const scan = async (page) => {
    await page.goto(`${WEB}/diner/h/${F.table}?c=${encodeURIComponent(F.credential)}`,
                    { waitUntil: 'domcontentloaded' });
    await page.getByText('Signature Burger').first()
      .waitFor({ state: 'visible', timeout: 20000 });
  };
  const add = async (page, itemId, choiceLabel) => {
    await page.goto(`${WEB}/diner/h/${F.table}/item/${itemId}`,
                    { waitUntil: 'domcontentloaded' });
    const choice = page.locator(`label:has-text("${choiceLabel}")`).first();
    await choice.waitFor({ state: 'visible', timeout: 20000 });
    await choice.locator('input').first().check({ force: true });
    const button = page.getByRole('button', { name: /Add —/ }).first();
    await button.waitFor({ state: 'visible' });
    await button.click();
    await page.waitForTimeout(500);
  };

  /** Open the basket, read the total it SHOWS, press Checkout. */
  const checkout = async (page) => {
    await page.goto(`${WEB}/diner/basket`, { waitUntil: 'domcontentloaded' });
    const cta = page.getByRole('button', { name: /Checkout —/ }).first();
    await cta.waitFor({ state: 'visible', timeout: 20000 });
    const label = (await cta.textContent()) || '';
    const shown = (label.match(/UGX\s*([\d,.]+)/) || [])[1]?.replace(/,/g, '');
    await cta.click();
    return Number(shown);
  };

  /** Which confirmation appeared — the one expected, and only that one. */
  const confirmation = async (page, label, expected) => {
    // The prompt's OWN button, never its `data-testid` wrapper: that element
    // holds only fixed-position children, so it has no box and Playwright
    // never reports it visible — a check against it could not fail.
    const plainPrompt = page.getByTestId('checkout-confirm')
      .getByRole('button', { name: /^Order$/ });
    const review = page.getByRole('heading', { name: 'Review your order' });
    const wanted = expected === 'plain' ? plainPrompt : review;
    const other = expected === 'plain' ? review : plainPrompt;
    const shown = await wanted.first().waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true, () => false);
    const otherShown = await other.first().isVisible().catch(() => false);
    check(`${label}: the ${expected === 'plain'
      ? 'plain "Are you sure?" prompt' : 'itemised review'} is the one shown`,
          shown && !otherShown, `shown=${shown} other=${otherShown}`);
  };

  /** Cancel whichever confirmation is up and prove nothing was placed. */
  const cancel = async (page, state, label) => {
    const plainCancel = page.getByTestId('checkout-confirm')
      .getByRole('button', { name: /^Cancel$/ });
    if (await plainCancel.first().isVisible().catch(() => false)) {
      await plainCancel.first().click();
    } else {
      await page.getByRole('button', { name: /Back to basket/ }).first().click();
    }
    await page.waitForTimeout(500);
    check(`${label}: nothing was submitted`, state.submits === 0,
          `submits=${state.submits}`);
    check(`${label}: no uncaught errors`, state.errors.length === 0,
          JSON.stringify(state.errors));
  };

  const payableOf = (data) => Number(data?.order_details?.quote_total);

  // ══ CONTROL. NOTHING CHANGED ════════════════════════════════════════════
  console.log('\n=== CONTROL. an unchanged purchase ===');
  {
    const { page, state } = await openTab();
    await scan(page);
    await add(page, F.burger, 'Large');
    const shownTotal = await checkout(page);
    await confirmation(page, 'CONTROL', 'plain');
    const data = state.initiated.at(-1);
    check('CONTROL: the server priced exactly the total the basket showed',
          payableOf(data) === shownTotal, `server=${payableOf(data)} basket=${shownTotal}`);
    await cancel(page, state, 'CONTROL');
    await page.close();
  }

  // ══ RELABEL. SAME CHOICE ID, SAME PRICE, NEW WORDS ═══════════════════════
  console.log('\n=== RELABEL. the selected choice is renamed after it was added ===');
  {
    const { page, state } = await openTab();
    await scan(page);
    await add(page, F.burger, 'Large');
    const renamed = await edit({ id: F.burger,
      options: JSON.stringify(burgerOptions('Extra large')) });
    check('RELABEL: the operator renames "Large" to "Extra large"',
          renamed.status === 200, `${renamed.status}`);
    const shownTotal = await checkout(page);
    await confirmation(page, 'RELABEL', 'itemised');
    const data = state.initiated.at(-1);
    const line = data?.quote?.[0];
    check('RELABEL: the grand total did NOT move — only the words did',
          payableOf(data) === shownTotal, `server=${payableOf(data)} basket=${shownTotal}`);
    check('RELABEL: the server kept the same choice id',
          JSON.stringify(line?.selected_modifiers) === '{"g-size":["c-large"]}',
          JSON.stringify(line?.selected_modifiers));
    check('RELABEL: and snapshotted the NEW label',
          JSON.stringify(line?.modifiers) === '["Size: Extra large"]',
          JSON.stringify(line?.modifiers));
    const shownLabels = ((await page.locator('[data-testid="quote-line-modifiers"]')
      .first().textContent().catch(() => '')) || '').trim();
    check('RELABEL: the diner is SHOWN the new label before confirming',
          shownLabels === 'Size: Extra large', `shown="${shownLabels}"`);
    await cancel(page, state, 'RELABEL');
    const restored = await edit({ id: F.burger,
      options: JSON.stringify(burgerOptions('Large')) });
    check('RELABEL: the label is put back', restored.status === 200, `${restored.status}`);
    await page.close();
  }

  // ══ OFFSETTING. TWO PRICES MOVE, THE TOTAL DOES NOT ══════════════════════
  console.log('\n=== OFFSETTING. one dish up, another down, by the same amount ===');
  {
    const { page, state } = await openTab();
    await scan(page);
    await add(page, F.burger, 'Large');                    // 10000 + 3500
    await add(page, F.rounding, 'Half Even Down');         //    10 + 1.00
    const up = await edit({ id: F.burger, primary_price: '10005.00' });
    const down = await edit({ id: F.rounding, primary_price: '5.00' });
    check('OFFSETTING: the operator moves both prices',
          up.status === 200 && down.status === 200, `${up.status}/${down.status}`);
    const shownTotal = await checkout(page);
    await confirmation(page, 'OFFSETTING', 'itemised');
    const data = state.initiated.at(-1);
    check('OFFSETTING: the grand total did NOT move',
          payableOf(data) === shownTotal, `server=${payableOf(data)} basket=${shownTotal}`);
    const amounts = await page.locator('[data-testid="quote-line-amount"]').allTextContents();
    const tidy = amounts.map((a) => a.replace(/\s+/g, ' ').trim()).sort();
    check('OFFSETTING: the diner is SHOWN both new line amounts',
          JSON.stringify(tidy) === JSON.stringify(['UGX 13,505.00', 'UGX 6.00']),
          JSON.stringify(tidy));
    await cancel(page, state, 'OFFSETTING');
    const a = await edit({ id: F.burger, primary_price: '10000.00' });
    const b = await edit({ id: F.rounding, primary_price: '10.00' });
    check('OFFSETTING: both prices are put back',
          a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
    await page.close();
  }

  await browser.close();
  console.log(`\n${passed}/${passed + failed} confirmation-choice checks passed`);
  console.log('This is a MANUAL repeatable run against disposable fixtures — not a CI gate.');
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(2); });
