import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ReportsShellComponent } from './reports-shell.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { ReportDateRange } from '../models/reports.models';

describe('ReportsShellComponent', () => {
  let component: ReportsShellComponent;
  let fixture: ComponentFixture<ReportsShellComponent>;
  let reports: ReportsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportsShellComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']) },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportsShellComponent);
    component = fixture.componentInstance;
    reports = TestBed.inject(ReportsService);
    fixture.detectChanges();
  });

  it('renders all four reports as a single horizontal tab strip', () => {
    const links = fixture.nativeElement.querySelectorAll('a');
    expect(links.length).toBe(component.reportNav.length); // one strip, no left rail
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Sales');
    expect(text).toContain('Menu performance');
    expect(text).toContain('Transactions');
    expect(text).toContain('Diners');
  });

  it('mounts the persistent date-range control above the outlet', () => {
    expect(fixture.nativeElement.querySelector('app-report-date-range')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });

  it('pushes range changes onto the shared subject', () => {
    spyOn(reports.dateRange$, 'next');
    const range: ReportDateRange = { preset: 'today', from: '2026-06-21', to: '2026-06-21' };
    component.onRange(range);
    expect(reports.dateRange$.next).toHaveBeenCalledWith(range);
  });

  it('pushes compare-toggle changes onto the shared subject', () => {
    spyOn(reports.compareEnabled$, 'next');
    component.onCompareToggle(false);
    expect(reports.compareEnabled$.next).toHaveBeenCalledWith(false);
  });
});
