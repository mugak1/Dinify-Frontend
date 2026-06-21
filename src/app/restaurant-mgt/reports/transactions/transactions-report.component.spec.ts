import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { TransactionsReportComponent } from './transactions-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { TransactionsListingRow, TransactionsSummary } from '../models/reports.models';

// The transactions mock is deliberately sparse, so data-dependent specs stub the
// service with fixed payloads rather than rely on a range producing rows.
function summary(totalCount = 6): TransactionsSummary {
  return {
    byStatus: [
      { status: 'success', count: 4, amount: 120000 },
      { status: 'failed', count: 2, amount: 30000 },
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
): TransactionsListingRow {
  return {
    order_number: `ORD-${n}`,
    transaction_type: type,
    transaction_status: 'success',
    amount: 25000,
    payment_mode: 'MTN MoMo',
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
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
      ],
    }).compileComponents();

    reports = TestBed.inject(ReportsService);
    fixture = TestBed.createComponent(TransactionsReportComponent);
    component = fixture.componentInstance;
  });

  it('loads the summary breakdowns and the listing for the default range', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getTransactionsListing').and.returnValue(
      of({ data: [listingRow(1), listingRow(2)] } as any),
    );

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue();
    expect(component.byStatusTotals).not.toBeNull();
    expect(component.byTypeTotals).not.toBeNull();
    expect(component.listingReady).toBeTrue();
    expect(component.listingGuarded).toBeFalse();
  }));

  it('maps transaction_type to a neutral label and never surfaces a disbursement', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getTransactionsListing').and.returnValue(
      of({ data: [listingRow(1, 'refund'), listingRow(2, 'charge')] } as any),
    );

    component.ngOnInit();
    tick(600);

    const labels = component.pagedListingRows.map((r) => r.transaction_type);
    expect(labels).toEqual(['Refund', 'Charge']);
    labels.forEach((l) => expect(l).not.toBe('Disbursement'));
  }));

  it('guards the listing and skips the fetch when the range exceeds 31 days', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' }); // 180 days
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    const listingSpy = spyOn(reports, 'getTransactionsListing').and.callThrough();

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue(); // breakdowns still load
    expect(component.listingGuarded).toBeTrue();
    expect(component.listingState).toBe('listing-guard');
    expect(listingSpy).not.toHaveBeenCalled();
  }));

  it('paginates the listing 50 rows per page', fakeAsync(() => {
    const rows = Array.from({ length: 120 }, (_, i) => listingRow(i + 1));
    spyOn(reports, 'getTransactionsSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getTransactionsListing').and.returnValue(of({ data: rows } as any));

    component.ngOnInit();
    tick(600);

    expect(component.listingRows.length).toBe(120);
    expect(component.pagedListingRows.length).toBe(50);
    expect(component.pageCount).toBe(3);

    component.nextPage();
    expect(component.page).toBe(1);
    expect(component.pagedListingRows[0].order_number).toBe(component.listingRows[50].order_number);
    component.prevPage();
    expect(component.page).toBe(0);
    component.prevPage(); // cannot go below zero
    expect(component.page).toBe(0);
  }));

  it('shows the summary empty state when totalCount is zero', fakeAsync(() => {
    spyOn(reports, 'getTransactionsSummary').and.returnValue(
      of({ data: { byStatus: [], byType: [], totalCount: 0 } } as any),
    );
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
