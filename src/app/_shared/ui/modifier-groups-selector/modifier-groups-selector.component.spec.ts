import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModifierGroupsSelectorComponent } from './modifier-groups-selector.component';
import { ModifierGroup } from 'src/app/_models/app.models';

function group(overrides: Partial<ModifierGroup> = {}): ModifierGroup {
  return {
    id: 'g1',
    name: 'Size',
    required: true,
    selectionType: 'single',
    minSelections: 1,
    maxSelections: 1,
    choices: [
      { id: 'c1', name: 'Small', additionalCost: 0, available: true },
      { id: 'c2', name: 'Large', additionalCost: 1000, available: true },
    ],
    ...overrides,
  };
}

describe('ModifierGroupsSelectorComponent', () => {
  let fixture: ComponentFixture<ModifierGroupsSelectorComponent>;
  let component: ModifierGroupsSelectorComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModifierGroupsSelectorComponent] }).compileComponents();
    fixture = TestBed.createComponent(ModifierGroupsSelectorComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('reflects the selected map, the constraint phrase and the Required badge', () => {
    component.groups = [group()];
    component.selected = { g1: ['c2'] };
    fixture.detectChanges();
    expect(component.isSelected('g1', 'c2')).toBe(true);
    expect(component.isSelected('g1', 'c1')).toBe(false);
    expect(component.selectedCount('g1')).toBe(1);
    expect(component.constraintLabel(group())).toBe('Select 1');
    expect(host.textContent).toContain('Required');
  });

  it('renders an inline error from the errors map', () => {
    component.groups = [group()];
    component.errors = { g1: 'Please select an option' };
    fixture.detectChanges();
    expect(host.textContent).toContain('Please select an option');
  });

  it('emits singleSelect on a single-choice tap', () => {
    const spy = jasmine.createSpy('singleSelect');
    component.singleSelect.subscribe(spy);
    component.groups = [group()];
    fixture.detectChanges();
    (host.querySelector('label') as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith({ groupId: 'g1', choiceId: 'c1' });
  });

  it('emits multiToggle (with the would-be checked state + cap) on a multi-choice tap', () => {
    const spy = jasmine.createSpy('multiToggle');
    component.multiToggle.subscribe(spy);
    component.groups = [group({ selectionType: 'multiple', minSelections: 0, maxSelections: 2 })];
    fixture.detectChanges();
    (host.querySelector('label') as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith({ groupId: 'g1', choiceId: 'c1', checked: true, maxSelections: 2 });
  });
});
