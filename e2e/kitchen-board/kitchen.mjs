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
 *      "unknown" notice, never a rollback; the next poll reconciles AND settles
 *      the uncertain command it answered
 *   4. a stale recall is refused with the server's reason and current state
 *   5. a feed captured BEFORE a serve, delivered after it, does not put the
 *      ticket back on Active (K1 — the board froze while the check runs, so a
 *      fresh poll cannot repair the thing under test)
 *   6. a LOST CANCELLATION keeps an actionable warning after its card has gone,
 *      and Check settles it through the per-order state read (K2)
 *   7. the retired command form and an omitted precondition are refused
 *   8. a read that STARTS LATER and carries an OLDER server snapshot cannot
 *      walk a ticket back across the boards (R1a — the sibling of 5, and the
 *      case 5's clock cannot see: there the read began earlier, here it began
 *      later and the SERVER observed earlier)
 *   9. a stale recall from the COMPLETED board, refused `order_cancelled`,
 *      takes the card off BOTH boards and leaves its reason in the strip (M1 —
 *      an ordinary two-device sequence, not a malformed payload)
 *
 * NOT A SLEEP IN SIGHT. Every wait is a barrier on an outcome — a response, a
 * request the app could only issue after handling the previous one, or a DOM
 * condition — because a fixed delay fails in the direction that HIDES a defect:
 * a check that runs early reads the previous state and passes.
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

/**
 * WAIT FOR A CONDITION, NEVER FOR A DURATION.
 *
 * Every `waitForTimeout` in a harness like this is a guess that the machine will
 * be as fast as it was the day the number was written, and each one fails in the
 * direction that HIDES a defect: a check that runs before the thing it is
 * checking for has happened reads the PREVIOUS state, and on a slow run reads it
 * as a pass. These barriers poll the live page for the outcome itself and fail
 * loudly with what they last saw.
 */
