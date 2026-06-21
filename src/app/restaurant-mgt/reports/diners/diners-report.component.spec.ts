import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { DinersReportComponent } from './diners-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { DinersListingRow, DinersSummary } from '../models/reports.models';

// The diners mock is deliberately thin, so data-dependent specs stub the service
// with fixed payloads rather than rely on a range producing rows.
function summary(overrides: Partial<DinersSummary> = {}): DinersSummary {
  return {
    identifiedDiners: 5,
    repeatDiners: 2,
    guestOrders: 40,
    avgSpendPerDiner: 45000,
    mostActive: { name: 'Aisha N.', totalSpend: 180000 },
    ...overrides,
  };
}

function dinerRow(n: number): DinersListingRow {
  return {
    customer_id: `CUST-${n}`,
    name: `Diner ${n}`,
    phone_number: '+256700000000',
    no_orders: 3,
    total_spend: 90000,
    average_spend: 30000,
    last_order_date: '2026-06-10T10:00:00.000Z',
  };
}

describe('DinersReportComponent', () => {
  let component: DinersReportComponent;
  let fixture: ComponentFixture<DinersReportComponent>;
  let reports: ReportsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DinersReportComponent],
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
    fixture = TestBed.createComponent(DinersReportComponent);
    component = fixture.componentInstance;
  });

  it('loads the overview and the listing for the default range', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [dinerRow(1), dinerRow(2)] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue();
    expect(component.summary).not.toBeNull();
    expect(component.listingReady).toBeTrue();
    expect(component.listingGuarded).toBeFalse();
  }));

  it('shows the overview empty state when there are no diners or guests', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(
      of({
        data: summary({
          identifiedDiners: 0,
          repeatDiners: 0,
          guestOrders: 0,
          avgSpendPerDiner: 0,
          mostActive: undefined,
        }),
      } as any),
    );
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeFalse();
    expect(component.summaryState).toBe('empty');
  }));

  it('keeps the overview populated when only guests ordered', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(
      of({
        data: summary({
          identifiedDiners: 0,
          repeatDiners: 0,
          avgSpendPerDiner: 0,
          mostActive: undefined,
          guestOrders: 25,
        }),
      } as any),
    );
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue();
    expect(component.listingState).toBe('empty');
  }));

  it('guards the listing and skips the fetch when the range exceeds 31 days', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' }); // 180 days
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    const listingSpy = spyOn(reports, 'getDinersListing').and.callThrough();

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue(); // overview still loads
    expect(component.listingGuarded).toBeTrue();
    expect(component.listingState).toBe('listing-guard');
    expect(listingSpy).not.toHaveBeenCalled();
  }));

  it('totals the listing without summing average_spend', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [dinerRow(1), dinerRow(2)] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.listingTableTotals).not.toBeNull();
    expect(Object.keys(component.listingTableTotals!)).toEqual(['no_orders', 'total_spend']);
    expect(component.listingTableTotals!['average_spend']).toBeUndefined();
  }));

  it('paginates the listing 50 rows per page', fakeAsync(() => {
    const rows = Array.from({ length: 120 }, (_, i) => dinerRow(i + 1));
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: rows } as any));

    component.ngOnInit();
    tick(600);

    expect(component.listingRows.length).toBe(120);
    expect(component.pagedListingRows.length).toBe(50);
    expect(component.pageCount).toBe(3);

    component.nextPage();
    expect(component.page).toBe(1);
    component.prevPage();
    expect(component.page).toBe(0);
    component.prevPage(); // cannot go below zero
    expect(component.page).toBe(0);
  }));

  it('shows the listing empty state when there are no identified diners', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.listingReady).toBeFalse();
    expect(component.listingState).toBe('empty');
  }));

  it('shows the error state and retry re-triggers a fetch', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(throwError(() => new Error('boom')));
    spyOn(reports, 'getDinersListing').and.returnValue(throwError(() => new Error('boom')));

    component.ngOnInit();
    tick(600);

    expect(component.summaryState).toBe('error');
    expect(component.listingState).toBe('error');

    const refreshSpy = spyOn(reports.refresh$, 'next');
    component.retry();
    expect(refreshSpy).toHaveBeenCalled();
  }));
});
