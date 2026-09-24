import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { WINDOW } from '../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../_services/storage/storage-key-prefix.token';
import { MenuItemDetailComponent } from './menu-item-detail.component';
import { MenuNavStateService } from '../menu/menu-nav-state.service';
import { AllergenInfoLinkComponent } from '../../_shared/ui/allergen-info/allergen-info-link.component';
import { AllergenInfoSheetComponent } from '../../_shared/ui/allergen-info/allergen-info-sheet.component';
import { TagPillComponent } from '../../_shared/tags/tag-pill.component';

/**
 * The allergen guidance on the diner item page, driven through the REAL
 * template, the real link and pop-up, and the page's own item lookup.
 *
 * What it replaced: an amber banner rendered only when the dish had at least
 * one tag. A dish with none, which in practice meant many dishes sold with
 * modifiers and extras, showed no allergen guidance at all.
 */
const VEG = { id: 'tg-veg', name: 'Vegetarian', category: 'dietary', icon: 'leaf', colour: 'green' };
const GLUTEN = { id: 'tg-glu', name: 'Contains Gluten', category: 'allergen', icon: 'wheat', colour: 'amber' };

const base = {
  primary_price: '10000', current_price: '10000.00', is_discount_active: false,
  available: true, in_stock: true, image: null, description: 'A dish.', calories: null,
  options: null, extras: [], tags: [],
};
const DISHES: Record<string, any> = {
  // A plain dish with a dietary tag: the banner's only case.
  avocado: { ...base, id: 'avocado', name: 'Avocado Toast', tags: [VEG] },
  // Extras and NO tags: the dish the banner never reached.
  ribs: { ...base, id: 'ribs', name: 'BBQ Ribs', extras_min_selections: 1, extras_max_selections: 1,
    extras: [{ id: 'x1', name: 'Cola', primary_price: '5000', current_price: '5000.00' }] },
  // Modifiers and an allergen tag.
  burger: { ...base, id: 'burger', name: 'Cheese Burger', tags: [GLUTEN],
    options: { hasModifiers: true, groups: [{ id: 'g1', name: 'Cook', selectionType: 'single',
      minSelections: 1, maxSelections: 1,
      choices: [{ id: 'c1', name: 'Medium', additionalCost: 0, available: true }] }] } },
};

describe('MenuItemDetailComponent: allergen information', () => {
  let fixture: ComponentFixture<MenuItemDetailComponent>;
  let component: MenuItemDetailComponent;
  let root: HTMLElement;

  async function open(itemId: string): Promise<void> {
    await TestBed.configureTestingModule({
      declarations: [MenuItemDetailComponent],
      imports: [AllergenInfoLinkComponent, AllergenInfoSheetComponent, TagPillComponent],
      providers: [
        provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: ActivatedRoute, useValue: { snapshot: {
          paramMap: convertToParamMap({ table: 't1', itemId }),
          queryParamMap: convertToParamMap({}),
        } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    // Warm path: the menu is already in the shared store, so the page resolves
    // the dish exactly as it does after a tap from the menu.
    TestBed.inject(MenuNavStateService).setMenuList([{ id: 's1', name: 'Mains', items: Object.values(DISHES) }]);
    fixture = TestBed.createComponent(MenuItemDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    expect(component.item()?.id).withContext('premise: the page resolved the dish').toBe(itemId);
  }

  const link = () => root.querySelector<HTMLButtonElement>('app-allergen-info-link button');
  const dialog = () => root.querySelector<HTMLElement>('[role="dialog"]');
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  for (const id of Object.keys(DISHES)) {
    it(`THE LINK IS ON EVERY DISH: ${id}`, async () => {
      await open(id);
      expect(text(link())).toBe('Allergens & dietary info');
    });
  }

  it('REGRESSION: a dish with extras and no tags gets the link and the full guidance', async () => {
    await open('ribs');
    link()!.click();
    fixture.detectChanges();
    expect(text(dialog())).toContain('Food allergies? Please ask restaurant staff to confirm before ordering.');
    expect(root.querySelector('[data-testid="allergen-none-flagged"]')).not.toBeNull();
  });

  it('the old always-open amber banner is gone: its sentence appears only inside the pop-up', async () => {
    await open('avocado');
    expect(text(root)).not.toContain('Food allergies?');
    link()!.click();
    fixture.detectChanges();
    expect(text(dialog())).toContain('Food allergies?');
  });

  it('THE POP-UP IS MOUNTED OUTSIDE THE CONTENT SHEET, whose z-[2] stacking context would bury it under the brand strip', async () => {
    await open('burger');
    const contentSheet = link()!.closest('[class~="z-[2]"]');
    expect(contentSheet).withContext('premise: the link lives in the z-[2] content sheet').not.toBeNull();
    link()!.click();
    fixture.detectChanges();
    expect(dialog()).not.toBeNull();
    expect(contentSheet!.contains(dialog())).toBe(false);
    expect(dialog()!.closest('[class~="z-[2]"]')).toBeNull();
  });

  it('the pop-up lists the tags the page shows, allergens and dietary alike', async () => {
    await open('burger');
    link()!.click();
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll('[data-testid="allergen-tags"] app-tag-pill')).map(text))
      .toEqual(['Contains Gluten']);
  });

  it('says the guidance covers the dish on its own for extras AND for modifiers, and not for a plain dish', async () => {
    for (const [id, expected] of [['ribs', true], ['burger', true], ['avocado', false]] as const) {
      TestBed.resetTestingModule();
      await open(id);
      link()!.click();
      fixture.detectChanges();
      expect(!!root.querySelector('[data-testid="allergen-choices-note"]')).withContext(id).toBe(expected);
    }
  });

  it('closing hands the page back, and the link opens it again', async () => {
    await open('avocado');
    link()!.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('button[aria-label="Close allergen information"]')!.click();
    fixture.detectChanges();
    expect(component.allergenInfoOpen()).toBe(false);
    expect(dialog()).toBeNull();
    link()!.click();
    fixture.detectChanges();
    expect(dialog()).not.toBeNull();
  });

  it('THE TAG ROW KEEPS ITS PILLS across change detection instead of re-creating them every pass', async () => {
    await open('avocado');
    const pill = root.querySelector('app-tag-pill');
    expect(text(pill)).toBe('Vegetarian');
    fixture.detectChanges();
    fixture.detectChanges();
    expect(root.querySelector('app-tag-pill')).toBe(pill);
    expect(component.itemTags()).toBe(component.itemTags());
  });
});