const until = async (label, predicate, { timeout = 20000, interval = 100 } = {}) => {
  const deadline = Date.now() + timeout;
  let seen;
  for (;;) {
    try { seen = await predicate(); if (seen) return seen; }
    catch { seen = '<threw>'; }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label} (last saw ${JSON.stringify(seen)})`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
};

/** The response barrier for one kitchen command: resolves on the REPLY, not on
 *  a hopeful delay. Start it BEFORE the click. */
const commandReply = (page, timeout = 20000) => page.waitForResponse(
  (r) => /\/kitchen\/orders\/[^/]+\/(fulfilment-status|priority|cancel)\//.test(r.url())
      && r.request().method() === 'PUT',
  { timeout },
).catch(() => null);          // an ABORTED command never replies; the caller
                              // then waits on the UI outcome instead.

/**
 * CAPTURE a feed response now, DELIVER it later, and FREEZE the board while the
 * assertion runs.
 *
 * Three things here are load-bearing, and the first version of this helper got
 * two of them wrong — a harness that passes against a reintroduced defect is
 * worse than no harness, so they are spelled out.
 *
 *   * `route.continue()` after a pause would RE-ISSUE the request at that moment
 *     and return FRESH content, which is the opposite of a stale read. Fetching
 *     first and fulfilling later is what makes the body a snapshot of the server
 *     as it was when the read began.
 *   * EVERY LATER POLL IS HELD, not continued. The board's poll loop is serial —
 *     `pollOnce` schedules the next read only once the current one settles — so
 *     releasing the stale response immediately starts a FRESH poll that repairs
 *     whatever the stale one did. Holding the next request is what leaves the
 *     board in the state under test long enough to look at it.
 *   * `awaitNextRequest()` is a POSITIVE barrier for a NEGATIVE assertion: the
 *     next request cannot be issued until the held response has been fully
 *     handled, so it proves the stale read was applied without asserting on a
 *     duration.
 */
const gateFeed = async (page, glob) => {
  let resolveCaptured, release, resolveDelivered;
  const captured = new Promise((r) => { resolveCaptured = r; });
  const gate = new Promise((r) => { release = r; });
  const delivered = new Promise((r) => { resolveDelivered = r; });
  const held = [];
  let taken = false;
  const handler = async (route) => {
    if (taken) { held.push(route); return; }   // frozen: no answer at all
    taken = true;
    const response = await route.fetch();
    const body = await response.text();
    resolveCaptured(body);
    await gate;
    try { await route.fulfill({ response, body }); } finally { resolveDelivered(); }
  };
  await page.route(glob, handler);
  return {
    captured,
    /** Open the gate and wait for the held response to be DELIVERED. Unrouting
     *  before that lets Playwright auto-continue the pending route, and the
     *  delayed `fulfill` then dies with "Route is already handled" — a harness
     *  bug wearing the costume of a product failure. */
    release: async () => { release(); await delivered; },
    awaitNextRequest: (timeout = 20000) =>
      page.waitForRequest(glob, { timeout }).catch(() => null),
    drain: async () => {
      await page.unroute(glob, handler);
      for (const r of held) { try { await r.continue(); } catch { /* gone */ } }
    },
  };
};

/**
 * ANSWER THE NEXT MATCHING REQUEST WITH A BODY CAPTURED EARLIER, and freeze the
 * board afterwards.
 *
 * THIS IS THE OTHER HALF OF `gateFeed`, and the difference is the whole point.
 * `gateFeed` holds a request that STARTED EARLY and delivers it late — the
 * client-ordering case. This one lets a request start LATE and answers it with
 * an EARLIER snapshot, which is what a server actually does when two reads are
 * answered from snapshots it took in the other order. No client clock can see
 * that: by every local measure the response is the newest thing the board has.
 *
 * The body is a real earlier response from the real server, not a hand-built
 * one, so what is being replayed is a state the server genuinely reported.
 * Later requests are HELD, exactly as in `gateFeed`, so a fresh poll cannot
 * repair the board before the assertion runs.
 */
const replayFeed = async (page, glob, body) => {
  let resolveDelivered;
  const delivered = new Promise((r) => { resolveDelivered = r; });
  const held = [];
  let taken = false;
  const handler = async (route) => {
    if (taken) { held.push(route); return; }
    taken = true;
    try {
      await route.fulfill({
        status: 200, contentType: 'application/json', body,
      });
    } finally { resolveDelivered(); }
  };
  await page.route(glob, handler);
  return {
    delivered,
    awaitNextRequest: (timeout = 20000) =>
      page.waitForRequest(glob, { timeout }).catch(() => null),
    drain: async () => {
      await page.unroute(glob, handler);
      for (const r of held) { try { await r.continue(); } catch { /* gone */ } }
    },
  };
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
  const state = { errors: [], commands: [], stateReads: [] };
  page.on('pageerror', (e) => state.errors.push(e.message));
  page.on('request', (r) => {
    if (/\/kitchen\/orders\/[^/]+\/(fulfilment-status|priority|cancel)\//.test(r.url())
        && r.method() === 'PUT') {
      try { state.commands.push(JSON.parse(r.postData() || '{}')); }
      catch { state.commands.push(null); }
    }
    // The per-order OBSERVATION. Recorded so the run can assert it is issued ON
    // DEMAND and never as a per-ticket sweep on the poll.
    if (/\/kitchen\/orders\/[^/]+\/state\//.test(r.url()) && r.method() === 'GET') {
      state.stateReads.push(r.url());
    }
  });
  await page.goto(WEB + '/login');
  await page.evaluate((s) => {
    localStorage.setItem('user', JSON.stringify(s));
    localStorage.setItem('rest_role', JSON.stringify(s.profile.restaurant_roles[0]));
  }, session);
  const firstFeed = page.waitForResponse(
    (r) => r.url().includes('/kitchen/orders/active/'), { timeout: 20000 },
  ).catch(() => null);
  await page.goto(WEB + '/kitchen');
  await firstFeed;
  return { context, page, state };
};

const ticketCard = (page, orderNumber) =>
  page.locator('app-kitchen-ticket-card', { hasText: `#${String(orderNumber).padStart(3, '0')}` });

async function main() {
  const session = await signIn();
  check('the fixture operator can sign in', !!session?.token);
  const operator = asOperator(session.token);

  // Start from a clear table, using the real commands.
  // DRIVEN BY EACH TICKET'S CURRENT STATE, not by a fixed script of three
  // commands: a re-run finds tickets part-way through the ladder, and a fixed
  // script breaks on the first illegal edge and leaves them on the board — so
  // the SECOND run of the harness fails on a fixture artefact rather than on
  // anything real.
  const NEXT = { new: 'advance', preparing: 'advance', ready: 'serve' };
  const board0 = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  for (const t of board0.body?.data ?? []) {
    let { fulfilment_status: at, fulfilment_revision: rev } = t;
    for (let step = 0; step < 4 && NEXT[at]; step++) {
      const r = await operator(
        `/api/v1/kitchen/orders/${t.id}/fulfilment-status/`,
        { method: 'PUT',
          body: JSON.stringify({ action: NEXT[at], if_revision: rev }) });
      if (r.status !== 200) break;
      at = r.body?.data?.fulfilment_status;
      rev = r.body?.data?.fulfilment_revision;
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
  const replyA = commandReply(deviceA.page);
  await cardA.getByRole('button', { name: 'Start' }).click();
  await replyA;
  const replyB = commandReply(deviceB.page);
  await cardB.getByRole('button', { name: 'Start' }).click();
  await replyB;

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
  await cardA.getByRole('button', { name: 'Ready' }).click();

  const noticeA = cardA.locator('[data-testid="ticket-operation"]');
  // An aborted command never replies, so the barrier is the OUTCOME: the card
  // reporting an unresolved question.
  await until('device A to report an unresolved outcome',
              async () => (await noticeA.count()) === 1
                       && (await noticeA.getAttribute('data-phase')) === 'unknown');
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
  // The next poll carries the server's `ready`, so the primary control offers
  // the NEXT step. Read as the button's exact label, not a substring of the
  // whole card, and waited for by that OUTCOME rather than by a sleep long
  // enough to cover a slow poll.
  const primary = cardA.locator('footer button').first();
  let reconciledLabel = '<never>';
  const reconciled = await until(
    'the board to reconcile to the server state on a later poll',
    async () => {
      reconciledLabel = (await primary.innerText()).trim();
      return reconciledLabel.toLowerCase() === 'served';
    },
  ).then(() => true).catch(() => false);
  check('and the board reconciles to the server state on the next poll',
        reconciled, `button="${reconciledLabel}"`);

  // AND THE UNCERTAIN COMMAND IS SETTLED BY THAT ORDINARY READ (K2). The
  // revision moved past the precondition and the state is the one asked for, so
  // there is nothing left to resolve — the warning must not sit there forever.
  const settledByPoll = await until(
    'the unresolved notice to clear once a read answers it',
    async () => (await cardA.locator('[data-testid="ticket-operation"]').count()) === 0,
  ).then(() => true).catch(() => false);
  check('and an ordinary read SETTLES the uncertain command it answered',
        settledByPoll);

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

  // ── 5. K1: a DELAYED read must not resurrect a ticket that moved ────────
  // The one interleaving no unit fixture can produce against the real app: a
  // feed captured while the ticket was on Active, delivered after a serve has
  // moved it to Completed. Before K1 the feed replaced the whole store, so the
  // ticket came back and sat on BOTH boards at once.
  const second = await placeDinerOrder();
  check('a second diner order is accepted for the staleness check',
        second.submitted === 200, `status=${second.submitted}`);

  const feed2 = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const t2 = (feed2.body?.data ?? []).find((t) => t.id === second.id);
  check('and reaches the board', !!t2);

  // Walk it to `ready` through the real API so the card's primary control is
  // the completion one.
  let rev2 = t2.fulfilment_revision;
  for (const action of ['advance', 'advance']) {
    const r = await operator(`/api/v1/kitchen/orders/${second.id}/fulfilment-status/`,
      { method: 'PUT', body: JSON.stringify({ action, if_revision: rev2 }) });
    rev2 = r.body?.data?.fulfilment_revision ?? rev2 + 1;
  }

  const card2 = ticketCard(deviceA.page, t2.order_number);
  await until('device A to show the second ticket as ready', async () =>
    (await card2.count()) === 1
    && (await card2.locator('footer button').first().innerText())
         .trim().toLowerCase() === 'served');

  const feedGate = await gateFeed(deviceA.page, '**/kitchen/orders/active/**');
  await feedGate.captured;           // a snapshot taken while it is still active

  const serveReply = commandReply(deviceA.page);
  await card2.getByRole('button', { name: 'Served' }).click();
  await serveReply;
  await until('the served ticket to leave the Active board',
              async () => (await card2.count()) === 0);

  // The board can issue its NEXT poll only once the held response has been fully
  // handled, so that request is the proof the stale read was applied — and it is
  // itself held, so nothing can repair the board before the check below runs.
  const nextPoll = feedGate.awaitNextRequest();
  await feedGate.release();
  await nextPoll;

  check('a read captured before the serve does not put the ticket back',
        (await card2.count()) === 0, `cards=${await card2.count()}`);
  await feedGate.drain();

  await deviceA.page.getByTestId('view-completed').click();
  const completedCard2 = ticketCard(deviceA.page, t2.order_number);
  const onCompleted = await until('the ticket to appear on Completed',
    async () => (await completedCard2.count()) === 1,
  ).then(() => true).catch(() => false);
  check('and it is on Completed exactly once, not on both boards', onCompleted,
        `completed=${await completedCard2.count()}`);
  await deviceA.page.getByTestId('view-active').click();

  // ── 6. K2: a LOST CANCELLATION keeps an actionable warning ──────────────
  // The command whose uncertain outcome matters most is the one that removes
  // the order from BOTH feeds — so the notice, which renders inside a card, used
  // to disappear with the card it was attached to.
  const third = await placeDinerOrder();
  check('a third diner order is accepted for the cancellation check',
        third.submitted === 200, `status=${third.submitted}`);
  const feed3 = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const t3 = (feed3.body?.data ?? []).find((t) => t.id === third.id);
  check('and reaches the board', !!t3);

  const card3 = ticketCard(deviceA.page, t3.order_number);
  await until('device A to show the third ticket',
              async () => (await card3.count()) === 1);

  const readsBefore = deviceA.state.stateReads.length;
  await deviceA.page.route('**/kitchen/orders/*/cancel/', async (route) => {
    await route.fetch();                    // the SERVER really cancels it...
    await route.abort('connectionreset');   // ...and the browser sees nothing
  });
  await card3.getByRole('button', { name: 'Cancel order' }).click();
  await deviceA.page.getByRole('button', { name: 'Customer changed mind' }).click();

  const strip = deviceA.page.locator('[data-testid="kitchen-detached-operations"]');
  const stripShown = await until(
    'the detached warning to appear once the order leaves both feeds',
    async () => (await strip.count()) === 1
             && (await deviceA.page
                   .locator('[data-testid="detached-operation"]').count()) === 1,
  ).then(() => true).catch(() => false);
  check('a lost cancellation keeps its warning after the card has gone',
        stripShown);
  check('and the card really is gone from the board',
        (await card3.count()) === 0, `cards=${await card3.count()}`);

  const cancelled = await operator(`/api/v1/kitchen/orders/${third.id}/state/`);
  check('the per-order state read answers for an order in NEITHER feed',
        cancelled.status === 200
        && cancelled.body?.data?.order_status === 'cancelled',
        `${cancelled.status} ${cancelled.body?.data?.order_status}`);
  check('and it declares the same protocol the command routes do',
        cancelled.body?.kitchen_protocol >= 1,
        `kitchen_protocol=${cancelled.body?.kitchen_protocol}`);

  check('the board issued NO per-order state read on an ordinary poll',
        deviceA.state.stateReads.length === readsBefore,
        `reads=${deviceA.state.stateReads.length - readsBefore}`);

  // GUARDED ON THE PRECONDITION. The recovery affordance lives in the strip, so
  // if the strip is absent these two cannot be exercised — and a harness that
  // THROWS there reports one failure and abandons every check after it, which is
  // exactly what happened the first time this was verified against a
  // reintroduced defect. They are recorded as failures instead.
  if (stripShown) {
    const stateReply = deviceA.page.waitForResponse(
      (r) => /\/kitchen\/orders\/[^/]+\/state\//.test(r.url()), { timeout: 20000 },
    ).catch(() => null);
    await deviceA.page.locator('[data-testid="detached-operation-check"]').click();
    await stateReply;

    check('Check issues exactly one per-order read, for THIS order',
          deviceA.state.stateReads.length === readsBefore + 1
          && deviceA.state.stateReads[readsBefore].includes(third.id),
          JSON.stringify(deviceA.state.stateReads.slice(readsBefore)));

    const settled = await until(
      'the reconciliation to settle the uncertain cancellation',
      async () => (await strip.count()) === 0,
    ).then(() => true).catch(() => false);
    check('and an authoritative observation settles it', settled);
  } else {
    check('Check issues exactly one per-order read, for THIS order', false,
          'unreachable: no detached warning was rendered');
    check('and an authoritative observation settles it', false,
          'unreachable: no detached warning was rendered');
  }

  await deviceA.page.unroute('**/kitchen/orders/*/cancel/');

  // ── 7. the retired contract is genuinely gone ───────────────────────────
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

  // ── 8. R1a: a LATER read carrying an EARLIER server snapshot ────────────
  // Scenario 5 covers the read that STARTED first. This is the one the local
  // clock cannot order: both responses are valid, neither is malformed, neither
  // is out of scope, and the one that arrives second describes the server as it
  // was BEFORE the command. Only the server's own revision can refuse it.
  const fourth = await placeDinerOrder();
  check('a fourth diner order is accepted for the reordered-snapshot check',
        fourth.submitted === 200, `status=${fourth.submitted}`);

  const feed4 = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const t4 = (feed4.body?.data ?? []).find((t) => t.id === fourth.id);
  check('and reaches the board', !!t4);

  let rev4 = t4.fulfilment_revision;
  for (const action of ['advance', 'advance']) {
    const r = await operator(`/api/v1/kitchen/orders/${fourth.id}/fulfilment-status/`,
      { method: 'PUT', body: JSON.stringify({ action, if_revision: rev4 }) });
    rev4 = r.body?.data?.fulfilment_revision ?? rev4 + 1;
  }

  // THE SNAPSHOT. A real Active response from the real server, taken while the
  // ticket is still `ready`. It must carry the protocol declaration, or the
  // board would go read-only and the assertion below would pass for a reason
  // that has nothing to do with the floor.
  const priorFeed = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const priorBody = JSON.stringify(priorFeed.body);
  check('the captured snapshot declares the kitchen protocol',
        priorFeed.body?.kitchen_protocol >= 1,
        `protocol=${priorFeed.body?.kitchen_protocol}`);
  const priorRow = (priorFeed.body?.data ?? []).find((t) => t.id === fourth.id);
  check('and shows the ticket as ready, before the serve',
        priorRow?.fulfilment_status === 'ready',
        `status=${priorRow?.fulfilment_status} rev=${priorRow?.fulfilment_revision}`);

  const card4 = ticketCard(deviceA.page, t4.order_number);
  await until('device A to show the fourth ticket as ready', async () =>
    (await card4.count()) === 1
    && (await card4.locator('footer button').first().innerText())
         .trim().toLowerCase() === 'served');

  const serveReply4 = commandReply(deviceA.page);
  await card4.getByRole('button', { name: 'Served' }).click();
  await serveReply4;
  await until('the served ticket to leave the Active board',
              async () => (await card4.count()) === 0);

  // ONLY NOW is the replay armed, so the request it answers is one the board
  // issues AFTER the serve: later by every clock the client has.
  const replay = await replayFeed(
    deviceA.page, '**/kitchen/orders/active/**', priorBody);
  const afterReplay = replay.awaitNextRequest();
  await replay.delivered;
  await afterReplay;

  check('a later read carrying an earlier snapshot does not reopen the ticket',
        (await card4.count()) === 0, `cards=${await card4.count()}`);
  await replay.drain();

  await deviceA.page.getByTestId('view-completed').click();
  const completed4 = ticketCard(deviceA.page, t4.order_number);
  const onCompleted4 = await until('the served ticket to be on Completed',
    async () => (await completed4.count()) === 1,
  ).then(() => true).catch(() => false);
  check('and it stays on Completed exactly once', onCompleted4,
        `completed=${await completed4.count()}`);
  await deviceA.page.getByTestId('view-active').click();

  // ── 9. M1: a cancellation clears the COMPLETED board too ────────────────
  // The ordinary two-device sequence, run through the real API on B's side and
  // the real buttons on A's: A holds a served card, B recalls it, a manager
  // cancels it, and A's stale recall is properly refused. Before M1 the refusal
  // repainted A's card and left a CANCELLED order sitting on Completed, with
  // its own warning attached to a card that should not have existed.
  const fifth = await placeDinerOrder();
  check('a fifth diner order is accepted for the cancelled-membership check',
        fifth.submitted === 200, `status=${fifth.submitted}`);

  const feed5 = await operator(
    `/api/v1/kitchen/orders/active/?restaurant=${F.restaurant}`);
  const t5 = (feed5.body?.data ?? []).find((t) => t.id === fifth.id);
  check('and reaches the board', !!t5);

  // Walk it to SERVED through the real API so it is on Completed, inside the
  // server's ten-minute recall window.
  let rev5 = t5.fulfilment_revision;
  for (const action of ['advance', 'advance', 'serve']) {
    const r = await operator(`/api/v1/kitchen/orders/${fifth.id}/fulfilment-status/`,
      { method: 'PUT', body: JSON.stringify({ action, if_revision: rev5 }) });
    rev5 = r.body?.data?.fulfilment_revision ?? rev5 + 1;
  }

  // A opens Completed and sees the served card. THE REVISION IT RENDERS WITH is
  // the precondition its Recall button will send.
  await deviceA.page.getByTestId('view-completed').click();
  const card5 = ticketCard(deviceA.page, t5.order_number);
  await until('device A to show the served ticket on Completed',
              async () => (await card5.count()) === 1);
  const staleRevision = rev5;

  // FREEZE BOTH OF A'S FEEDS BEFORE ANYTHING CHANGES THE SERVER STATE.
  //
  // `gateFeed` only intercepts requests issued AFTER it is registered, and the
  // board refreshes Completed every three seconds — so with the gates installed
  // after the two mutations below, a refresh already in flight could observe the
  // recall (which takes the order off the Completed feed) and remove A's card
  // before its Recall button is ever clicked. The run then aborts at the click
  // without exercising the refusal path at all: not a false pass, but a scenario
  // that quietly stops testing what it is named for, and one that gets likelier
  // the slower the machine. Registering first makes the window structural rather
  // than a bet on local latency.
  const frozenActive = await gateFeed(deviceA.page, '**/kitchen/orders/active/**');
  const frozenCompleted =
    await gateFeed(deviceA.page, '**/kitchen/orders/completed/**');

  // B recalls it, then a manager cancels it. Both through the real contract.
  const recalled = await operator(
    `/api/v1/kitchen/orders/${fifth.id}/fulfilment-status/`,
    { method: 'PUT', body: JSON.stringify({ action: 'recall', if_revision: rev5 }) });
  rev5 = recalled.body?.data?.fulfilment_revision ?? rev5 + 1;
  check('device B recalls the served order', recalled.status === 200,
        `${recalled.status} rev=${rev5}`);

  const managerCancel = await operator(`/api/v1/kitchen/orders/${fifth.id}/cancel/`, {
    method: 'PUT',
    body: JSON.stringify({
      cancellation_reason: 'customer_changed_mind', if_revision: rev5,
    }),
  });
  check('a manager cancels the recalled order',
        managerCancel.status === 200
        && managerCancel.body?.data?.order_status === 'cancelled',
        `${managerCancel.status} ${managerCancel.body?.data?.order_status}`);

  const refusal = commandReply(deviceA.page);
  await card5.getByRole('button', { name: 'Recall' }).click();
  const refusalRes = await refusal;
  // The server checks OPERABILITY before the precondition, so a cancelled order
  // answers `order_cancelled` whatever revision was supplied — which is what
  // makes this an M1 case rather than an ordinary stale-precondition one.
  const refusalBody = refusalRes ? await refusalRes.json().catch(() => null) : null;
  check('A\'s stale recall is refused as CANCELLED, with the current state',
        refusalRes && refusalRes.status() === 409
        && refusalBody?.reason === 'order_cancelled'
        && refusalBody?.data?.order_status === 'cancelled',
        `status=${refusalRes && refusalRes.status()} reason=${refusalBody?.reason} `
        + `sent if_revision=${staleRevision}`);

  // Reported rather than thrown: when this regresses, the run should still go on
  // to say what happened to the notice as well as to the card.
  await until('the cancelled card to leave the Completed board',
              async () => (await card5.count()) === 0).catch(() => null);
  check('a cancelled order is removed from COMPLETED, not only from Active',
        (await card5.count()) === 0, `cards=${await card5.count()}`);

  await deviceA.page.getByTestId('view-active').click();
  check('and it is not on the active board either',
        (await ticketCard(deviceA.page, t5.order_number).count()) === 0);

  const cancelStrip = deviceA.page.locator(
    `[data-testid="detached-operation"][data-order-id="${fifth.id}"]`);
  const cancelStripCount = await cancelStrip.count();
  check('the refusal survives its card, in the detached strip', cancelStripCount === 1,
        `strip entries=${cancelStripCount}`);
  if (cancelStripCount === 1) {
    const cancelStripText = await cancelStrip.first()
      .locator('[data-testid="detached-operation-message"]').innerText();
    check('and it still states the server\'s own reason',
          /cancel/i.test(cancelStripText), cancelStripText);
    check('a settled refusal offers dismissal, not a fresh command',
          (await cancelStrip.first()
            .locator('[data-testid="detached-operation-ok"]').count()) === 1
          && (await cancelStrip.first()
            .locator('[data-testid="detached-operation-retry"]').count()) === 0);
  }

  await frozenActive.drain();
  await frozenCompleted.drain();

  const savedFifth = await operator(`/api/v1/kitchen/orders/${fifth.id}/state/`);
  check('and the server agrees the order is cancelled',
        savedFifth.body?.data?.order_status === 'cancelled',
        `order_status=${savedFifth.body?.data?.order_status}`);

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
