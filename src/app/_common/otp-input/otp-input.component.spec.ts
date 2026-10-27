import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormsModule, NgModel, ReactiveFormsModule } from '@angular/forms';
import { OtpInputComponent } from './otp-input.component';

/** Bound the way every screen binds it: `[(ngModel)]` with a template ref. */
@Component({
  template: `<app-otp-input #code="ngModel" [(ngModel)]="data" [ngModelOptions]="{standalone: true}" [size]="size"/>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
class NgModelHostComponent {
  @ViewChild('code') code!: NgModel;
  data = '';
  size = 4;
}

@Component({
  template: `<app-otp-input [formControl]="control"/>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
class FormControlHostComponent {
  control = new FormControl('');
}

describe('OtpInputComponent', () => {
  let fixture: ComponentFixture<NgModelHostComponent>;
  let host: NgModelHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [OtpInputComponent, NgModelHostComponent, FormControlHostComponent],
      imports: [FormsModule, ReactiveFormsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(NgModelHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    // NgModel writes the initial value in a microtask.
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const inputs = (): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('app-otp-input input'));
  const field = (): HTMLInputElement => inputs()[0];

  /** Puts `text` in the field the way typing, a paste or autofill does. */
  function enter(text: string): void {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('renders ONE field for the whole code, not a box per digit', () => {
    expect(inputs().length).toBe(1);
  });

  it('offers the code to platform autofill and asks for a numeric keypad', () => {
    expect(field().getAttribute('autocomplete')).toBe('one-time-code');
    expect(field().getAttribute('inputmode')).toBe('numeric');
    expect(field().getAttribute('aria-label')).toBe('One-time code');
    expect(field().placeholder).toBe('Enter the 4-digit code');
  });

  it('publishes the typed code as the model value', () => {
    enter('12');
    expect(host.data).toBe('12');
    enter('1234');
    expect(host.data).toBe('1234');
  });

  it('keeps only digits, in the field as well as the model', () => {
    enter('1a2 3-');
    expect(field().value).toBe('123');
    expect(host.data).toBe('123');
  });

  it('takes the code out of a pasted or autofilled message', () => {
    enter('Your Dinify code is 1234. It expires in 5 minutes.');
    expect(field().value).toBe('1234');
    expect(host.data).toBe('1234');
  });

  it('never holds more digits than the code has', () => {
    enter('123456');
    expect(field().value).toBe('1234');
    expect(host.data).toBe('1234');
  });

  it('is invalid until the whole code is entered', () => {
    expect(host.code.invalid).withContext('empty').toBeTrue();
    enter('123');
    expect(host.code.invalid).withContext('three digits').toBeTrue();
    enter('1234');
    expect(host.code.valid).withContext('four digits').toBeTrue();
  });

  it('empties the field when the screen clears the code (after a rejected code)', async () => {
    enter('1234');
    host.data = '';
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(field().value).toBe('');
    expect(host.code.invalid).toBeTrue();
  });

  it('follows the size it is given', async () => {
    host.size = 6;
    fixture.detectChanges();
    expect(field().placeholder).toBe('Enter the 6-digit code');
    enter('1234567');
    expect(host.data).toBe('123456');
    host.code.control.updateValueAndValidity();
    expect(host.code.valid).toBeTrue();
  });

  it('marks the control touched when the field loses focus', () => {
    expect(host.code.touched).toBeFalse();
    field().dispatchEvent(new Event('blur'));
    expect(host.code.touched).toBeTrue();
  });

  it('disables the field with its control', () => {
    const formFixture = TestBed.createComponent(FormControlHostComponent);
    formFixture.detectChanges();
    const input = formFixture.nativeElement.querySelector('app-otp-input input') as HTMLInputElement;
    expect(input.disabled).toBeFalse();

    formFixture.componentInstance.control.disable();
    formFixture.detectChanges();
    expect(input.disabled).toBeTrue();

    formFixture.componentInstance.control.enable();
    formFixture.detectChanges();
    expect(input.disabled).toBeFalse();
  });
});
