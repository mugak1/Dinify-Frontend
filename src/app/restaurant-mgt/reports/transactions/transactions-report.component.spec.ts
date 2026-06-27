import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { TransactionsReportComponent } from './transactions-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { PaymentMode, TransactionsListingRow, TransactionsSummary } from '../models/reports.models';

// The transactions mock is deliberately sparse, so data-dependent specs stub the
// service with fixed payloads rather than rely on a range producing rows.
function summary(totalCount = 6): TransactionsSummary {
  return {
    byStatus: [
      { status: 'success', count: 4, amount: 120000 },
      { status: 'pending', count: 2, amount: 30000 },
    ],
    byType: [
      { type: 'payment', count: 5, amount: 140000 },
      { type: 'refund', count: 1, amount: 10000 },
    ],
    totalCount,
  };
}

function listingRow(
  n: number,
  type: TransactionsListingRow['transaction_type'] = 'payment',
  payment_mode: PaymentMode = 'MTN MoMo',
): TransactionsListingRow {
  return {
    order_number: `ORD-${n}`,
    transaction_type: type,
    transaction_status: 'success',
    amount: 25000,
    payment_mode,
    transaction_platform: 'Flutterwave',
    time_created: '2026-06-10T10:00:00.000Z',
  };
}

describe('TransactionsReportComponent', () => {
  let component: TransactionsReportComponent;
  let fixture: ComponentFixture<TransactionsReportComponent>;
  let reports: ReportsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionsReportComponent],
      providers: [
        { provide: ApiService, useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']) },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' }, currentRestaurant: { name: 'Test' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
      ],
    }).compileComponents();

    reports = TestBed.inject(ReportsService);
    fixture = TestBed.createComponent(TransactionsReportComponent);
    component = fixture.componentInstance;
  });

  it('derives the chips + breakdown and the listing for the default range', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getTransactionsListing').and.returnValue(of({ data: [listingRow(1), listingRow(2)] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue();
    expect(component.metrics.count).toBe(6);
    expect(component.metrics.gross).toBe(120000); // settled (success) amount
    expect(component.metrics.refunds).toBe(10000); // refund-type amount (mock)
    expect(component.prevMetrics).not.toBeNull(); // comparison window resolved
    expect(component.breakdown.buckets.map((b) => b.label)).toEqual(['Paid', 'Refunded', 'Pending']);
    expect(component.listingReady).toBeTrue();
    expect(component.listingCapped).toBeFalse();
  }));

  it('maps provisional display vocab: refund→refunded pill, cash gets the self-reported marker', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getTransactionsListing').and.returnValue(
      of({ data: [listingRow(1, 'refund'), listingRow(2, 'payment', 'Cash')] } as any),
    );

    component.ngOnInit();
    tick(600);

    const [refund, cash] = component.listingRows;
    expect(refund['transaction_type']).toBe('Refund');
    expect(refund['transaction_status']).toBe('refunded'); // refund TYPE → refunded pill token
    expect(cash['transaction_status']).toBe('paid'); // success → paid
    expect(cash['method']).toContain('†'); // cash = self-reported
  }));

  it('shows the most recent 31-day window (capped, NOT hidden) for a long range', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' }); // 180 days
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    const listingSpy = spyOn(reports, 'getTransactionsListing').and.returnValue(of({ data: [listingRow(1)] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue(); // breakdown covers the full range
    expect(component.listingCapped).toBeTrue();
    expect(component.listingReady).toBeTrue(); // shown, not guarded away
    expect(listingSpy).toHaveBeenCalled();
    // Recent window = the last 31 days ending at `to`.
    expect(listingSpy.calls.mostRecent().args[1]).toBe('2026-05-30');
    expect(listingSpy.calls.mostRecent().args[2]).toBe('2026-06-30');
  }));

  it('re-fetches the listing with ?status= when a filter chip is picked', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    const listingSpy = spyOn(reports, 'getTransactionsListing').and.returnValue(of({ data: [listingRow(1)] } as any));

    component.ngOnInit();
    tick(600);

    component.onFilter('paid');
    tick(600);

    expect(component.selectedChip).toBe('paid');
    expect(listingSpy.calls.mostRecent().args[3]).toEqual({ status: 'success' });
  }));

  it('shows the summary empty state when totalCount is zero', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: { byStatus: [], byType: [], totalCount: 0 } } as any));
    spyOn(reports, 'getTransactionsListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeFalse();
    expect(component.summaryState).toBe('empty');
  }));

  it('shows the listing empty state when there are no rows', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getTransactionsListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.listingReady).toBeFalse();
    expect(component.listingState).toBe('empty');
  }));

  it('shows the error state and retry re-triggers a fetch', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(throwError(() => new Error('boom')));
    spyOn(reports, 'getTransactionsListing').and.returnValue(throwError(() => new Error('boom')));

    component.ngOnInit();
    tick(600);

    expect(component.summaryState).toBe('error');
    expect(component.listingState).toBe('error');

    const refreshSpy = spyOn(reports.refresh$, 'next');
    component.retry();
    expect(refreshSpy).toHaveBeenCalled();
  }));
});
