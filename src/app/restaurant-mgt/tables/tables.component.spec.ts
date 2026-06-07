import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { TablesComponent } from './tables.component';

/**
 * MVP scope: only the Setup View ships. The Service View component, its
 * services, mock data and models remain in the repo but must not render, and
 * the persisted view-state must never be able to force the parked view.
 */
describe('TablesComponent — Setup View is the only view', () => {
  const auth = {
    currentRestaurantRole: { restaurant_id: 'r1' },
  } as unknown as AuthenticationService;

  // PersistedValue calls storage.getItem<T>(key) directly and uses the raw
  // return as the seed, so the mock returns the already-unwrapped value.
  function storageReturning(value: string | null): LocalStorageService {
    return { getItem: () => value } as unknown as LocalStorageService;
  }

  // ── Unit tests (direct construction, matching the module's spec style) ──

  it('defaults to the Setup View when nothing is persisted', () => {
    const component = new TablesComponent(auth, storageReturning(null));
    expect(component.activeView).toBe('setup');
  });

  it('ignores a persisted "service" value and falls back to Setup', () => {
    const component = new TablesComponent(auth, storageReturning('service'));
    expect(component.activeView).toBe('setup');
  });

  it('honours a persisted "setup" value', () => {
    const component = new TablesComponent(auth, storageReturning('setup'));
    expect(component.activeView).toBe('setup');
  });
});

// Lightweight stand-in for the heavy real Setup View; shares its selector so it
// slots into TablesComponent's template without pulling in the real child's
// service graph.
@Component({
  selector: 'app-tables-setup-view',
  standalone: true,
  template: '<div data-testid="setup-view-stub"></div>',
})
class StubSetupViewComponent {}

describe('TablesComponent — rendered template', () => {
  let fixture: ComponentFixture<TablesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TablesComponent],
      providers: [
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null } },
      ],
    })
      .overrideComponent(TablesComponent, {
        set: { imports: [CommonModule, StubSetupViewComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TablesComponent);
    fixture.detectChanges();
  });

  it('renders the Setup View as the sole view', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-tables-setup-view')).toBeTruthy();
    expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeTruthy();
    expect(el.querySelector('app-tables-service-view')).toBeNull();
  });

  it('renders no Service/Setup view-toggle control', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('button').length).toBe(0);
    const text = el.textContent ?? '';
    expect(text).not.toContain('Service View');
    expect(text).not.toContain('Setup View');
  });

  it('still renders the page heading', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Tables');
  });
});
