/**
 * SERVED REGRESSION PROBES for the two findings no journey replays: D01 and D07.
 *
 * Each probe is issued through the channel a real caller uses — the diner
 * capability channel for D01, the operator API for D07 — names the finding it
 * replays, and asserts the EXACT refusal (status, machine reason or message, and
 * the field it is about), never merely "not 200". Each also READS BACK that the
 * refusal left nothing behind.
 *
 * THE TWO READ-BACKS ARE NOT EQUALLY STRONG, and that is stated rather than
 * hidden. D01's has a POSITIVE CONTROL — a valid draft the same read does find —
 * so it cannot pass by being unable to see anything. D07's cannot have one: no
 * API on this platform creates a transaction row any more (that is the finding),
 * so its sensitivity rests on the listing's source (`reports_app` transactions
 * listing filters by restaurant and date only, so a Pending row of any type is
 * counted) rather than on an observation. Its CONTROL is about the refusal
 * instead: a missing and a foreign restaurant are 404 at the gate, so the 501 is
 * not an endpoint that refuses everything.
 *
 * What they write: ONE draft order per run, the D01 positive control that proves
 * the intent read-back can see a draft at all. A draft never occupies a table
 * and never reaches the kitchen. Nothing else is created.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { InterlockError, assertTestRestaurant, mask, request } from './lib.mjs';

const LIMITS = JSON.parse(readFileSync(fileURLToPath(
  new URL('../../src/app/_shared/order/checkout-limits.contract.json', import.meta.url)), 'utf8'));

/** `order_input.QUANTITY_MESSAGE`, built from the backend-authored ceiling. */
export const D01_QUANTITY_MESSAGE =
  `Each item needs a whole quantity between 1 and ${LIMITS.MAX_QUANTITY_PER_LINE}.`;
/** `order_input.INVALID_REQUEST_MESSAGE` — the root-must-be-a-mapping refusal. */
export const D01_INVALID_REQUEST_MESSAGE = 'The order request is not valid. Please try again.';
/** `finance_app/subscription_capability.py`, verbatim — the same constants billing.mjs asserts. */
export const D07_STATUS = 501;
export const D07_REASON = 'subscription_collection_unavailable';
export const D07_MESSAGE = 'In-app subscription payment collection is not available. '
  + 'This request did not create or send a payment request.';

const exactKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());

/**
 * One run of both probes. `check(name, ok, detail)` is the orchestrator's recorder.
 *
 * THE PROBES INTERLOCK THEMSELVES. Before their first request they require the
 * fixture to name the configured restaurant and the server to report its id,
 * name and `is_test` as configured, and they throw otherwise. Being called
 * after provisioning is not relied on.
 */
