import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { TablesComponent } from './tables.component';
import { PageHeaderComponent } from '../../_shared/ui/page-header/page-header.component';
import { DnSegmentedComponent } from '../../_shared/ui/segmented/segmented.component';
import { FloorService } from './services/floor.service';
import { FLOOR_DEV_MODE, floorViewAvailable } from './services/floor-view-gate';

/**
 * THE PRODUCTION GATE (Step 2, FE-B). The floor view — the Tables page's Service
 * view — runs on mock tables and mock orders until FE-C wires the real endpoints. A
 * live restaurant must never see them, so while `FloorService.USE_MOCK_DATA` is on the
 * view, its Floor/Setup toggle and a persisted 'service' selection exist only in a
 * development build. Every optimised build — `production` and the shipping `uat` —
 * shows the Setup View alone, exactly as before Step 2.
 */
describe('floorViewAvailable — the gate', () => {
  it('a production build cannot show the floor while mock data is on', () => {
    expect(floorViewAvailable(false, true)).toBeFalse();
  });
  it('a development build can (the mock preview)', () => {
    expect(floorViewAvailable(true, true)).toBeTrue();
  });
  it('once FE-C turns mock data off, production can (FE-C makes it visible)', () => {
    expect(floorViewAvailable(false, false)).toBeTrue();
    expect(floorViewAvailable(true, false)).toBeTrue();
  });
  it('the mock flag is on in this change', () => {
    expect(FloorService.USE_MOCK_DATA).toBeTrue();
  });
});

describe('TablesComponent — view state behind the gate', () => {
  const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as unknown as AuthenticationService;

  // PersistedValue calls storage.getItem<T>(key) directly and uses the raw return as
  // the seed, so the mock returns the already-unwrapped value.
  function storageReturning(value: string | null): LocalStorageService {
    return { getItem: () => value, setItem: () => undefined } as unknown as LocalStorageService;
  }

  describe('production build (no dev mode) — the Setup View is the only view', () => {
    it('defaults to the Setup View when nothing is persisted', () => {
      expect(new TablesComponent(auth, storageReturning(null)).activeView).toBe('setup');
    });

    it('ignores a persisted "service" value and falls back to Setup', () => {
      expect(new TablesComponent(auth, storageReturning('service')).activeView).toBe('setup');
      expect(new TablesComponent(auth, storageReturning('service'), false).activeView).toBe('setup');
    });

    it('honours a persisted "setup" value', () => {
      expect(new TablesComponent(auth, storageReturning('setup')).activeView).toBe('setup');
    });

    it('refuses to switch to the floor', () => {
      const c = new TablesComponent(auth, storageReturning(null), false);
      c.setView('service');
      expect(c.activeView).toBe('setup');
      expect(c.floorViewAvailable).toBeFalse();
    });
  });

  describe('development build — the floor preview', () => {
    it('honours a persisted "service" value and switches both ways', () => {
      const c = new TablesComponent(auth, storageReturning('service'), true);
      expect(c.activeView).toBe('service');
      c.setView('setup');
      expect(c.activeView).toBe('setup');
      c.setView('service');
      expect(c.activeView).toBe('service');
    });

    it('still defaults to Setup', () => {
      expect(new TablesComponent(auth, storageReturning(null), true).activeView).toBe('setup');
    });
  });
});

// Lightweight stand-ins for the two heavy views; they share the real selectors.
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-tables-setup-view',
  standalone: true,
  template: '<div data-testid="setup-view-stub"></div>',
})
class StubSetupViewComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-tables-service-view',
  standalone: true,
  template: '<div data-testid="service-view-stub"></div>',
})
class StubServiceViewComponent {}

describe('TablesComponent — rendered template', () => {
  let fixture: ComponentFixture<TablesComponent>;

  function render(devMode: boolean, persisted: string | null = null): HTMLElement {
    TestBed.configureTestingModule({
      imports: [TablesComponent],
      providers: [
        { provide: AuthenticationService, useValue: { currentRestaurantRole: { restaurant_id: 'r1' } } },
        { provide: LocalStorageService, useValue: { getItem: () => persisted, setItem: () => undefined } },
        { provide: FLOOR_DEV_MODE, useValue: devMode },
      ],
    }).overrideComponent(TablesComponent, {
      set: { imports: [StubSetupViewComponent, StubServiceViewComponent, PageHeaderComponent, DnSegmentedComponent] },
    });
    fixture = TestBed.createComponent(TablesComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => (FloorService.USE_MOCK_DATA = true));

  describe('PRODUCTION GATE: a production build while mock data is on', () => {
    it('renders the Setup View as the sole view', () => {
      const el = render(false);
      expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeTruthy();
      expect(el.querySelector('app-tables-service-view')).toBeNull();
    });

    it('renders no Floor/Setup toggle and no button at all', () => {
      const el = render(false);
      expect(el.querySelector('app-dn-segmented')).toBeNull();
      expect(el.querySelectorAll('button').length).toBe(0);
      const text = el.textContent ?? '';
      expect(text).not.toContain('Floor');
      expect(text).not.toContain('Service View');
      expect(text).not.toContain('Setup View');
    });

    it('a persisted "service" selection cannot reach the floor', () => {
      const el = render(false, 'service');
      expect(el.querySelector('app-tables-service-view')).toBeNull();
      expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeTruthy();
    });

    it('still renders the page heading', () => {
      expect(render(false).querySelector('h1')?.textContent).toContain('Tables');
    });
  });

  describe('a development build (the mock preview)', () => {
    it('renders the Floor/Setup toggle and opens on Setup', () => {
      const el = render(true);
      const tabs = Array.from(el.querySelectorAll('app-dn-segmented [role="tab"]')).map(t => t.textContent?.trim());
      expect(tabs).toEqual(['Floor', 'Setup']);
      expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeTruthy();
    });

    it('switches to the floor from the toggle', () => {
      const el = render(true);
      const floorTab = Array.from(el.querySelectorAll<HTMLElement>('app-dn-segmented [role="tab"]')).find(
        t => t.textContent?.trim() === 'Floor',
      )!;
      floorTab.click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="service-view-stub"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeNull();
    });
  });

  it('once mock data is off (FE-C), a production build shows the toggle', () => {
    FloorService.USE_MOCK_DATA = false;
    const el = render(false);
    expect(el.querySelector('app-dn-segmented')).not.toBeNull();
  });
});
