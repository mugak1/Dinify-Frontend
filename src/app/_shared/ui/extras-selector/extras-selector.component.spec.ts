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
});
