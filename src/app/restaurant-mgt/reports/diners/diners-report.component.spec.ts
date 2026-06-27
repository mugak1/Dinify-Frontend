import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { DinersReportComponent } from './diners-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { DinersListingRow, DinersSummary } from '../models/reports.models';

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

function dinerRow(n: number, total_spend = 90000, no_orders = 3): DinersListingRow {
  return {
    customer_id: `CUST-${n}`,
    name: `Diner ${n}`,
    phone_number: '+256700000000',
    no_orders,
    total_spend,
    average_spend: Math.round(total_spend / no_orders),
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
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' }, currentRestaurant: { name: 'Test' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
      ],
    }).compileComponents();

    reports = TestBed.inject(ReportsService);
    fixture = TestBed.createComponent(DinersReportComponent);
    component = fixture.componentInstance;
  });

  it('builds the chips, the order split and the leaderboard for the default range', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [dinerRow(1), dinerRow(2)] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue();
    expect(component.summary).not.toBeNull();
    expect(component.prevSummary).not.toBeNull(); // comparison resolved
    expect(component.listingReady).toBeTrue();
    expect(component.listingCapped).toBeFalse();
    // Order-level split: identified orders = Σ no_orders (3+3); guest orders = summary.guestOrders.
    expect(component.split.identified).toBe(6);
    expect(component.split.guest).toBe(40);
    expect(component.leaderboardRows.length).toBe(2);
  }));

  it('ranks the leaderboard by total spend descending', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    spyOn(reports, 'getDinersListing').and.returnValue(
      of({ data: [dinerRow(1, 50000), dinerRow(2, 200000), dinerRow(3, 100000)] } as any),
    );

    component.ngOnInit();
    tick(600);

    expect(component.leaderboardRows.map((r) => r.total_spend)).toEqual([200000, 100000, 50000]);
  }));

  it('shows the empty state only when there are no diners AND no guests', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(
      of({ data: summary({ identifiedDiners: 0, repeatDiners: 0, guestOrders: 0, avgSpendPerDiner: 0, mostActive: undefined }) } as any),
    );
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeFalse();
    expect(component.summaryState).toBe('empty');
  }));

  it('stays populated when only anonymous guests ordered (all-anonymous window)', fakeAsync(() => {
    spyOn(reports, 'getDinersSummary').and.returnValue(
      of({ data: summary({ identifiedDiners: 0, repeatDiners: 0, avgSpendPerDiner: 0, mostActive: undefined, guestOrders: 25 }) } as any),
    );
    spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue();
    expect(component.listingState).toBe('empty'); // no identified diners to rank
    expect(component.split.guest).toBe(25);
    expect(component.split.identified).toBe(0);
    expect(component.split.guestPct).toBe(100);
  }));

  it('shows the most recent 31-day window (capped, NOT hidden) for a long range', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'custom', from: '2026-01-01', to: '2026-12-31' });
    spyOn(reports, 'getDinersSummary').and.returnValue(of({ data: summary() } as any));
    const listingSpy = spyOn(reports, 'getDinersListing').and.returnValue(of({ data: [dinerRow(1)] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.summaryReady).toBeTrue();
    expect(component.listingCapped).toBeTrue();
    expect(component.listingReady).toBeTrue(); // shown, not guarded away
    expect(listingSpy).toHaveBeenCalled();
    expect(listingSpy.calls.mostRecent().args[1]).toBe('2026-11-30'); // recent 31 days
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
