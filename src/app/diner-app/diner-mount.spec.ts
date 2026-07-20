import { Component, OnInit } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { ActivatedRoute, provideRouter, RouterOutlet, Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes as appRoutes } from '../app-routing.module';
import { restaurantMgtRoutes } from '../restaurant-mgt/restaurant-mgt.module';
import { DINER_MOUNT_EMBEDDED, resolveDinerMountEmbedded } from './diner-mount';

/**
 * The diner surface renders in three mounts (standalone shell, portal ordering
 * preview, admin restaurant embed). The embed flag is declared ON THE ROUTE
 * (DINER_MOUNT_EMBEDDED data) and resolved at activation — this spec exercises
 * REAL routed activation from a cold start, because the predecessor of this
 * mechanism (a pure URL-string predicate) had a spec that called the function
 * directly and could never catch activation-time semantics.
 *
 * Two layers:
 *  1. A ratchet on the REAL route configs — the actual `diner` and
 *     `rest-app-ordering` declarations must carry the flag (asserted by
 *     reference, so the routed harness below cannot drift from prod config).
 *  2. Routed activation over stub components that carry the real declarations'
 *     `data` on the real paths/nesting — a probe standing in for
 *     DinersMenuComponent resolves the flag from its own snapshot in ngOnInit.
 */

const dinerRoute = appRoutes.find((route) => route.path === 'diner')!;
const orderingRoute = restaurantMgtRoutes.find((route) => route.path === 'rest-app-ordering')!;

/** Flags recorded by ProbeComponent at activation. The probe activates in a
 *  NESTED outlet, so RouterTestingHarness's typed `navigateByUrl(url, Type)`
 *  (which asserts the ROOT-outlet component) cannot return it — the probe
 *  reports via this array instead, and each test asserts exactly one
 *  activation so a silently-unactivated probe still fails. */
const resolvedFlags: boolean[] = [];

@Component({ template: '' })
class ProbeComponent implements OnInit {
  constructor(private readonly route: ActivatedRoute) {}
  ngOnInit(): void {
    resolvedFlags.push(resolveDinerMountEmbedded(this.route.snapshot));
  }
}

@Component({ template: '<router-outlet />', imports: [RouterOutlet] })
class ShellStubComponent {}

const DINER_CHILD_STUBS: Routes = [
  { path: 'h/:table', component: ProbeComponent },
  { path: 'menu', component: ProbeComponent },
];

describe('diner mount declarations (ratchet on the real route configs)', () => {
  it('declares the standalone diner mount as NOT embedded', () => {
    expect(dinerRoute).toBeDefined();
    expect(dinerRoute.data?.[DINER_MOUNT_EMBEDDED]).toBeFalse();
  });

  it('declares the portal rest-app-ordering mount as embedded (the admin embed nests this same declaration)', () => {
    expect(orderingRoute).toBeDefined();
    expect(orderingRoute.data?.[DINER_MOUNT_EMBEDDED]).toBeTrue();
  });
});

describe('resolveDinerMountEmbedded — routed activation from a cold start', () => {
  let harness: RouterTestingHarness;

  async function resolveOnColdNavigate(url: string): Promise<boolean> {
    await harness.navigateByUrl(url);
    expect(resolvedFlags.length).withContext(`ProbeComponent activations for ${url}`).toBe(1);
    return resolvedFlags[0];
  }

  beforeEach(async () => {
    resolvedFlags.length = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          // The REAL mount declarations' `data`, on the app's real paths and
          // nesting; components are stubs so activation stays cheap.
          { path: 'diner', component: ShellStubComponent, data: dinerRoute.data, children: DINER_CHILD_STUBS },
          { path: orderingRoute.path!, component: ShellStubComponent, data: orderingRoute.data, children: DINER_CHILD_STUBS },
          {
            path: 'mgt-app', component: ShellStubComponent, children: [
              { path: 'restaurants', component: ShellStubComponent, children: [
                { path: 'rest-app/:id', component: ShellStubComponent, children: [
                  { path: orderingRoute.path!, component: ShellStubComponent, data: orderingRoute.data, children: DINER_CHILD_STUBS },
                ] },
              ] },
            ],
          },
          { path: 'no-flag', component: ShellStubComponent, children: DINER_CHILD_STUBS },
        ]),
        provideLocationMocks(),
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  it('resolves the standalone diner shell as NOT embedded (the QR cold-load path)', async () => {
    expect(await resolveOnColdNavigate('/diner/h/t-1')).toBeFalse();
  });

  it('resolves the portal ordering preview as embedded', async () => {
    expect(await resolveOnColdNavigate('/rest-app-ordering/menu')).toBeTrue();
  });

  it('resolves the admin restaurant embed as embedded (flag found by walking up the snapshot chain)', async () => {
    expect(await resolveOnColdNavigate('/mgt-app/restaurants/rest-app/42/rest-app-ordering/menu')).toBeTrue();
  });

  it('defaults to standalone when NO route on the chain declares the flag', async () => {
    expect(await resolveOnColdNavigate('/no-flag/menu')).toBeFalse();
  });
});
