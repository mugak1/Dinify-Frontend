/**
 * PROVISION THE JOURNEY FIXTURE THROUGH THE REAL OPERATOR API — and nothing else.
 *
 * What `checkout-journey/seed.py` writes through the Django ORM, this writes as
 * the restaurant's owner would: `restaurant-setup/` creates and edits, the
 * kitchen's own commands, the tables list for the QR credential. It never
 * touches a database, a shell or a management command, which is what lets it
 * run against the stack that actually serves.
 *
 * It works on ONE restaurant, the one the operator configured, and refuses to
 * write anything unless the server reports that restaurant's id, name and
 * `is_test` as configured (lib.mjs → assertTestRestaurant). It is IDEMPOTENT:
 * everything is found by name or number before anything is created, and a
 * second run creates nothing. `reset` puts the canonical state back, closes out
 * any submitted order still on the board, and VERIFIES the result by reading it
 * back — which is what the orchestrator calls between journeys.
 *
 * It does not create the restaurant or its owner. That is a one-time owner
 * action on the Admin plane; see README.md.
 *
 * CLI (the orchestrator imports the functions instead):
 *   JOURNEY_API=... JOURNEY_RESTAURANT_ID=... JOURNEY_RESTAURANT_NAME=... \
 *   JOURNEY_TOKEN_FILE=<file holding an operator access token> \
 *   node e2e/served/provision.mjs [--reset] --out <fixture.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  AREA_NAME, CANONICAL_ITEMS, CHECKOUT_TABLE, KITCHEN_TABLES, SECTION_NAME,
  assertTestRestaurant, mask, request,
} from './lib.mjs';

export class ProvisionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const fail = (code, message) => { throw new ProvisionError(code, message); };

/** Every page of a paginated restaurant-setup list. */
async function listAll(ctx, resource, extra = '') {
  const out = [];
  for (let page = 1; page <= 50; page += 1) {
    const r = await request(ctx.api,
      `/api/v1/restaurant-setup/${resource}/?restaurant=${ctx.restaurant}&page=${page}${extra}`,
      { token: ctx.token });
    if (r.status !== 200) fail('list_failed', `listing ${resource} answered ${r.status}`);
    const data = r.body?.data;
    const records = Array.isArray(data) ? data : data?.records;
    if (!Array.isArray(records)) fail('list_unreadable', `listing ${resource} carried no records`);
    out.push(...records);
    if (Array.isArray(data) || !data?.pagination?.has_next) return out;
  }
  fail('list_unbounded', `listing ${resource} did not end within 50 pages`);
}

const live = (rows) => rows.filter((r) => r.deleted !== true);

