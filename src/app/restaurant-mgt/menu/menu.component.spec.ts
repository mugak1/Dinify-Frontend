import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MenuComponent } from './menu.component';
import { WINDOW } from 'src/app/_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from 'src/app/_services/storage/storage-key-prefix.token';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MenuService } from './services/menu.service';
import { TagService } from './services/tag.service';
import { UpsellService } from './services/upsell.service';

describe('MenuComponent', () => {
  let component: MenuComponent;
  let fixture: ComponentFixture<MenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MenuComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'dinify' },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();

    fixture = TestBed.createComponent(MenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// The restaurant-management menu editor is also the source the live preview
// drawer renders from (PreviewMenuDrawerComponent reads MenuService's in-memory
// data — it never calls the anonymous public endpoint with a query flag). So the
// authorised load MUST target the SELECTED restaurant membership, not
// restaurant_roles[0] — the tenant-isolation contract (cf. TENANT-P3-05 for the
// kitchen services).
describe('MenuComponent restaurant scoping (tenant isolation)', () => {
  // A member of two restaurants who selected their SECOND at login.
  const SELECTED = 'selected-r2';
  const FIRST_MEMBERSHIP = 'first-r1';

  const authStub = {
    currentRestaurantRole: { restaurant_id: SELECTED },
    currentRestaurant: { id: SELECTED },
    userValue: {
      profile: {
        restaurant_roles: [
          { restaurant_id: FIRST_MEMBERSHIP },
          { restaurant_id: SELECTED },
        ],
      },
    },
  };

  let menuService: MenuService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MenuComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'dinify' },
        { provide: AuthenticationService, useValue: authStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    // Spy on the authorised load methods BEFORE the component constructs, so no
    // real request fires and we capture exactly which restaurant the editor scopes to.
    menuService = TestBed.inject(MenuService);
    spyOn(menuService, 'loadSections');
    spyOn(menuService, 'loadAllItems');
    spyOn(TestBed.inject(TagService), 'loadPresetTags');
    spyOn(TestBed.inject(UpsellService), 'loadConfig');
  });

  it('loads the authorised menu for the selected restaurant, not restaurant_roles[0]', () => {
    TestBed.createComponent(MenuComponent).detectChanges();

    expect(menuService.loadSections).toHaveBeenCalledWith(SELECTED);
    expect(menuService.loadAllItems).toHaveBeenCalledWith(SELECTED);
    expect(menuService.loadSections).not.toHaveBeenCalledWith(FIRST_MEMBERSHIP);
    expect(menuService.loadAllItems).not.toHaveBeenCalledWith(FIRST_MEMBERSHIP);
  });
});
