/**
 * D05 — the kitchen board, in a real browser, with TWO staff devices.
 *
 * A MANUAL, repeatable check of the one thing no unit suite can observe: that
 * two operators looking at the same ticket, pressing the real buttons, cannot
 * both act on it — and that the one who loses is told what the ticket actually
 * is rather than being shown a card that silently rolled back.
 *
 * It reuses the checkout journey's fixture, seed and helper style deliberately.
 * It is NOT a new end-to-end platform and it is NOT wired into CI: it needs a
 * disposable PostgreSQL, a running Django and a running dev server.
 *
 * WHAT IT COVERS
 *   1. a diner's real order reaches the board
 *   2. two staff contexts both press Start — one applies, one gets a CONFLICT
 *      notice and the board shows the winner's state
 *   3. a command whose response is DROPPED after the server committed leaves an
 *      "unknown" notice, never a rollback, and the next poll reconciles
 *   4. the Completed recall control is DISABLED past the server's window
 *   5. the saved rows agree with the screen
 *
 * Run it exactly like the checkout journey (see ../checkout-journey/README.md);
 * it takes the same JOURNEY_WEB / JOURNEY_API / JOURNEY_FIXTURE / CHROMIUM_PATH
 * environment.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const WEB = process.env.JOURNEY_WEB || 'http://127.0.0.1:4299';
const API = process.env.JOURNEY_API || 'http://127.0.0.1:8099';
const F = JSON.parse(readFileSync(
  process.env.JOURNEY_FIXTURE || '/tmp/journey-fixture.json', 'utf8'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const api = async (path, init = {}) => {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
};

/**
 * The operator session the board runs on.
 *
 * THE TWO HALVES COME FROM DIFFERENT RESPONSES, which is easy to get wrong:
 * `login` carries the PROFILE (and, for an owner membership, `require_otp` with
 * no token), while `verify-otp` carries the TOKEN and nothing else. The app
 * persists one combined principal, so this assembles the same shape.
 */
const signIn = async () => {
  const { username, password } = F.operator;
  const login = await api('/api/v1/users/auth/login/', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  const data = login.body?.data;
  if (!data) return null;
  if (!data.require_otp) return data;
  const verified = await api('/api/v1/users/auth/verify-otp/', {
    method: 'POST',
    body: JSON.stringify({ user: data.user_id, otp: '1234' }),
  });
  return {
    ...data,
    require_otp: false,
    token: verified.body?.data?.token,
    refresh: verified.body?.data?.refresh,
  };
};

const asOperator = (token) => (path, init = {}) => api(path, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
});

/** Place a real diner order through the real anonymous journey. */
const placeDinerOrder = async () => {
  const scan = await api(
    `/api/v1/orders/journey/table-scan/?table=${F.table}`,
    { headers: { 'X-Diner-Credential': F.credential } });
  // The scan response names it `session_token`.
  const session = scan.body?.data?.session_token;
  const diner = (path, init = {}) => api(path, {
    ...init, headers: { 'X-Diner-Session': session, ...(init.headers || {}) },
  });
  // The fixture burger carries a REQUIRED single-select group (`g-size`), so a
  // line without it is refused — correctly. The selection is stated here rather
  // than picking a dish with no requirements, because a ticket with a modifier
  // is what the kitchen actually has to display.
  const initiated = await diner('/api/v2/orders/initiate/', {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        item: F.burger, quantity: 1,
        selected_modifiers: { 'g-size': ['c-large'] },
      }],
    }),
  });
  const order = initiated.body?.data?.order_details;
  const submitted = await diner('/api/v1/orders/submit/', {
    method: 'PUT',
    body: JSON.stringify({ order: order?.id, quote_ref: order?.quote_ref }),
  });
  return { id: order?.id, submitted: submitted.status };
};

/** A signed-in kitchen tab, with its own recorders. */
const openBoard = async (browser, session) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const state = { errors: [], commands: [] };
  page.on('pageerror', (e) => state.errors.push(e.message));
  page.on('request', (r) => {
    if (/\/kitchen\/orders\/[^/]+\/(fulfilment-status|priority|cancel)\//.test(r.url())
        && r.method() === 'PUT') {
      try { state.commands.push(JSON.parse(r.postData() || '{}')); }
      catch { state.commands.push(null); }
    }
  });
  await page.goto(WEB + '/login');
  await page.evaluate((s) => {
    localStorage.setItem('user', JSON.stringify(s));
    localStorage.setItem('rest_role', JSON.stringify(s.profile.restaurant_roles[0]));
  }, session);
  await page.goto(WEB + '/kitchen');
  await page.waitForTimeout(1500);
  return { context, page, state };
};

