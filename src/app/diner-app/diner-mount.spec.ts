import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { ActivatedRoute, provideRouter, RouterOutlet, Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes as appRoutes } from '../app-routing.module';
import { restaurantMgtRoutes } from '../restaurant-mgt/restaurant-mgt.module';
import { DINER_MOUNT_EMBEDDED, resolveDinerMountEmbedded } from './diner-mount';

/**
 * The diner surface renders in ONE mount: the standalone `/diner` shell. The
 * admin restaurant embed left with the admin plane in PR-6, and the portal's
 * `rest-app-ordering` preview was retired (it was linked from nowhere, errored
 * without a prior QR scan, and its staff checkout could never succeed). The
 * embed flag is declared ON THE ROUTE (DINER_MOUNT_EMBEDDED data) and resolved
 * at activation — this spec exercises REAL routed activation from a cold
 * start, because the predecessor of this mechanism (a pure URL-string
 * predicate) had a spec that called the function directly and could never
 * catch activation-time semantics.
 *
 * Two layers:
 *  1. A ratchet on the REAL route configs — the actual `diner` declaration must
 *     carry the standalone flag, and the portal must declare NO diner mount
 *     (asserted by reference, so the harness below cannot drift from prod).
 *  2. Routed activation over stub components. The `diner` mount carries the
 *     real declaration's `data`; the embedded side is a SYNTHETIC mount, since
 *     no real one exists. The resolver and the menu's `isInRestApp` branches
 *     are dormant and kept for a separate cleanup, so they stay pinned here
 *     until that cleanup removes them.
 */

const dinerRoute = appRoutes.find((route) => route.path === 'diner')!;
/** A stand-in embedded mount. Deliberately NOT the retired path, so nothing
 *  here reads as evidence that the portal still mounts the diner app. */
const EMBEDDED_STUB = { path: 'embedded-stub', data: { [DINER_MOUNT_EMBEDDED]: true } } as const;

/** Flags recorded by ProbeComponent at activation. The probe activates in a
 *  NESTED outlet, so RouterTestingHarness's typed `navigateByUrl(url, Type)`
 *  (which asserts the ROOT-outlet component) cannot return it — the probe
 *  reports via this array instead, and each test asserts exactly one
 *  activation so a silently-unactivated probe still fails. */
const resolvedFlags: boolean[] = [];

@Component({ changeDetection: ChangeDetectionStrategy.Eager,
 template: '' })
class ProbeComponent implements OnInit {
  constructor(private readonly route: ActivatedRoute) {}
  ngOnInit(): void {
    resolvedFlags.push(resolveDinerMountEmbedded(this.route.snapshot));
  }
}

@Component({ template: '<router-outlet />', changeDetection: ChangeDetectionStrategy.Eager,
 imports: [RouterOutlet] })
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

  it('declares NO diner mount inside the restaurant portal (the rest-app-ordering embed is retired)', () => {
    // Walks the whole portal tree, so a diner mount re-added at any depth fails.
    const walk = (routes: Routes): Routes =>
      routes.flatMap((route) => [route, ...walk(route.children ?? [])]);
    const all = walk(restaurantMgtRoutes);
    expect(all.length).withContext('premise: the portal route table was read').toBeGreaterThan(5);
    expect(all.filter((route) => route.path === 'rest-app-ordering')).toEqual([]);
    expect(all.filter((route) => route.data && DINER_MOUNT_EMBEDDED in route.data)).toEqual([]);
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
          // The REAL `diner` declaration's `data` on its real path, beside a
          // synthetic embedded mount; components are stubs so activation stays
          // cheap.
          { path: 'diner', component: ShellStubComponent, data: dinerRoute.data, children: DINER_CHILD_STUBS },
          { path: EMBEDDED_STUB.path, component: ShellStubComponent, data: EMBEDDED_STUB.data, children: DINER_CHILD_STUBS },
          // A flag-bearing mount nested several levels down, beneath an ancestor
          // declaring the OPPOSITE flag. This shape was the platform-admin embed
          // until PR-6 removed it. The conflicting outer flag makes the
          // replacement STRONGER than the original, whose ancestors were all
          // flagless: it pins nearest-ancestor-wins, not merely "a flag is found
          // somewhere up the chain".
          {
            path: 'outer', component: ShellStubComponent, data: { [DINER_MOUNT_EMBEDDED]: false }, children: [
              { path: 'mid/:id', component: ShellStubComponent, children: [
                { path: EMBEDDED_STUB.path, component: ShellStubComponent, data: EMBEDDED_STUB.data, children: DINER_CHILD_STUBS },
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

  it('resolves a mount declaring the flag as embedded', async () => {
    expect(await resolveOnColdNavigate('/embedded-stub/menu')).toBeTrue();
  });

  it('stops at the NEAREST declaring ancestor — a nested embedded mount beats an outer standalone flag', async () => {
    expect(await resolveOnColdNavigate('/outer/mid/42/embedded-stub/menu')).toBeTrue();
  });

  it('defaults to standalone when NO route on the chain declares the flag', async () => {
    expect(await resolveOnColdNavigate('/no-flag/menu')).toBeFalse();
  });
});
