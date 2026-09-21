// D07 / PR-6 — A REPORT NEVER STATES A TENDER OR A PAYMENT STATUS THE SERVER
// DID NOT STATE.
//
// The defect these pin was not a rare gap being papered over: it MANUFACTURED
// THE ENTIRE COLUMN. Nothing in the platform records a diner payment — the
// order-payment writer (`OrderPaymentTransaction` / `initiate-order-payment/`)
// was DELETED in the non-custodial teardown, and no PSP integration replaced it
// — so `payment_mode` and `payment_status` arrive absent on every real row. The
// adapter's `?? 'Cash'` / `?? 'paid'` / `?? 'pending'` therefore rendered a
// settled cash sale for every order on the Sales listing, and a pending payment
// for every row on the Transactions listing. An operator reconciling their
// takings against that report would have been reconciling against values this
// client invented.
//
// THE CORRECTION IS `null`, NOT A NEUTRAL TOKEN. 'unknown' / 'other' / 'n/a'
// would become values an operator can filter, sort and total by, and would read
// as something the server said. `null` reaches the renderers, which show an em
// dash — "the server did not say" — and that rule has to hold at EVERY consumer,
// which is what the second half of this file is about.
//
// SCOPE, stated so the controls below are not mistaken for oversights: this
// changes what is DISPLAYED about a payment, never what is recorded, charged,
// quoted or collected. It maps no vocabulary — the `momo`/`cash`/`card` versus
// `MTN MoMo`/`Cash` mismatch is a separate documented KNOWN GAP needing a
// product call.

import { adaptSalesListing, adaptTransactionsListing } from './services/reports-adapter';
import { ReportTableComponent } from './components/report-table/report-table.component';
import { isCashMode, listingDisplayStatus, methodDisplay } from './transactions/transactions-view';

describe('D07/PR-6 — payment claims are the server’s, or absent', () => {
  // ── The adapter: absence is preserved, presence is passed through ──────────

  describe('the sales listing adapter', () => {
    it('REGRESSION: a row the server said nothing about carries NO tender and NO status', () => {
      // The real shape today: a sales-listing row the backend emits with no
      // payment columns at all, because nothing writes them.
      const [row] = adaptSalesListing([
        {
          order_number: 'ORD-1',
          time_created: '2026-09-01T10:00:00Z',
          item_count: 2,
          gross: 30000,
          discount: 0,
          revenue: 30000,
        },
      ]);

      expect(row.payment_mode).toBeNull();
      expect(row.payment_status).toBeNull();
      // Named explicitly: these are the exact strings the deleted fallbacks
      // produced, and the thing that must never come back.
      expect(row.payment_mode as unknown).not.toBe('Cash');
      expect(row.payment_status as unknown).not.toBe('paid');
    });

    it('an explicit null, a non-string and a blank are all "the server stated none"', () => {
      const rows = adaptSalesListing([
        { payment_mode: null, payment_status: null },
        { payment_mode: 0, payment_status: false },
        { payment_mode: '   ', payment_status: '' },
      ]);

      for (const row of rows) {
        expect(row.payment_mode).toBeNull();
        expect(row.payment_status).toBeNull();
      }
    });

    it('CONTROL: a tender and status the server DID state survive verbatim', () => {
      const [row] = adaptSalesListing([{ payment_mode: 'Cash', payment_status: 'PAID' }]);

      expect(row.payment_mode).toBe('Cash' as any);
      // Status is lower-cased because the pill vocabulary is lower-case; the
      // VALUE is still the server's, which is the property under test.
      expect(row.payment_status).toBe('paid' as any);
    });
  });

  describe('the transactions listing adapter', () => {
    it('REGRESSION: an unstated transaction status is null, never "pending"', () => {
      const [row] = adaptTransactionsListing([
        { reference: 'TX-1', transaction_type: 'order_payment', amount: 1000 },
      ]);

      expect(row.transaction_status).toBeNull();
      expect(row.transaction_status as unknown).not.toBe('pending');
    });

    it('REGRESSION: an unstated tender is null, never "Cash"', () => {
      const [row] = adaptTransactionsListing([{ reference: 'TX-1', amount: 1000 }]);

      expect(row.payment_mode).toBeNull();
      expect(row.payment_mode as unknown).not.toBe('Cash');
    });

    it('CONTROL: the legacy `status` alias is still read when the server sends it', () => {
      // The adapter accepts `transaction_status` or `status`; narrowing the
      // fallback must not have dropped the alias with it.
      const [row] = adaptTransactionsListing([{ status: 'SUCCESS' }]);

      expect(row.transaction_status).toBe('success' as any);
    });
  });

  // ── The consumers: one absence, one spelling, at all three ────────────────

  describe('every consumer renders an absence the same way', () => {
    let table: ReportTableComponent;

    beforeEach(() => {
      table = new ReportTableComponent();
    });

    it('the status pill says "—" and carries no settled colour', () => {
      expect(table.statusLabel(null)).toBe('—');
      expect(table.statusLabel(undefined)).toBe('—');
      // `outline` is the neutral pill. `success` would paint an unstated
      // payment green, which is the claim in colour rather than in words.
      expect(table.statusVariant(null)).toBe('outline');
    });

    it('REGRESSION: the Sales Method cell says "—" rather than going blank', () => {
      // `formatCell(null, 'text')` returns '', so before the `tender` format
      // the Sales listing rendered a BLANK Method cell beside a `—` Status
      // cell on the same row — one absence spelled two ways, which reads as
      // data loss rather than as the deliberate statement it is.
      expect(table.formatCell(null, 'tender')).toBe('—');
      expect(table.formatCell(undefined, 'tender')).toBe('—');
      expect(table.formatCell('  ', 'tender')).toBe('—');
    });

    it('CONTROL: a stated tender still prints, and `text` is untouched', () => {
      expect(table.formatCell('Cash', 'tender')).toBe('Cash');
      // The new token must not have changed how any other text column renders.
      expect(table.formatCell(null, 'text')).toBe('');
      expect(table.formatCell('ORD-1', 'text')).toBe('ORD-1');
    });

    it('the Transactions Method cell says "—" and claims no cash', () => {
      expect(methodDisplay(null)).toBe('—');
      expect(methodDisplay(undefined)).toBe('—');
      // The cash dagger is an "operator-asserted, not PSP-confirmed" footnote.
      // Appending it to a row with no tender would assert the tender it marks.
      expect(isCashMode(null)).toBeFalse();
      expect(isCashMode(undefined)).toBeFalse();
    });

    it('CONTROL: a stated tender still maps and still earns its dagger', () => {
      expect(methodDisplay('cash')).toBe('Cash');
      expect(isCashMode('cash')).toBeTrue();
    });
  });

  // ── The one derived claim that is deliberately kept ───────────────────────

  describe('a status derived from a STATED type is not an invention', () => {
    it('a refund row still reads "refunded" with no status of its own', () => {
      // `transaction_type` IS server-stated — the row exists because a
      // DinifyTransaction carries that type — so the pill restates a fact
      // rather than manufacturing one from an absence. Deliberately unchanged
      // and pinned here so it is not mistaken for the defect above, nor
      // "tidied" into a `—` that would lose a fact the server did state.
      expect(listingDisplayStatus('refund', null)).toBe('refunded');
    });

    it('but a non-refund row with no status stays empty, and so renders "—"', () => {
      const derived = listingDisplayStatus('payment', null);

      expect(derived).toBe('');
      expect(new ReportTableComponent().statusLabel(derived)).toBe('—');
    });
  });
});
