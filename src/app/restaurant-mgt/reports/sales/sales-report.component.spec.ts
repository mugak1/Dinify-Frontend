import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { SalesReportComponent } from './sales-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';

describe('SalesReportComponent', () => {
  let component: SalesReportComponent;
  let fixture: ComponentFixture<SalesReportComponent>;
  let reports: ReportsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesReportComponent],
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
    fixture = TestBed.createComponent(SalesReportComponent);
    component = fixture.componentInstance;
  });

  it('loads the aggregate and the paginated listing for the default this-month range', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    expect(component.aggReady).toBeTrue();
    expect(component.aggTotals).not.toBeNull();

    expect(component.listingReady).toBeTrue();
    expect(component.listingGuarded).toBeFalse();
    expect(component.listingRows.length).toBeGreaterThan(50);
    expect(component.pagedListingRows.length).toBe(50);
    expect(component.pageCount).toBeGreaterThan(1);
  }));

  it('advances and retreats listing pages', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    expect(component.page).toBe(0);
    component.nextPage();
    expect(component.page).toBe(1);
    expect(component.pagedListingRows[0]).toBe(component.listingRows[50]);
    component.prevPage();
    expect(component.page).toBe(0);
    component.prevPage(); // cannot go below zero
    expect(component.page).toBe(0);
  }));

  it('guards the listing and skips the fetch when the range exceeds 31 days', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' }); // 180 days
    const listingSpy = spyOn(reports, 'getSalesListing').and.callThrough();

    component.ngOnInit();
    tick(600);

    expect(component.aggReady).toBeTrue(); // monthly aggregate still loads
    expect(component.listingGuarded).toBeTrue();
    expect(component.listingState).toBe('listing-guard');
    expect(listingSpy).not.toHaveBeenCalled();
  }));

  it('shows the empty state when no data is returned', fakeAsync(() => {
    spyOn(reports, 'getSalesAggregate').and.returnValue(of({ data: [] } as any));
    spyOn(reports, 'getSalesListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.aggReady).toBeFalse();
    expect(component.aggState).toBe('empty');
    expect(component.listingReady).toBeFalse();
    expect(component.listingState).toBe('empty');
  }));

  it('shows the error state and retry re-triggers a fetch', fakeAsync(() => {
    spyOn(reports, 'getSalesAggregate').and.returnValue(throwError(() => new Error('boom')));
    spyOn(reports, 'getSalesListing').and.returnValue(throwError(() => new Error('boom')));

    component.ngOnInit();
    tick(600);

    expect(component.aggState).toBe('error');
    expect(component.listingState).toBe('error');

    const refreshSpy = spyOn(reports.refresh$, 'next');
    component.retry();
    expect(refreshSpy).toHaveBeenCalled();
  }));
});
