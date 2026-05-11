import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { MenuItemTagSelectorComponent } from './menu-item-tag-selector.component';
import { RestaurantTagService } from 'src/app/_services/restaurant-tag.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { RestaurantTag } from 'src/app/_models/app.models';

function makeTag(overrides: Partial<RestaurantTag> = {}): RestaurantTag {
  return {
    id: 't-1',
    name: 'Vegan',
    category: 'dietary',
    icon: 'sprout',
    colour: 'green',
    filterable: true,
    display_order: 0,
    is_system_preset: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('MenuItemTagSelectorComponent', () => {
  let fixture: ComponentFixture<MenuItemTagSelectorComponent>;
  let component: MenuItemTagSelectorComponent;
  let tagApi: { list: jasmine.Spy; create: jasmine.Spy };

  beforeEach(async () => {
    tagApi = {
      list: jasmine.createSpy('list').and.returnValue(
        of([
          makeTag({ id: 't-1', name: 'Vegan' }),
          makeTag({ id: 't-2', name: 'Spicy', category: 'descriptor', colour: 'red', icon: 'flame' }),
          makeTag({ id: 't-3', name: 'Contains Dairy', category: 'allergen', colour: 'blue', icon: 'milk' }),
        ]),
      ),
      create: jasmine.createSpy('create').and.returnValue(
        of(makeTag({ id: 't-new', name: 'Crunchy', category: 'descriptor' })),
      ),
    };
    const toastStub = { success: () => {}, error: () => {}, info: () => {} };

    await TestBed.configureTestingModule({
      imports: [MenuItemTagSelectorComponent],
      providers: [
        { provide: RestaurantTagService, useValue: tagApi },
        { provide: ToastService, useValue: toastStub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MenuItemTagSelectorComponent);
    component = fixture.componentInstance;
    component.restaurantId = 'rest-1';
    component.selectedTagIds = [];
    fixture.detectChanges();
  });

  it('loads the catalog on init', () => {
    expect(tagApi.list).toHaveBeenCalledWith('rest-1');
    expect(component.catalog.length).toBe(3);
  });

  it('filters dropdown by case-insensitive name match', () => {
    component.query = 'VEG';
    expect(component.filteredDropdown.map((t) => t.name)).toEqual(['Vegan']);
  });

  it('hides already-selected tags from the dropdown', () => {
    component.selectedTagIds = ['t-1'];
    expect(component.filteredDropdown.map((t) => t.id)).not.toContain('t-1');
  });

  it('emits an updated selection when selecting a tag', () => {
    let emitted: string[] = [];
    component.selectedTagIdsChange.subscribe((ids) => (emitted = ids));
    component.selectTag(component.catalog[1]);
    expect(emitted).toEqual(['t-2']);
  });

  it('emits an updated selection when removing a tag', () => {
    component.selectedTagIds = ['t-1', 't-2'];
    let emitted: string[] = [];
    component.selectedTagIdsChange.subscribe((ids) => (emitted = ids));
    component.removeTag('t-1');
    expect(emitted).toEqual(['t-2']);
  });

  it('shows the "create new tag" affordance only when no exact match', () => {
    component.query = 'Vegan';
    expect(component.showCreateOption).toBeFalse();
    component.query = 'Crunchy';
    expect(component.showCreateOption).toBeTrue();
  });

  it('caps selection at 20 tags and toggles the at-capacity flag', () => {
    component.selectedTagIds = Array.from({ length: 20 }, (_, i) => `id-${i}`);
    expect(component.atCapacity).toBeTrue();
    expect(component.showCreateOption).toBeFalse();
  });

  it('inline-creates a tag and appends it to the selection', () => {
    component.query = 'Crunchy';
    component.openCreate();
    let emitted: string[] = [];
    component.selectedTagIdsChange.subscribe((ids) => (emitted = ids));
    component.onCreateSubmit({
      name: 'Crunchy',
      category: 'descriptor',
      colour: 'orange',
      icon: 'flame',
      filterable: false,
    });
    expect(tagApi.create).toHaveBeenCalled();
    expect(emitted).toEqual(['t-new']);
    expect(component.catalog.find((t) => t.id === 't-new')).toBeTruthy();
  });
});
