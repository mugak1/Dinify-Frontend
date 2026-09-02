// The timeframe must survive a report switch.
//
// This is the single most likely defect in the URL-as-truth change and it fails
// SILENTLY: Angular's default `queryParamsHandling` is null, which DROPS query params
// on navigation, so the range would quietly reset to the seed on the first tab click
// with no error anywhere. A manual click-through would catch it once; this catches it
// forever. Drives the real shell + real child route table through the real router.

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ReportsShellComponent } from './reports-shell.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { TimeframeService } from '../../../_shared/timeframe';

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.Eager,
 template: '<p>report</p>' })
class StubReportComponent {}

const REPORT_PATHS = ['sales', 'menu', 'transactions', 'diners'] as const;
const RANGE = { from: '2026-05-01', to: '2026-05-31', preset: 'custom' };

describe('Reports timeframe — survival across child routes', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'reports',
            component: ReportsShellComponent,
            providers: [TimeframeService],
            children: [
              { path: '', redirectTo: 'sales', pathMatch: 'full' },
              ...REPORT_PATHS.map((path) => ({ path, component: StubReportComponent })),
            ],
          },
        ]),
        {
          provide: ApiService,
          useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']),
        },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
        ReportsService,
      ],
    });

    harness = await RouterTestingHarness.create(
      `/reports/sales?from=${RANGE.from}&to=${RANGE.to}&preset=${RANGE.preset}`,
    );
    router = TestBed.inject(Router);
  });

  const queryOf = (): Record<string, string> =>
    Object.fromEntries(new URL(router.url, 'http://x').searchParams.entries());

  it('renders tab links that merge the current query params', () => {
    const anchors = Array.from(
      harness.routeNativeElement!.ownerDocument.querySelectorAll('app-dn-segmented a'),
    ) as HTMLAnchorElement[];

    expect(anchors.length).toBe(REPORT_PATHS.length);
    // routerLink resolves href against the live URL; merge keeps `?from&to&preset`.
    for (const a of anchors) {
      expect(a.getAttribute('href'))
        .withContext(a.textContent ?? '')
        .toContain(`from=${RANGE.from}`);
      expect(a.getAttribute('href')).toContain(`to=${RANGE.to}`);
      expect(a.getAttribute('href')).toContain(`preset=${RANGE.preset}`);
    }
  });

  it('preserves the range when a tab link is actually followed', async () => {
    const anchors = Array.from(
      harness.routeNativeElement!.ownerDocument.querySelectorAll('app-dn-segmented a'),
    ) as HTMLAnchorElement[];

    for (const a of anchors) {
      await router.navigateByUrl(a.getAttribute('href')!);
      expect(queryOf())
        .withContext(`after navigating to ${a.getAttribute('href')}`)
        .toEqual(RANGE);
    }
  });

  it('keeps the service range intact across all four hops', async () => {
    const timeframe = harness.routeDebugElement!.injector.get(TimeframeService);

    for (const path of REPORT_PATHS) {
      await router.navigate(['/reports', path], { queryParamsHandling: 'merge' });
      expect(timeframe.value)
        .withContext(`on ${path}`)
        .toEqual({ preset: 'custom', from: RANGE.from, to: RANGE.to });
    }
  });
});
