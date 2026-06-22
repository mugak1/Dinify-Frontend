import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { PermissionsMap, RestaurantRole } from 'src/app/_models/app.models';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('landingPathForMembership', () => {
    const membership = (roles: string[], permissions?: PermissionsMap): RestaurantRole =>
      ({ restaurant_id: 'r1', restaurant: 'Test Restaurant', roles, ...(permissions ? { permissions } : {}) });

    // Private helper invoked via bracket access — it drives every post-login
    // redirect default, so its branching is the contract worth pinning down.
    const landingFor = (m: RestaurantRole) =>
      (component as any)['landingPathForMembership'](m);

    const ALL_FALSE: PermissionsMap = {
      dashboard: false, menu: false, tables: false, reviews: false, reports: false,
      settings: false, kitchen: false, billing: false, team: false,
    };
    const TABLES_ONLY: PermissionsMap = { ...ALL_FALSE, tables: true };

    // ── Absent permissions map → role-based fallback (migration cushion). The
    // bare '/rest-app' of the old contract is gone: non-kitchen now resolves to
    // the explicit dashboard route, killing the ''→dashboard redirect bounce. ──
    it('routes a kitchen-only membership (no map) to /kitchen', () => {
      expect(landingFor(membership(['kitchen']))).toBe('/kitchen');
    });

    it('routes kitchen + owner (no map) to the dashboard', () => {
      expect(landingFor(membership(['kitchen', 'owner']))).toBe('/rest-app/dashboard');
    });

    it('routes kitchen + manager (no map) to the dashboard', () => {
      expect(landingFor(membership(['kitchen', 'manager']))).toBe('/rest-app/dashboard');
    });

    it('routes owner-only (no map) to the dashboard', () => {
      expect(landingFor(membership(['owner']))).toBe('/rest-app/dashboard');
    });

    it('routes manager-only (no map) to the dashboard', () => {
      expect(landingFor(membership(['manager']))).toBe('/rest-app/dashboard');
    });

    it('routes the restaurant_staff role (no map) to the dashboard', () => {
      expect(landingFor(membership(['restaurant_staff']))).toBe('/rest-app/dashboard');
    });

    it('routes an empty / missing role list (no map) to the dashboard', () => {
      expect(landingFor(membership([]))).toBe('/rest-app/dashboard');
      expect(landingFor({ restaurant_id: 'r1', restaurant: 'Test' } as RestaurantRole))
        .toBe('/rest-app/dashboard');
    });

    // ── Present permissions map → first accessible module ──
    it('lands a Tables-only staff on /rest-app/dining-tables, not the blocked dashboard', () => {
      expect(landingFor(membership(['restaurant_staff'], TABLES_ONLY))).toBe('/rest-app/dining-tables');
    });

    it('lands an all-false map on /rest-app/account (shared with the no-modules note)', () => {
      expect(landingFor(membership(['restaurant_staff'], ALL_FALSE))).toBe('/rest-app/account');
    });
  });
});
