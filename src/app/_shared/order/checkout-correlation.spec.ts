import {
  CHECKOUT_PROTOCOL_CORRELATED, correlationMatches, protocolLevel,
  readCorrelation,
} from './checkout-correlation';

/**
 * D04 — reading the server's correlated checkout answer.
 *
 * These are about ONE question: may this client believe what the payload
 * says, and is it about the command this client issued? The three-state
 * verdict, the protocol gate and the correlation check each answer part of
 * it, and getting any of them wrong announces somebody else's order — or
 * invites a diner to re-place one already in the kitchen.
 */
describe('checkout correlation', () => {
  const SCOPE = { restaurant: 'r1', table: 't1' };

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      checkout: {
        order_id: 'o1',
        intent_key: 'k1',
        scope: SCOPE,
        acceptance: {
          state: 'accepted',
          outcome: 'newly_accepted',
          quote_ref: 'qref-original',
          accepted_at: '2026-09-12T10:00:00+00:00',
        },
        current: {
          order_status: 'pending', fulfilment_status: 'new',
          cancelled_at: null, served_at: null,
        },
        checkout_protocol: 3,
        ...overrides,
      },
    };
  }

  describe('the protocol gate', () => {
    it('reads the level a payload states', () => {
      expect(protocolLevel({ checkout_protocol: 3 })).toBe(3);
      expect(protocolLevel({ checkout_protocol: 2 })).toBe(2);
    });

    it('treats an ABSENT level as 0 — promise nothing', () => {
      // A baseline assumed rather than stated is how a client ends up
      // relying on a capability the server it is talking to does not have.
      expect(protocolLevel({})).toBe(0);
      expect(protocolLevel(null)).toBe(0);
      expect(protocolLevel(undefined)).toBe(0);
    });

    it('treats an incoherent level as 0', () => {
      for (const value of ['3', 3.5, -1, 0, true, {}, []]) {
        expect(protocolLevel({ checkout_protocol: value }))
          .withContext(JSON.stringify(value)).toBe(0);
      }
    });
  });

  describe('reading the projection', () => {
    it('reads every field a level-3 payload states', () => {
      const correlation = readCorrelation(payload())!;
      expect(correlation.orderId).toBe('o1');
      expect(correlation.intentKey).toBe('k1');
      expect(correlation.scope).toEqual({ restaurant: 'r1', table: 't1' });
      expect(correlation.acceptance.state).toBe('accepted');
      expect(correlation.acceptance.outcome).toBe('newly_accepted');
      expect(correlation.acceptance.quoteRef).toBe('qref-original');
      expect(correlation.acceptance.acceptedAt)
        .toBe('2026-09-12T10:00:00+00:00');
      expect(correlation.current.orderStatus).toBe('pending');
      expect(correlation.protocol).toBe(CHECKOUT_PROTOCOL_CORRELATED);
    });

    it('carries all three acceptance states', () => {
      for (const state of
        ['accepted', 'not_accepted', 'evidence_unavailable']) {
        const read = readCorrelation(
          payload({ acceptance: { state, outcome: null } }))!;
        expect(read.acceptance.state).withContext(state).toBe(state as any);
      }
    });

    it('accepts a null outcome — a READ is not an acceptance attempt', () => {
      const read = readCorrelation(
        payload({ acceptance: { state: 'accepted', outcome: null } }))!;
      expect(read.acceptance.outcome).toBeNull();
    });

    it('REFUSES a payload below the correlated level', () => {
      // THE GATE. A level-2 server answers every request this client makes;
      // it simply cannot separate a draft from an acceptance it has no
      // record of. Reading a projection off one would be reading a promise
      // it never made.
      expect(readCorrelation(payload({ checkout_protocol: 2 }))).toBeNull();
      expect(readCorrelation(payload({ checkout_protocol: undefined })))
        .toBeNull();
    });

    it('refuses a malformed or absent projection rather than guessing', () => {
      expect(readCorrelation(null)).toBeNull();
      expect(readCorrelation({})).toBeNull();
      expect(readCorrelation({ checkout: 'not an object' })).toBeNull();
      expect(readCorrelation(payload({ order_id: '' }))).toBeNull();
      expect(readCorrelation(payload({ acceptance: undefined }))).toBeNull();
      expect(readCorrelation(payload({ acceptance: { state: 'maybe' } })))
        .toBeNull();
      expect(readCorrelation(
        payload({ acceptance: { state: 'accepted', outcome: 'perhaps' } })))
        .toBeNull();
    });

    it('NEVER reconstructs one from the legacy keys beside it', () => {
      // A projection assembled here out of `accepted` / `id` would carry
      // exactly the draft/legacy conflation the projection exists to
      // remove, wearing the shape that says it does not.
      expect(readCorrelation({ id: 'o1', accepted: true,
                               checkout_protocol: 2 })).toBeNull();
    });
  });

  describe('matching the issued command', () => {
    const expected = { key: 'k1', scope: 'r1:t1', orderId: 'o1' };

    it('accepts an answer that names the key, the order and the scope', () => {
      expect(correlationMatches(readCorrelation(payload())!, expected))
        .toBeTrue();
    });

    it('refuses a different intent key', () => {
      expect(correlationMatches(
        readCorrelation(payload({ intent_key: 'other' }))!, expected))
        .toBeFalse();
    });

    it('refuses an answer that names NO key', () => {
      // The server publishes it from the order's own `client_order_id`, so
      // an answer that omits it is about an order this key did not create.
      expect(correlationMatches(
        readCorrelation(payload({ intent_key: null }))!, expected))
        .toBeFalse();
    });

    it('refuses a different order', () => {
      expect(correlationMatches(
        readCorrelation(payload({ order_id: 'o2' }))!, expected))
        .toBeFalse();
    });

    it('refuses a different table — the scope is part of the answer', () => {
      expect(correlationMatches(
        readCorrelation(payload({ scope: { restaurant: 'r1', table: 't9' } }))!,
        expected)).toBeFalse();
    });

    it('still checks key and scope when no order was issued yet', () => {
      const withoutOrder = { key: 'k1', scope: 'r1:t1', orderId: null };
      expect(correlationMatches(readCorrelation(payload())!, withoutOrder))
        .toBeTrue();
      expect(correlationMatches(
        readCorrelation(payload({ intent_key: 'other' }))!, withoutOrder))
        .toBeFalse();
    });
  });
});
