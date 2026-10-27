import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  inject,
  isDevMode,
} from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';

/**
 * One text field for a one-time code.
 *
 * It used to be one box per digit. A single field is what the platform's
 * code autofill (`autocomplete="one-time-code"`) fills in one go, and a paste
 * needs no handling beyond keeping the digits. Whatever arrives (typed,
 * pasted or autofilled) is reduced to its digits and cut to `size`, so
 * "Your code is 1234." becomes 1234. The value is published as a plain
 * string of digits and is valid once it holds exactly `size` of them.
 */
@Component({
    selector: 'app-otp-input',
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: OtpInputComponent,
            multi: true,
        },
        {
            provide: NG_VALIDATORS,
            useExisting: OtpInputComponent,
            multi: true,
        },
    ],
    templateUrl: './otp-input.component.html',
    styleUrls: ['./otp-input.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class OtpInputComponent implements ControlValueAccessor, Validator {
  readonly #cdr = inject(ChangeDetectorRef);

  @Input() size = 4;

  value = '';
  disabled = false;

  onChange?: (value: string) => void;
  onTouched?: (() => void)|any;

  writeValue(value: string): void {
    if (isDevMode() && value?.length) {
      throw new Error('Otp input is not supposed to be prefilled with data');
    }

    this.value = '';
    this.#cdr.markForCheck();
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.#cdr.markForCheck();
  }

  validate(control: AbstractControl<string, string>): ValidationErrors | null {
    if (!new RegExp(`^\\d{${this.size}}$`).test(control.value ?? '')) {
      return {
        otpInput: 'Value is incorrect',
      };
    }

    return null;
  }

  handleInput(e: Event) {
    const el = e.target as HTMLInputElement;
    const digits = el.value.replace(/\D/g, '').slice(0, this.size);

    // Write back only when something was dropped, so an edit in the middle of
    // the code keeps its caret where it is.
    if (el.value !== digits) {
      el.value = digits;
    }

    this.value = digits;
    this.onChange?.(digits);
  }
}