export async function runProbes({ api, token, fixture, check, restaurantId, restaurantName }) {
  if (fixture?.restaurant !== restaurantId) {
    throw new InterlockError('the probe fixture names a different restaurant from JOURNEY_RESTAURANT_ID');
  }
  await assertTestRestaurant({ api, token, restaurantId, restaurantName });
  const table = fixture.tables[901];

  // ── D01 — customer-supplied order input ───────────────────────────────────
  const scan = await request(api, '/api/v1/orders/journey/table-scan/', {
    headers: { 'X-Diner-Credential': table.credential },
  });
  const session = scan.body?.data?.session_token;
  mask(session);
  check('D01: the probe holds a real diner table session', scan.status === 200 && typeof session === 'string',
    `table-scan ${scan.status}`);
  const diner = { 'X-Diner-Session': session };
  const line = (quantity) => ({
    item: fixture.burger, quantity, selected_modifiers: { 'g-size': ['c-large'] },
  });
  const initiate = (body) => request(api, '/api/v2/orders/initiate/', { method: 'POST', body, headers: diner });
  const byIntent = (key) => request(api, `/api/v1/orders/journey/order-details/?intent=${key}`, { headers: diner });

  // POSITIVE CONTROL for the read-back: a valid line creates a draft, and the
  // intent read finds it. Without this, a read-back that can see nothing would
  // make every "no draft" assertion below pass.
  const controlKey = randomUUID();
  const control = await initiate({ items: [line(1)], client_order_id: controlKey });
  const controlId = control.body?.data?.order_details?.id;
  const controlRead = await byIntent(controlKey);
  check('D01 CONTROL: a valid quantity creates a draft, and the intent read-back finds it',
    control.status === 200 && typeof controlId === 'string'
      && controlRead.status === 200 && controlRead.body?.data?.id === controlId
      && controlRead.body?.data?.order_status === 'initiated',
    `initiate ${control.status}, read-back ${controlRead.status}`);

  // The five quantities the finding named. Each persisted at HTTP 200 before D01
  // (0 and -3) or raised a 500 out of Decimal arithmetic (2.5, true, "3").
  for (const [label, quantity] of [['0', 0], ['-3', -3], ['2.5', 2.5], ['true', true], ['"3"', '3']]) {
    const key = randomUUID();
    const r = await initiate({ items: [line(quantity)], client_order_id: key });
    const errors = r.body?.errors;
    check(`D01: quantity ${label} is refused 400 with the quantity rule`,
      r.status === 400 && r.body?.status === 400 && r.body?.message === D01_QUANTITY_MESSAGE
        && exactKeys(errors, ['items.0.quantity'])
        && JSON.stringify(errors['items.0.quantity']) === JSON.stringify([D01_QUANTITY_MESSAGE]),
      `${r.status} ${JSON.stringify(r.body?.message)} ${JSON.stringify(Object.keys(errors || {}))}`);
    const back = await byIntent(key);
    check(`D01: quantity ${label} left no draft under its intent key`, back.status === 404,
      `read-back ${back.status}`);
  }

  // A NON-OBJECT BODY. It still CARRIES an intent key — inside the array — so
  // the read-back asks about an order the server could have made had it read it.
  const arrayKey = randomUUID();
  const arr = await initiate([{ items: [line(1)], client_order_id: arrayKey }]);
  check('D01: a non-object body is refused 400 before anything reads it',
    arr.status === 400 && exactKeys(arr.body, ['status', 'message'])
      && arr.body.status === 400 && arr.body.message === D01_INVALID_REQUEST_MESSAGE,
    `${arr.status} ${JSON.stringify(arr.body)}`);
  const arrBack = await byIntent(arrayKey);
  check('D01: the non-object body left no draft under the key it carried', arrBack.status === 404,
    `read-back ${arrBack.status}`);

  // ── D07 — a payment interface never claims work no provider performed ─────
  //
  // The witness is the restaurant's own transaction listing, unfiltered by type
  // or status, over the three days around now — so a Pending row of any type
  // would be counted. It is read before and after all three attempts.
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const witness = async () => {
    const r = await request(api,
      `/api/v1/reports/restaurant/transactions-listing/?restaurant=${fixture.restaurant}&from=${day(-1)}&to=${day(1)}`,
      { token });
    return r.status === 200 && Array.isArray(r.body?.data) ? r.body.data.length : null;
  };
  const before = await witness();
  check('D07: the transaction-row witness is readable before the probe', typeof before === 'number',
    `before=${before}`);

  // THE RETIRED COLLECTOR'S OWN REQUEST (billing.mjs → retiredCollectorBody). The
  // key is `restaurant_id`; a probe sending anything else is refused 404 by the
  // authorization gate and never reaches the collector. The MSISDN is a fixed
  // placeholder no account holds; nothing is sent to it.
  const collector = (restaurantId) => ({
    transaction_type: 'subscription', transaction_platform: 'web', payment_mode: 'momo',
    ...(restaurantId === undefined ? {} : { restaurant_id: restaurantId }),
    msisdn: '256700000000', otp: '1234',
  });
  const collect = (body) => request(api, '/api/v1/finances/transactions/', { method: 'POST', body, token });

  const refused = await collect(collector(fixture.restaurant));
  check('D07: the online-payment initiation answers 501 with the machine reason',
    refused.status === D07_STATUS && refused.body?.status === D07_STATUS
      && refused.body?.reason === D07_REASON,
    `${refused.status} ${JSON.stringify(refused.body?.reason)}`);
  check('D07: ...and the sentence about THIS request',
    refused.body?.message === D07_MESSAGE, JSON.stringify(refused.body?.message));

  // CONTROLS: the 501 is not "this endpoint always says no". A missing and a
  // foreign restaurant are refused by the authorization gate, as a 404.
  const missing = await collect(collector(undefined));
  const foreign = await collect(collector('11111111-1111-4111-8111-111111111111'));
  check('D07 CONTROL: a missing or foreign restaurant is 404 at the gate, not 501',
    missing.status === 404 && foreign.status === 404, `${missing.status}/${foreign.status}`);

  const after = await witness();
  check('D07: no transaction row (no pending intent) was created by any of the three attempts',
    typeof after === 'number' && after === before, `before=${before} after=${after}`);

  return { draftsCreated: control.status === 200 ? 1 : 0 };
}
