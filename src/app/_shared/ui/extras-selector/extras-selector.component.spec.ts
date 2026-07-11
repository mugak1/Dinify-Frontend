import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ExtrasSelectorComponent, ExtraOption } from './extras-selector.component';

const EXTRAS: ExtraOption[] = [
  { id: 'e1', name: 'Cheese', effectivePrice: 1000, originalPrice: 1000, isDiscounted: false },
  { id: 'e2', name: 'Bacon', effectivePrice: 800, originalPrice: 1000, isDiscounted: true },
];

describe('ExtrasSelectorComponent', () => {
  let fixture: ComponentFixture<ExtrasSelectorComponent>;
  let component: ExtrasSelectorComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ExtrasSelectorComponent] }).compileComponents();
    fixture = TestBed.createComponent(ExtrasSelectorComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('reflects selection and renders the discounted-extra struck price pair', () => {
    component.extras = EXTRAS;
    component.selectedIds = ['e1'];
    fixture.detectChanges();
    expect(component.isSelected('e1')).toBe(true);
    expect(component.isSelected('e2')).toBe(false);
    expect(host.textContent).toContain('Cheese');
    expect(host.textContent).toContain('Bacon');
    expect(host.textContent).toContain('+UGX 800'); // discounted effective
    expect(host.textContent).toContain('UGX 1,000'); // struck original
  });

  it('never reports at-max when there is no ceiling (maxSelections 0)', () => {
    component.extras = EXTRAS;
    component.selectedIds = ['e1', 'e2'];
    component.maxSelections = 0;
    expect(component.atMax).toBe(false);
  });

  it('reports at-max once the ceiling is reached', () => {
    component.extras = EXTRAS;
    component.selectedIds = ['e1'];
    component.maxSelections = 1;
    expect(component.atMax).toBe(true);
  });

  it('emits toggled with the extra id on tap', () => {
    const spy = jasmine.createSpy('toggled');
    component.toggled.subscribe(spy);
    component.extras = EXTRAS;
    fixture.detectChanges();
    (host.querySelector('label') as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith('e1');
  });

  it('renders native checkboxes reflecting selection and disables over-cap extras', () => {
    component.extras = EXTRAS;
    component.selectedIds = ['e1'];
    component.maxSelections = 1;
    fixture.detectChanges();
    const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes.length).toBe(2);
    expect(boxes[0].checked).toBeTrue(); // e1 selected
    expect(boxes[1].disabled).toBeTrue(); // e2 blocked at the cap
  });

  it('exposes the extras list as a labelled group', () => {
    component.extras = EXTRAS;
    fixture.detectChanges();
    const g = host.querySelector('[role="group"]')!;
    expect(g.getAttribute('aria-labelledby')).toBe('extras-selector-label');
    expect(host.querySelector('#extras-selector-label')).toBeTruthy();
  });

  it('styles the Optional badge as muted, not alarm red', () => {
    component.extras = EXTRAS;
    component.required = false;
    fixture.detectChanges();
    const badge = Array.from(host.querySelectorAll('span')).find((s) => s.textContent?.trim() === 'Optional')!;
    expect(badge).toBeTruthy();
    expect(badge.className).not.toContain('bg-red-600');
    expect(badge.className).toContain('bg-gray-100');
  });
});
