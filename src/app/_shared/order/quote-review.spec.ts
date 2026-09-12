import { OrderInitiated } from '../../_models/app.models';
import { QuoteRefusal, reviewQuote } from './quote-review';

/**
 * R1 — the corrected quote is VALIDATED, not merely glanced at.
 *
 * Every payload here is SYNTHETIC. None is claimed to have been observed from
 * a Dinify server: they are the shapes the client must refuse rather than
 * confirm, and the three compatibility shapes it must keep accepting.
 */
describe('reviewQuote', () => {
  const extra = (over: Record<string, unknown> = {}) => ({
    id: 'x1', item: 'xi1', item_name: 'Cheese', quantity: 1,
    available: true, status: 'available',
    unit_price: '2000.00', discounted_price: '2000.00',
    actual_cost: '2000.00', ...over,
  }) as any;

  const line = (over: Record<string, unknown> = {}) => ({
    id: 'l1', item: 'i1', item_name: 'Burger', quantity: 1,
    available: true, status: 'available',
    selected_modifiers: {}, modifiers: [], options: [],
    unit_price: '25000.00', reference_unit_price: '25000.00',
    discounted_price: '25000.00', unit_cost_of_options: '0.00',
    discounted: false,
    total_cost: '25000.00', reference_total_cost: '25000.00',
    discounted_cost: '25000.00', savings: '0.00',
    line_actual_cost: '25000.00', line_total_with_extras: '25000.00',
    extras: [] as unknown[], ...over,
  }) as any;

  const payload = (over: Record<string, unknown> = {},
                   details: Record<string, unknown> = {}): OrderInitiated => ({
    order_details: {
      id: 'o1', restaurant: 'r1', table: 't1', table_number: 1,
      total_cost: 25000, discounted_cost: 25000, savings: 0,
      actual_cost: 25000, prepayment_required: false,
      no_items: 1, no_unavailable_items: 0, no_available_items: 1,
      no_unavailable_extras: 0,
      order_status: 'initiated', payment_status: 'pending',
      pricing_version: 1, quote_ref: 'qref-1', quote_total: '25000.00',
      ...details,
    },
    order_items: [], unavailable_items: [], available_items: [],
    unavailable_extras: [],
    quote: [line()],
    ...over,
  }) as any;

  const refusedWith = (reason: QuoteRefusal, ...args: Parameters<typeof payload>) => {
    const review = reviewQuote(payload(...args));
    expect(review.readable).withContext(`expected ${reason}`).toBeFalse();
    expect(review.reason).toBe(reason);
    expect(review.totalMinor).toBeNull();
    return review;
  };

  // ── the two source-led fixtures the residual brief names ───────────────
  describe('the fixtures this check was written for', () => {
    it('refuses a CORRECTED payload that claims an available dish above NO lines', () => {
      // `pricing_version: 1`, a valid-looking reference, a stated payable, and
      // `no_available_items: 1` — with the quote missing. The old loop over
      // the lines succeeded VACUOUSLY because there were none.
      refusedWith('availability_counts', { quote: [] },
                  { quote_total: '25.00', actual_cost: 25, no_available_items: 1 });
    });

    it('refuses a complete-looking quote whose lines do not add up to the payable', () => {
      // A purported complete quote summing to 10.00 under a payable of 25.00.
      // Every individual amount here is readable; only the RECONCILIATION
      // catches it.
      refusedWith('order_reconciliation', {
        quote: [line({ line_actual_cost: '10.00', line_total_with_extras: '10.00',
                       unit_price: '10.00', reference_unit_price: '10.00',
                       discounted_price: '10.00', total_cost: '10.00',
                       reference_total_cost: '10.00', discounted_cost: '10.00' })],
      }, { quote_total: '25.00', actual_cost: 25 });
    });
  });

  // ── the compatibility table, which must not become a deploy-window outage ─
  describe('compatibility', () => {
    it('reviews a pre-D02 LEGACY payload through actual_cost with no quote at all', () => {
      const review = reviewQuote(payload({ quote: undefined }, {
        pricing_version: undefined, quote_ref: undefined,
        quote_total: undefined, actual_cost: 4321,
      }));
      expect(review.readable).toBeTrue();
      expect(review.totalMinor).toBe(432100);
      expect(review.itemised).toBeFalse();
    });

    it('reviews an explicitly LEGACY payload the same way', () => {
      const review = reviewQuote(payload({ quote: [] }, {
        pricing_version: 0, quote_ref: undefined,
        quote_total: undefined, actual_cost: 4321,
      }));
      expect(review.readable).toBeTrue();
      expect(review.totalMinor).toBe(432100);
    });

    it('reviews backend #314: CORRECTED, itemised, and no quote_total yet', () => {
      // #314 shipped `pricing_version`, `quote_ref` AND `quote` in one commit;
      // only the canonical total arrived in #315. Refusing this blocks every
      // checkout for the width of a deploy, which is the outage the bounded
      // tolerance exists to prevent.
      const review = reviewQuote(payload({}, { quote_total: undefined }));
      expect(review.readable).toBeTrue();
      expect(review.totalMinor).toBe(2500000);
      expect(review.itemised).toBeTrue();
    });

    it('still validates the LINES of a #314 payload', () => {
      // The compatibility is bounded to the TOTAL. #314 supplied the itemised
      // quote, so a missing or non-reconciling quote from it is as anomalous
      // as it is from #315 — the two absences are not equivalent.
      refusedWith('availability_counts', { quote: [] },
                  { quote_total: undefined, actual_cost: 25000 });
    });

    it('refuses a CORRECTED payload that SENT a total it cannot express', () => {
      refusedWith('total_unreadable', {}, { quote_total: 'nonsense' });
    });

    it('refuses an explicit null total and never falls back beside it', () => {
      refusedWith('total_unreadable', {}, { quote_total: null, actual_cost: 25000 });
    });
  });

  // ── structure ──────────────────────────────────────────────────────────
  describe('structure', () => {
    it('refuses a CORRECTED draft that names no reference', () => {
      refusedWith('reference_missing', {}, { quote_ref: undefined });
    });

    it('refuses a CORRECTED draft whose quote key is absent entirely', () => {
      refusedWith('quote_missing', { quote: undefined },
                  { no_available_items: 0 });
    });

    it('refuses a line with no usable identity', () => {
      refusedWith('line_identity', { quote: [line({ id: '' })] });
    });

    it('refuses two lines sharing one identity', () => {
      refusedWith('line_identity', {
        quote: [line({ line_actual_cost: '12500.00',
                       line_total_with_extras: '12500.00' }),
                line({ line_actual_cost: '12500.00',
                       line_total_with_extras: '12500.00' })],
      }, { no_available_items: 2 });
    });

    it('refuses an extra sharing its parent line identity', () => {
      refusedWith('line_identity', {
        quote: [line({
          line_total_with_extras: '27000.00',
          extras: [extra({ id: 'l1' })],
        })],
      }, { quote_total: '27000.00' });
    });

    it('refuses a quote that is not an array', () => {
      refusedWith('quote_missing', { quote: 'nope' as any });
    });

    it('refuses more lines than one request could ever have submitted', () => {
      refusedWith('quote_shape', {
        quote: Array.from({ length: 101 }, (_, i) => line({ id: `l${i}` })),
      });
    });

    it('refuses more extras on a line than one submitted line could carry', () => {
      refusedWith('quote_shape', {
        quote: [line({
          extras: Array.from({ length: 65 }, (_, i) => extra({ id: `x${i}` })),
        })],
      });
    });
  });

  // ── quantity and availability ──────────────────────────────────────────
  describe('quantities and availability', () => {
    it('refuses a deliverable line with nothing to deliver', () => {
      refusedWith('line_quantity', { quote: [line({ quantity: 0 })] });
    });

    it('refuses a fractional quantity', () => {
      refusedWith('line_quantity', { quote: [line({ quantity: 1.5 })] });
    });

    it('refuses a negative quantity', () => {
      refusedWith('line_quantity', { quote: [line({ quantity: -1 })] });
    });

    it('accepts a merged row above the per-line SUBMIT ceiling', () => {
      // The server legitimately merges identical configurations into one row
      // that may exceed what a single request may submit. Bounding the
      // response by the request ceiling would refuse a correct order.
      const review = reviewQuote(payload({
        quote: [line({ quantity: 250, line_actual_cost: '25000.00',
                       line_total_with_extras: '25000.00' })],
      }));
      expect(review.readable).toBeTrue();
    });

    it('accepts an all-unavailable order as understandable', () => {
      const review = reviewQuote(payload({
        quote: [line({ available: false, quantity: 0,
                       unit_price: '0.00', reference_unit_price: '0.00',
                       discounted_price: '0.00', total_cost: '0.00',
                       reference_total_cost: '0.00', discounted_cost: '0.00',
                       line_actual_cost: '0.00',
                       line_total_with_extras: '0.00' })],
      }, { quote_total: '0.00', actual_cost: 0,
           no_available_items: 0, no_unavailable_items: 1 }));
      expect(review.readable).toBeTrue();
      expect(review.totalMinor).toBe(0);
    });

    it('refuses a quote that disagrees with its own unavailable count', () => {
      refusedWith('availability_counts', {}, { no_unavailable_items: 1 });
    });
  });

  // ── money ──────────────────────────────────────────────────────────────
  describe('money', () => {
    it('accepts a deliverable free dish at a positive quantity', () => {
      const review = reviewQuote(payload({
        quote: [line({ quantity: 2,
                       unit_price: '0.00', reference_unit_price: '0.00',
                       discounted_price: '0.00', total_cost: '0.00',
                       reference_total_cost: '0.00', discounted_cost: '0.00',
                       line_actual_cost: '0.00',
                       line_total_with_extras: '0.00' })],
      }, { quote_total: '0.00', actual_cost: 0 }));
      expect(review.readable).toBeTrue();
      expect(review.totalMinor).toBe(0);
    });

    it('refuses an unreadable line amount', () => {
      refusedWith('line_amount', {
        quote: [line({ line_total_with_extras: null })],
      });
    });

    it('refuses a negative payable on a line, even when the order reconciles', () => {
      // The two lines sum to the stated payable exactly, so ONLY the
      // per-amount non-negativity rule can catch this. A payable is not a
      // signed adjustment.
      refusedWith('line_amount', {
        quote: [
          line({ line_actual_cost: '50000.00',
                 line_total_with_extras: '50000.00' }),
          line({ id: 'l2', line_actual_cost: '-25000.00',
                 line_total_with_extras: '-25000.00' }),
        ],
      }, { no_available_items: 2 });
    });

    it('accepts a NEGATIVE modifier adjustment, which is legitimately signed', () => {
      // "no cheese, -500" is a legal configuration end to end. The sign is
      // information, not corruption, and the payable stays non-negative.
      const review = reviewQuote(payload({
        quote: [line({ unit_cost_of_options: '-500.00' })],
      }));
      expect(review.readable).toBeTrue();
    });

    it('counts each child exactly once against its parent line', () => {
      const review = reviewQuote(payload({
        quote: [line({
          line_actual_cost: '25000.00',
          line_total_with_extras: '27000.00',
          extras: [extra()],
        })],
      }, { quote_total: '27000.00', actual_cost: 27000 }));
      expect(review.readable).toBeTrue();
      expect(review.totalMinor).toBe(2700000);
    });

    it('refuses a line whose extras do not compose its own aggregate', () => {
      refusedWith('line_reconciliation', {
        quote: [line({
          line_actual_cost: '25000.00',
          line_total_with_extras: '25000.00',   // the extra is missing from it
          extras: [extra()],
        })],
      });
    });

    it('refuses a line that counts its own extra twice', () => {
      refusedWith('line_reconciliation', {
        quote: [line({
          line_actual_cost: '25000.00',          // parent alone, correctly
          line_total_with_extras: '29000.00',    // the 2000 extra, added twice
          extras: [extra()],
        })],
      }, { quote_total: '29000.00', actual_cost: 29000 });
    });

    it('refuses an unreadable extra amount', () => {
      refusedWith('line_amount', {
        quote: [line({ extras: [extra({ actual_cost: '1.005' })] })],
      });
    });

    it('reconciles exactly, with no epsilon, at sub-cent scale', () => {
      const review = reviewQuote(payload({
        quote: [line({ line_actual_cost: '2697.30',
                       line_total_with_extras: '2697.30' })],
      }, { quote_total: '2697.30', actual_cost: 2697.3 }));
      expect(review.readable).toBeTrue();
      expect(review.totalMinor).toBe(269730);
    });

    it('refuses a payable one cent away from its lines', () => {
      refusedWith('order_reconciliation', {
        quote: [line({ line_actual_cost: '2697.30',
                       line_total_with_extras: '2697.30' })],
      }, { quote_total: '2697.31', actual_cost: 2697.31 });
    });
  });

  // ── the server's own coherence signal ──────────────────────────────────
  describe('quote_complete', () => {
    it('refuses a quote the SERVER says does not cover the payable', () => {
      refusedWith('quote_incomplete', {}, { quote_complete: false });
    });

    it('is unaffected by a server that does not publish the key', () => {
      expect(reviewQuote(payload()).readable).toBeTrue();
    });

    it('accepts an explicit true', () => {
      expect(reviewQuote(payload({}, { quote_complete: true })).readable).toBeTrue();
    });
  });

  it('refuses an absent payload without throwing', () => {
    expect(reviewQuote(null).readable).toBeFalse();
    expect(reviewQuote(undefined).reason).toBe('no_payload');
    expect(reviewQuote({} as any).reason).toBe('no_payload');
  });

  it('never rebuilds or filters the lines it returns', () => {
    const sent = [line(), line({ id: 'l2' })];
    const review = reviewQuote(payload({ quote: sent }, { no_available_items: 2 }));
    // Refused (they do not reconcile) — and the array is still the server's.
    expect(review.readable).toBeFalse();
    expect(review.lines).toBe(sent);
  });
});