/** JSON with object keys sorted at every level. */
const sortedJson = (v) => JSON.stringify(v, (_k, x) => (
  x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** Exactly one live row matching `pred`, or none; two is a refusal, never a pick. */
function one(rows, pred, what) {
  const found = live(rows).filter(pred);
  if (found.length > 1) fail('ambiguous', `${found.length} live ${what} match; resolve by hand before a run`);
  return found[0] ?? null;
}

async function write(ctx, method, resource, body, what) {
  const r = await request(ctx.api, `/api/v1/restaurant-setup/${resource}/`, { method, body, token: ctx.token });
  const unchanged = method === 'PUT' && /no changes/i.test(r.body?.message || '');
  if (r.status !== 200 && !unchanged) {
    fail('write_failed', `${what}: ${method} ${resource} answered ${r.status} ${String(r.body?.message || '').slice(0, 160)}`);
  }
  return r.body?.data ?? null;
}

// ── the parts ────────────────────────────────────────────────────────────────

async function ensureArea(ctx) {
  let area = one(await listAll(ctx, 'diningareas'), (a) => a.name === AREA_NAME, 'dining areas');
  if (!area) {
    // The two flags are sent explicitly, as the portal does: `create_dining_area`
    // passes them straight to non-null columns.
    await write(ctx, 'POST', 'diningareas', {
      restaurant: ctx.restaurant, name: AREA_NAME, smoking_zone: false, outdoor_seating: false,
    }, 'dining area');
    area = one(await listAll(ctx, 'diningareas'), (a) => a.name === AREA_NAME, 'dining areas');
    if (!area) fail('create_unverified', 'the dining area was not readable after it was created');
    ctx.created.push(`dining area "${AREA_NAME}"`);
  }
  return area.id;
}

async function ensureSection(ctx) {
  let section = one(await listAll(ctx, 'menusections'), (s) => s.name === SECTION_NAME, 'menu sections');
  if (!section) {
    await write(ctx, 'POST', 'menusections', { restaurant: ctx.restaurant, name: SECTION_NAME }, 'menu section');
    section = one(await listAll(ctx, 'menusections'), (s) => s.name === SECTION_NAME, 'menu sections');
    if (!section) fail('create_unverified', 'the menu section was not readable after it was created');
    ctx.created.push(`menu section "${SECTION_NAME}"`);
  }
  if (section.available !== true) {
    await write(ctx, 'PUT', 'menusections', { id: section.id, available: true }, 'menu section availability');
  }
  return section.id;
}

/** The canonical body of one item — what every reset writes. */
function itemBody(key, ids) {
  const c = CANONICAL_ITEMS[key];
  const body = {
    primary_price: c.primary_price, available: true, in_stock: true,
    is_extra: c.is_extra, has_extras: c.has_extras,
    running_discount: false,
  };
  if (c.options) body.options = JSON.stringify(c.options);
  if (key === 'burger') {
    body.extras_applicable = [ids.cheese];
    body.extras_min_selections = c.extras_min_selections;
    body.extras_max_selections = c.extras_max_selections;
  } else if (key === 'rounding') {
    body.extras_applicable = [];
    body.extras_min_selections = 0;
    body.extras_max_selections = 0;
  }
  return body;
}

async function ensureItems(ctx, sectionId) {
  const ids = {};
  for (const key of ['cheese', 'burger', 'rounding']) {   // the extra first: the burger names it
    const name = CANONICAL_ITEMS[key].name;
    const find = async () => one(await listAll(ctx, 'menuitems'), (i) => i.name === name, `menu items named "${name}"`);
    let item = await find();
    if (!item) {
      await write(ctx, 'POST', 'menuitems', {
        section: sectionId, name, ...itemBody(key, ids),
      }, `menu item "${name}"`);
      item = await find();
      if (!item) fail('create_unverified', `"${name}" was not readable after it was created`);
      ctx.created.push(`menu item "${name}"`);
    }
    ids[key] = item.id;
  }
  return ids;
}

/** Write the canonical state of every item, then read it back and compare. */
async function resetItems(ctx, ids) {
  for (const key of ['cheese', 'burger', 'rounding']) {
    await write(ctx, 'PUT', 'menuitems', { id: ids[key], ...itemBody(key, ids) }, `reset "${CANONICAL_ITEMS[key].name}"`);
  }
  // READ BACK through each item's own detail read, which carries every field the
  // list projection omits (`extras_applicable` among them).
  const problems = [];
  for (const key of ['cheese', 'burger', 'rounding']) {
    const c = CANONICAL_ITEMS[key];
    const r = await request(ctx.api, `/api/v1/restaurant-setup/details/?record=menuitems&id=${ids[key]}`, { token: ctx.token });
    const row = r.status === 200 ? r.body?.data : null;
    if (!row || row.deleted === true || row.name !== c.name) { problems.push(`${c.name} missing`); continue; }
    if (Number(row.primary_price).toFixed(2) !== c.primary_price) problems.push(`${c.name} price ${row.primary_price}`);
    if (row.in_stock !== true || row.available !== true) problems.push(`${c.name} not orderable`);
    if (row.is_extra !== c.is_extra) problems.push(`${c.name} is_extra`);
    if (c.options) {
      // PostgreSQL JSONB does not keep key order, so the comparison does not either.
      const stored = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
      if (sortedJson(stored) !== sortedJson(c.options)) problems.push(`${c.name} options`);
    }
    if (row.running_discount === true) problems.push(`${c.name} carries a running discount`);
    if (key === 'burger') {
      const ext = Array.isArray(row.extras_applicable) ? row.extras_applicable : [];
      if (ext.length !== 1 || ext[0] !== ids.cheese) problems.push('burger extras');
    }
  }
  if (problems.length) fail('reset_unverified', `the catalogue is not canonical after reset: ${problems.join('; ')}`);
}

async function ensureTables(ctx, areaId) {
  const pool = [CHECKOUT_TABLE, ...KITCHEN_TABLES];
  let rows = await listAll(ctx, 'tables');
  for (const t of pool) {
    let row = one(rows, (r) => String(r.number) === String(t.number), `tables numbered ${t.number}`);
    if (!row) {
      await write(ctx, 'POST', 'tables', {
        restaurant: ctx.restaurant, number: t.number, dining_area: areaId,
        display_name: t.label, has_qr: true, enabled: true,
      }, `table ${t.number}`);
      ctx.created.push(`table ${t.number} "${t.label}"`);
      rows = await listAll(ctx, 'tables');
      row = one(rows, (r) => String(r.number) === String(t.number), `tables numbered ${t.number}`);
      if (!row) fail('create_unverified', `table ${t.number} was not readable after it was created`);
    }
    const patch = {};
    if (row.display_name !== t.label) patch.display_name = t.label;
    if (row.has_qr !== true) patch.has_qr = true;
    if (row.enabled !== true) patch.enabled = true;
    if (row.is_active !== true) patch.is_active = true;
    if (row.qr_mode === 'menu_only') patch.qr_mode = 'order_only';
    if (Object.keys(patch).length) {
      await write(ctx, 'PUT', 'tables', { id: row.id, ...patch }, `table ${t.number}`);
    }
    if (row.status === 'out_of_service') {
      const r = await request(ctx.api, '/api/v1/restaurant-setup/table-actions/update-status/', {
        method: 'POST', body: { table_id: row.id, status: 'available' }, token: ctx.token,
      });
      if (r.status !== 200) fail('write_failed', `table ${t.number} could not be put back in service (${r.status})`);
    }
  }
  // Read back, and take each table's CURRENT credential from the owner's own
  // management read — the credential is minted per read, never stored.
  rows = live(await listAll(ctx, 'tables'));
  const out = {};
  for (const t of pool) {
    const row = rows.find((r) => String(r.number) === String(t.number));
    if (!row || row.display_name !== t.label || row.has_qr !== true || row.enabled !== true) {
      fail('table_unverified', `table ${t.number} is not usable after provisioning`);
    }
    if (typeof row.qr_credential !== 'string' || row.qr_credential.length < 20) {
      fail('credential_withheld', `no QR credential was disclosed for table ${t.number} (is this an ordinary, non-delegated owner session?)`);
    }
    mask(row.qr_credential);
    out[t.number] = { id: row.id, label: t.label, number: t.number, credential: row.qr_credential };
  }
  return out;
}

async function ensureAcceptingOrders(ctx, current) {
  if (current !== true) {
    await write(ctx, 'PUT', 'restaurants', { id: ctx.restaurant, accepting_orders: true }, 'accepting_orders');
  }
}

const NEXT = { new: 'advance', preparing: 'advance', ready: 'serve' };

/**
 * CLOSE OUT every submitted order still on the Active board, through the
 * kitchen's own commands — the way a restaurant frees a table. Drafts never
 * occupy a table, so nothing else is needed for the next run to start clean.
 * Bounded: it walks each ticket by its CURRENT state, at most three steps.
 */
export async function closeOutBoard(ctx) {
  const active = async () => {
    const r = await request(ctx.api, `/api/v1/kitchen/orders/active/?restaurant=${ctx.restaurant}`, { token: ctx.token });
    if (r.status !== 200 || !Array.isArray(r.body?.data)) fail('board_unreadable', `the active board answered ${r.status}`);
    return r.body.data;
  };
  let closed = 0;
  for (const t of await active()) {
    let at = t.fulfilment_status;
    let rev = t.fulfilment_revision;
    for (let step = 0; step < 3 && NEXT[at]; step += 1) {
      const r = await request(ctx.api, `/api/v1/kitchen/orders/${t.id}/fulfilment-status/`, {
        method: 'PUT', body: { action: NEXT[at], if_revision: rev }, token: ctx.token,
      });
      if (r.status !== 200) break;
      at = r.body?.data?.fulfilment_status;
      rev = r.body?.data?.fulfilment_revision;
    }
    closed += 1;
  }
  const left = await active();
  if (left.length) fail('board_not_clear', `${left.length} submitted order(s) are still on the active board`);
  return closed;
}

/**
 * The kitchen journey's table: one with NO ticket on either board, so the
 * cards it finds by number and label can only be its own.
 */
async function chooseKitchenTable(ctx, tables) {
  const labels = new Set();
  for (const feed of ['active', 'completed']) {
    const r = await request(ctx.api, `/api/v1/kitchen/orders/${feed}/?restaurant=${ctx.restaurant}`, { token: ctx.token });
    if (r.status !== 200 || !Array.isArray(r.body?.data)) fail('board_unreadable', `the ${feed} board answered ${r.status}`);
    for (const t of r.body.data) labels.add(t.table_label);
  }
  const free = KITCHEN_TABLES.find((t) => !labels.has(t.label));
  if (!free) {
    fail('kitchen_pool_exhausted', 'every kitchen pool table has a ticket on the Completed board (served within 24 h); '
      + 'wait for the window to pass rather than reusing one');
  }
  return tables[free.number];
}

/** What the billing journey reads as its "unconfigured" restaurant, off the wire. */
async function billingPremise(ctx) {
  const r = await request(ctx.api, `/api/v1/restaurant-setup/subscription-details/?restaurant=${ctx.restaurant}`, { token: ctx.token });
  if (r.status !== 200) fail('billing_unreadable', `subscription-details answered ${r.status}`);
  const d = r.body?.data ?? {};
  const terms = d.subscription_terms;
  if (!terms || terms.recorded !== false || terms.current !== null) {
    fail('billing_premise', 'the test restaurant has recorded subscription terms; the billing journey needs none');
  }
  return { legacy_validity: d.subscription_validity === true };
}

// ── the entry points ─────────────────────────────────────────────────────────

/**
 * Refuse unless the interlock passes, the restaurant is LIVE, and the session's
 * own membership there can run the kitchen and the settings writes.
 */
async function preconditions(ctx) {
  const facts = await assertTestRestaurant({
    api: ctx.api, token: ctx.token, restaurantId: ctx.restaurant, restaurantName: ctx.restaurantName,
  });
  if (facts.status !== 'live') {
    fail('not_live', `the restaurant's lifecycle state is "${facts.status}", and diner ordering needs "live". `
      + 'An Admin-created restaurant starts "onboarding" and cannot reach "live" while '
      + 'check_go_live_readiness fails closed — see e2e/served/README.md, "An Admin-created restaurant cannot be used yet".');
  }
  const profile = await request(ctx.api, '/api/v1/users/user-profile/', { token: ctx.token });
  const roles = (profile.body?.data?.profile?.restaurant_roles ?? [])
    .find((m) => m.restaurant_id === ctx.restaurant)?.roles ?? [];
  if (!roles.includes('owner') && !roles.includes('manager')) {
    fail('not_manager', 'the operator holds no owner or manager membership at the test restaurant');
  }
  return facts;
}

/**
 * The whole fixture: ensure, reset, close out, choose. `full` on the first call
 * of a run; the orchestrator then calls `resetBetweenJourneys` before each one.
 */
export async function provision({ api, token, restaurantId, restaurantName }) {
  const ctx = { api, token, restaurant: restaurantId, restaurantName, created: [] };
  const facts = await preconditions(ctx);
  const areaId = await ensureArea(ctx);
  const sectionId = await ensureSection(ctx);
  const ids = await ensureItems(ctx, sectionId);
  await resetItems(ctx, ids);
  await ensureAcceptingOrders(ctx, facts.accepting_orders);
  const tables = await ensureTables(ctx, areaId);
  const closed = await closeOutBoard(ctx);
  const billing = await billingPremise(ctx);
  return {
    target: 'served',
    restaurant: restaurantId,
    burger: ids.burger, cheese: ids.cheese, rounding: ids.rounding,
    tables, billing,
    report: { created: ctx.created, closed_out: closed },
  };
}

/** Between journeys: the canonical catalogue, trading on, a clear board — verified. */
export async function resetBetweenJourneys({ api, token, restaurantId, restaurantName, fixture }) {
  const ctx = { api, token, restaurant: restaurantId, restaurantName, created: [] };
  await assertTestRestaurant({ api, token, restaurantId, restaurantName });
  await resetItems(ctx, { burger: fixture.burger, cheese: fixture.cheese, rounding: fixture.rounding });
  await ensureAcceptingOrders(ctx, false);
  const details = await request(api, `/api/v1/restaurant-setup/details/?record=restaurants&id=${restaurantId}`, { token });
  if (details.body?.data?.accepting_orders !== true) fail('reset_unverified', 'accepting_orders is not true after reset');
  return { closed_out: await closeOutBoard(ctx) };
}

/** The kitchen journey's table, chosen at the moment it starts. */
export async function kitchenTable({ api, token, restaurantId, fixture }) {
  return chooseKitchenTable({ api, token, restaurant: restaurantId }, fixture.tables);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const out = args[args.indexOf('--out') + 1];
  const token = readFileSync(process.env.JOURNEY_TOKEN_FILE, 'utf8').trim();
  mask(token);
  const base = {
    api: process.env.JOURNEY_API, token,
    restaurantId: process.env.JOURNEY_RESTAURANT_ID, restaurantName: process.env.JOURNEY_RESTAURANT_NAME,
  };
  const run = args.includes('--reset')
    ? resetBetweenJourneys({ ...base, fixture: JSON.parse(readFileSync(out, 'utf8')) })
    : provision(base).then((f) => { writeFileSync(out, JSON.stringify(f), { mode: 0o600 }); return f.report; });
  run.then((report) => { console.log(`provisioned: ${JSON.stringify(report)}`); })
    .catch((e) => { console.error(`PROVISION REFUSED (${e.code || e.name}): ${e.message}`); process.exit(2); });
}
