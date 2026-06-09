import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { RestaurantRole } from 'src/app/_models/app.models';

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
    const membership = (roles: string[]): RestaurantRole =>
      ({ restaurant_id: 'r1', restaurant: 'Test Restaurant', roles });

    // Private helper invoked via bracket access — it drives every post-login
    // redirect default, so its branching is the contract worth pinning down.
    const landingFor = (m: RestaurantRole) =>
      (component as any)['landingPathForMembership'](m);

    it('routes a kitchen-only membership to /kitchen', () => {
      expect(landingFor(membership(['kitchen']))).toBe('/kitchen');
    });

    it('routes kitchen + owner to /rest-app', () => {
      expect(landingFor(membership(['kitchen', 'owner']))).toBe('/rest-app');
    });

    it('routes kitchen + manager to /rest-app', () => {
      expect(landingFor(membership(['kitchen', 'manager']))).toBe('/rest-app');
    });

    it('routes owner-only to /rest-app', () => {
      expect(landingFor(membership(['owner']))).toBe('/rest-app');
    });

    it('routes manager-only to /rest-app', () => {
      expect(landingFor(membership(['manager']))).toBe('/rest-app');
    });

    it('routes a non-kitchen staff role (waiter) to /rest-app', () => {
      expect(landingFor(membership(['waiter']))).toBe('/rest-app');
    });

    it('routes an empty role list to /rest-app', () => {
      expect(landingFor(membership([]))).toBe('/rest-app');
    });

    it('defaults to /rest-app when roles is missing', () => {
      expect(landingFor({ restaurant_id: 'r1', restaurant: 'Test' } as RestaurantRole)).toBe('/rest-app');
    });
  });
});
