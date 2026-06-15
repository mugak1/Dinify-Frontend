import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup } from '@angular/forms';

import { OpeningHoursEditorComponent } from './opening-hours-editor.component';
import { OPENING_HOURS_DAYS } from '../../opening-hours.constants';

/** Mirrors the parent's per-day group shape (validator not needed for these tests). */
function buildForm(fb: FormBuilder): FormGroup {
  const groups: Record<string, FormGroup> = {};
  for (const d of OPENING_HOURS_DAYS) {
    groups[d.key] = fb.group({
      closed: [false],
      open: ['09:00'],
      close: ['17:00'],
    });
  }
  return fb.group(groups);
}

describe('OpeningHoursEditorComponent', () => {
  let component: OpeningHoursEditorComponent;
  let fixture: ComponentFixture<OpeningHoursEditorComponent>;
  let form: FormGroup;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpeningHoursEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OpeningHoursEditorComponent);
    component = fixture.componentInstance;
    form = buildForm(TestBed.inject(FormBuilder));
    component.form = form;
    fixture.detectChanges();
  });

  it('creates and exposes seven days', () => {
    expect(component).toBeTruthy();
    expect(component.days.length).toBe(7);
  });

  it('toggles closed while retaining the day\'s open/close times', () => {
    expect(component.isClosed('monday')).toBeFalse();

    component.onClosedToggle('monday', true);

    expect(component.isClosed('monday')).toBeTrue();
    expect(form.get('monday')!.get('open')!.value).toBe('09:00');
    expect(form.get('monday')!.get('close')!.value).toBe('17:00');
    expect(form.dirty).toBeTrue();
  });

  it('copies Monday hours + closed state to every other day', () => {
    form.get('monday')!.setValue({ closed: false, open: '07:30', close: '22:00' });

    component.copyMondayToAll();

    for (const d of component.days) {
      expect(form.get(d.key)!.value).toEqual({
        closed: false,
        open: '07:30',
        close: '22:00',
      });
    }
    expect(form.dirty).toBeTrue();
  });

  it('flags a row as invalid once it errors and is touched', () => {
    const tue = form.get('tuesday')!;
    expect(component.isRowInvalid('tuesday')).toBeFalse();

    tue.setErrors({ closeBeforeOpen: true });
    tue.markAsTouched();

    expect(component.isRowInvalid('tuesday')).toBeTrue();
  });
});
