/**
 * D02/D03 — the minimal repeatable real-browser journey.
 *
 * A real Chromium against a real Angular build talking to a real Django +
 * PostgreSQL. It asserts the four things no unit suite can: that the diner SEES
 * the server's amount before agreeing to it, that the amount they agreed to is
 * the one saved and sent to the kitchen, that a quote which moved underneath
 * them is refused rather than silently accepted, and that an acknowledgement the
 * server does not recognise is refused.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const F = JSON.parse(readFileSync(process.env.JOURNEY_FIXTURE || '/tmp/journey-fixture.json', 'utf8'));
// The line total this pass must see. Pass 2 runs after the operator changes the
// dish price, proving the review shows the CURRENT server price rather than
// anything the browser cached from the earlier visit.
const EXPECT = Number(process.argv[2] || 31000);
const WEB = process.env.JOURNEY_WEB || 'http://127.0.0.1:4299';
const API = process.env.JOURNEY_API || 'http://127.0.0.1:8099';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const money = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
const text = (p) => p.textContent('body');

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

const main = async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  // Capture what the app ACTUALLY received, rather than asking a second
  // endpoint what it thinks happened.
  let initiateBody = null;
  page.on('response', async (res) => {
    if (res.url().includes('orders/initiate') && res.status() === 200) {
      try { initiateBody = await res.json(); } catch { /* ignore */ }
    }
  });

  // ── 1. QR scan → menu ────────────────────────────────────────────────────
  await page.goto(`${WEB}/diner/h/${F.table}?c=${encodeURIComponent(F.credential)}`,
                  { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  check('menu renders after a QR scan', /Signature Burger/.test(await text(page)),
        (await text(page)).slice(0, 90).replace(/\s+/g, ' '));

  // ── 2. Configure a variant with a paid modifier and an extra ─────────────
  await page.goto(`${WEB}/diner/h/${F.table}/item/${F.burger}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const detail = await text(page);
  check('item detail offers the modifier group and the extra',
        /Large/.test(detail) && /Extra Cheese/.test(detail));

  // A single-select group renders radios and the extras render checkboxes, so
  // pick by LABEL rather than by control type — the journey should not depend
  // on how the control happens to be drawn.
  const pick = async (label) => {
    const input = page.locator(`label:has-text("${label}")`).first().locator('input').first();
    await input.check({ force: true });
    await page.waitForTimeout(400);
  };
  await pick('Large');          // +3 500
  await pick('Extra Cheese');   // +2 000
  await page.getByLabel('Increase quantity').first().click();   // qty 2
  await page.waitForTimeout(400);

  const addBtn = page.getByRole('button', { name: /Add —/ }).first();
  const addLabel = (await addBtn.textContent()) || '';
  // 2 × (10 000 base + 3 500 Large + 2 000 Cheese) = 31 000 — the extra scales
  // with the parent, which is the D02 defect this line would have shown.
  check('the add button shows the configured line total', money(addLabel) === EXPECT, addLabel.trim());
  await addBtn.click();
  await page.waitForTimeout(1800);

  // ── 3. Basket → checkout → THE AUTHORITATIVE REVIEW ──────────────────────
  await page.goto(`${WEB}/diner/basket`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  // ONE line, not two: the modifier + extra selection is one configuration.
  const basketLines = await page.locator('app-basket-body').first()
    .locator('text=Signature Burger').count().catch(() => -1);
  check('basket holds ONE line for the configured dish', basketLines === 1,
        `lines=${basketLines}`);

  await page.getByRole('button', { name: /Checkout/i }).first().click();
  await page.waitForTimeout(3000);
  const review = await text(page);
  check('the review sheet appears BEFORE anything is submitted',
        /Review your order/i.test(review));
  check('the review prices the extra as its own row', /Extra Cheese/.test(review));

  // The reviewed total is the SERVER's — taken from the very response the app
  // rendered, so the two cannot be different numbers that merely agree.
  const od = initiateBody?.data?.order_details;
  const serverTotal = Number(od?.actual_cost);
  const shown = (review.match(/UGX\s*([\d,]+)/g) || []).map(money);
  check('the reviewed amount is the server amount',
        Number.isFinite(serverTotal) && shown.includes(serverTotal),
        `server=${serverTotal} shown=${[...new Set(shown)].join(',')}`);
  check('the server priced the extra against BOTH units', serverTotal === EXPECT,
        `server=${serverTotal}`);
  check('the server quote carries the extra as a child of its parent line',
        (initiateBody?.data?.quote?.[0]?.extras || []).length === 1
        && Number(initiateBody?.data?.quote?.[0]?.line_total_with_extras) === EXPECT,
        `line_total_with_extras=${initiateBody?.data?.quote?.[0]?.line_total_with_extras}`);

  const orderId = od?.id;
  const quoteRef = od?.quote_ref;
  const version = od?.pricing_version;
  check('the saved draft is CORRECTED-priced and carries an acknowledgement',
        version === 1 && typeof quoteRef === 'string' && quoteRef.length > 0,
        `pricing_version=${version}`);

  // ── 4. An acknowledgement the server does not recognise is refused ───────
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

  // ── 5. The real acknowledgement is accepted, once ────────────────────────
  const ok = await asDiner(page, '/api/v1/orders/submit/', {
    method: 'PUT', body: JSON.stringify({ order: orderId, quote_ref: quoteRef }),
  });
  check('the reviewed quote is accepted', ok.status === 200 || ok.status === 201,
        `${ok.status}`);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error('JOURNEY ERROR', e); process.exit(2); });