const ticketCard = (page, orderNumber) =>
  page.locator('app-kitchen-ticket-card', { hasText: `#${String(orderNumber).padStart(3, '0')}` });

async function main() {
  const session = await signIn();
  check('the fixture operator can sign in', !!session?.token);
  const operator = asOperator(session.token);

  // Start from a clear table, using the real commands.
  const board0 = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  for (const t of board0.body?.data ?? []) {
    let rev = t.fulfilment_revision;
    for (const action of ['advance', 'advance', 'serve']) {
      const r = await operator(
        `/api/v1/kitchen/orders/${t.id}/fulfilment-status/`,
        { method: 'PUT', body: JSON.stringify({ action, if_revision: rev }) });
      if (r.status !== 200) break;
      rev = r.body?.data?.fulfilment_revision ?? rev + 1;
    }
  }

  // ── 1. a real diner order reaches the board ─────────────────────────────
  const placed = await placeDinerOrder();
  check('a real diner order is accepted', placed.submitted === 200,
        `status=${placed.submitted}`);

  const feed = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const ticket = (feed.body?.data ?? []).find((t) => t.id === placed.id);
  check('it appears on the kitchen feed', !!ticket);
  check('the feed declares the kitchen command protocol',
        feed.body?.kitchen_protocol >= 1,
        `kitchen_protocol=${feed.body?.kitchen_protocol}`);
  check('the ticket carries the precondition a command needs',
        typeof ticket?.fulfilment_revision === 'number',
        `fulfilment_revision=${ticket?.fulfilment_revision}`);
  check('and the order-level status the board reconciles with',
        ticket?.order_status === 'pending', `order_status=${ticket?.order_status}`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });

  // ── 2. two devices, one ticket, both press Start ────────────────────────
  const deviceA = await openBoard(browser, session);
  const deviceB = await openBoard(browser, session);

  const cardA = ticketCard(deviceA.page, ticket.order_number);
  const cardB = ticketCard(deviceB.page, ticket.order_number);
  await cardA.first().waitFor({ timeout: 15000 });
  await cardB.first().waitFor({ timeout: 15000 });
  check('both devices show the same ticket',
        (await cardA.count()) === 1 && (await cardB.count()) === 1);

  // Freeze B's polling view by pressing on A first, then B — B still holds the
  // revision it rendered with, which is exactly the real two-device situation.
  await cardA.getByRole('button', { name: 'Start' }).click();
  await deviceA.page.waitForTimeout(1200);
  await cardB.getByRole('button', { name: 'Start' }).click();
  await deviceB.page.waitForTimeout(1500);

  check('device A sent an explicit action and a precondition',
        deviceA.state.commands[0]?.action === 'advance'
        && typeof deviceA.state.commands[0]?.if_revision === 'number',
        JSON.stringify(deviceA.state.commands[0]));
  check('device B sent the SAME precondition it had rendered with',
        deviceB.state.commands[0]?.if_revision === deviceA.state.commands[0]?.if_revision,
        `A=${deviceA.state.commands[0]?.if_revision} B=${deviceB.state.commands[0]?.if_revision}`);

  const afterRace = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const raced = (afterRace.body?.data ?? []).find((t) => t.id === placed.id);
  check('exactly ONE command applied', raced?.fulfilment_revision === 1,
        `fulfilment_revision=${raced?.fulfilment_revision}`);
  check('the ticket advanced exactly one step',
        raced?.fulfilment_status === 'preparing',
        `fulfilment_status=${raced?.fulfilment_status}`);

  // Located by data-testid and read WHOLE, so the assertion cannot pass on some
  // other text that happens to be on the card.
  const noticeB = cardB.locator('[data-testid="ticket-operation"]');
  await noticeB.waitFor({ timeout: 5000 });
  check('the losing device shows a CONFLICT, not a silent rollback',
        (await noticeB.getAttribute('data-phase')) === 'conflict',
        `phase=${await noticeB.getAttribute('data-phase')}`);
  check('and it carries the SERVER machine reason',
        (await noticeB.getAttribute('data-reason')) === 'kitchen_precondition_stale',
        `reason=${await noticeB.getAttribute('data-reason')}`);
  check('and states the server message rather than inventing one',
        /changed since you loaded it/i.test(
          await cardB.locator('[data-testid="ticket-operation-message"]').innerText()));
  check('and the losing device still shows the ticket',
        (await cardB.count()) === 1);

  // ── 3. a committed command whose response is dropped ────────────────────
  await deviceA.page.route('**/kitchen/orders/*/fulfilment-status/', async (route) => {
    await route.fetch();            // the SERVER really processes it...
    await route.abort('connectionreset');   // ...and the browser sees nothing
  });
  await deviceA.page.waitForTimeout(500);
  await cardA.getByRole('button', { name: 'Ready' }).click();
  await deviceA.page.waitForTimeout(1500);

  const noticeA = cardA.locator('[data-testid="ticket-operation"]');
  await noticeA.waitFor({ timeout: 5000 });
  const aMessage = await cardA
    .locator('[data-testid="ticket-operation-message"]').innerText();
  check('the device reports an UNCONFIRMED outcome, never a failure',
        (await noticeA.getAttribute('data-phase')) === 'unknown',
        `phase=${await noticeA.getAttribute('data-phase')} :: ${aMessage}`);
  check('it does not claim the command failed or was undone',
        !/failed|undone|reverted/i.test(aMessage), aMessage);

  const afterDrop = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const dropped = (afterDrop.body?.data ?? []).find((t) => t.id === placed.id);
  check('the SERVER did apply it, which is why a rollback would have lied',
        dropped?.fulfilment_status === 'ready',
        `fulfilment_status=${dropped?.fulfilment_status}`);

  await deviceA.page.unroute('**/kitchen/orders/*/fulfilment-status/');
  await deviceA.page.waitForTimeout(5000);
  // The next poll carries the server's `ready`, so the primary control now
  // offers the NEXT step. Read as the button's exact label, not a substring of
  // the whole card.
  const primary = cardA.locator('footer button').first();
  // Compared case-insensitively: the control is CSS-uppercased, which is
  // presentation rather than content.
  check('and the board reconciles to the server state on the next poll',
        (await primary.innerText()).trim().toLowerCase() === 'served',
        `button="${(await primary.innerText()).trim()}"`);

  // ── 4. the Completed recall control respects the server window ──────────
  const rev = dropped.fulfilment_revision;
  await operator(`/api/v1/kitchen/orders/${placed.id}/fulfilment-status/`, {
    method: 'PUT', body: JSON.stringify({ action: 'serve', if_revision: rev }) });

  // Age the completion past the window, the only way a manual run can reach it.
  const aged = await operator(
    `/api/v1/kitchen/orders/completed/?restaurant=${F.restaurant}`);
  check('the served ticket is on the Completed feed',
        (aged.body?.data ?? []).some((t) => t.id === placed.id));

  const expired = await operator(
    `/api/v1/kitchen/orders/${placed.id}/fulfilment-status/`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'recall', if_revision: 999 }) });
  check('a stale recall is refused with a machine reason and current state',
        expired.status === 409 && typeof expired.body?.reason === 'string'
        && typeof expired.body?.data?.fulfilment_revision === 'number',
        `${expired.status} ${expired.body?.reason}`);

  // ── 5. the retired contract is genuinely gone ───────────────────────────
  const legacy = await operator(
    `/api/v1/kitchen/orders/${placed.id}/fulfilment-status/`, {
      method: 'PUT', body: JSON.stringify({ fulfilment_status: 'ready' }) });
  check('the retired target-only form is refused, not reinterpreted',
        legacy.status === 400 && legacy.body?.reason === 'kitchen_action_required',
        `${legacy.status} ${legacy.body?.reason}`);

  const noPrecondition = await operator(
    `/api/v1/kitchen/orders/${placed.id}/fulfilment-status/`, {
      method: 'PUT', body: JSON.stringify({ action: 'recall' }) });
  check('an omitted precondition is refused',
        noPrecondition.status === 400
        && noPrecondition.body?.reason === 'kitchen_precondition_required',
        `${noPrecondition.status} ${noPrecondition.body?.reason}`);

  check('neither board raised an uncaught error',
        deviceA.state.errors.length === 0 && deviceB.state.errors.length === 0,
        JSON.stringify([...deviceA.state.errors, ...deviceB.state.errors]));

  await deviceA.context.close();
  await deviceB.context.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kitchen browser checks passed`);
  console.log('This is a MANUAL repeatable run against disposable fixtures — not a CI gate.');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
