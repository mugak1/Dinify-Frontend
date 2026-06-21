import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { MenuReportComponent } from './menu-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';

describe('MenuReportComponent', () => {
  let component: MenuReportComponent;
  let fixture: ComponentFixture<MenuReportComponent>;
  let reports: ReportsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuReportComponent],
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
    fixture = TestBed.createComponent(MenuReportComponent);
    component = fixture.componentInstance;
  });

  it('loads the menu aggregate for the default this-month range', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.totals).not.toBeNull();
    expect(component.rows.length).toBeGreaterThan(0);
  }));

  it('re-fetches with the new grouping when the toggle changes', fakeAsync(() => {
    const spy = spyOn(reports, 'getMenuSummary').and.callThrough();

    component.ngOnInit();
    tick(600);
    expect(spy.calls.mostRecent().args[3]).toBe('sections');

    component.onGrouping('items');
    tick(600);
    expect(spy.calls.mostRecent().args[3]).toBe('items');
    expect(component.ready).toBeTrue();
  }));

  it('renders at a range longer than 31 days (no listing guard)', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' }); // 180 days

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.rows.length).toBeGreaterThan(0);
  }));

  it('shows the empty state when no rows are returned', fakeAsync(() => {
    spyOn(reports, 'getMenuSummary').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeFalse();
    expect(component.state).toBe('empty');
  }));

  it('shows the error state and retry re-triggers a fetch', fakeAsync(() => {
    spyOn(reports, 'getMenuSummary').and.returnValue(throwError(() => new Error('boom')));

    component.ngOnInit();
    tick(600);

    expect(component.state).toBe('error');

    const refreshSpy = spyOn(reports.refresh$, 'next');
    component.retry();
    expect(refreshSpy).toHaveBeenCalled();
  }));
});
