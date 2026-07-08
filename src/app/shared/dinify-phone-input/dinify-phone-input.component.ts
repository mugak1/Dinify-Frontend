import { Component, EventEmitter, Input, Output, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { PHONE_COUNTRIES } from './phone-countries';

/**
 * Payload emitted on every change. Mirrors the fields the phone-input consumers
 * read across the app: login reads only `phoneNumber`; other surfaces (a later
 * PR) also read `iso2Code` and the validity hint.
 */
export interface DinifyPhoneChange {
  /** Plus-free, space-free phone string. The backend is authoritative on the
   *  canonical MSISDN format, so this is handed up clean but NOT 256-prefixed. */
  phoneNumber: string;
  /** Active country ISO code (e.g. 'UG'). */
  iso2Code: string;
  /** Client-side completeness hint — a HINT, not a gate (backend validates). */
  isValid: boolean;
}

/**
 * Uganda-only phone input rendered as a static '+256' prefix + a local flag
 * (no dropdown / picker / remote sprite). Designed to serve every phone-input
 * consumer: it emits `(valueChange)`, is a reactive-forms `ControlValueAccessor`
 * (`formControlName`), and exposes `isValid` as a public property for hosts that
 * read validity via `@ViewChild`. Only login is wired to it for now.
 */
@Component({
  selector: 'app-dinify-phone-input',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dinify-phone-input.component.html',
  styleUrls: ['./dinify-phone-input.component.css'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DinifyPhoneInputComponent),
      multi: true,
    },
  ],
})
export class DinifyPhoneInputComponent implements ControlValueAccessor {
  /** id of the inner <input> (for label association by the host). */
  @Input() inputId = 'phone';

  /** Emitted on every change. Login binds this; it ignores everything but `phoneNumber`. */
  @Output() valueChange = new EventEmitter<DinifyPhoneChange>();

  /** Active country, sourced from config (Uganda today). Drives the label, flag,
   *  validity length and emitted iso2Code — nothing is hard-coded in the logic. */
  readonly country = PHONE_COUNTRIES[0];

  /** What the user sees in the <input> (kept raw so typing never jumps the caret). */
  value = '';

  /** Public validity hint — read by `@ViewChild` consumers. */
  isValid = false;

  disabled = false;

  // ── ControlValueAccessor (formControlName support) ────────────────────────
  private propagateChange: (value: string) => void = () => {};
  private propagateTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.value = value ?? '';
    this.isValid = this.checkValid(this.strip(this.value));
  }
  registerOnChange(fn: (value: string) => void): void {
    this.propagateChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.propagateTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  // ── Input handling ────────────────────────────────────────────────────────
  onInput(raw: string): void {
    this.value = raw;
    const clean = this.strip(raw);
    this.isValid = this.checkValid(clean);
    this.propagateChange(clean);
    this.valueChange.emit({
      phoneNumber: clean,
      iso2Code: this.country.iso2,
      isValid: this.isValid,
    });
  }

  onBlur(): void {
    this.propagateTouched();
  }

  /** Strip '+' and all whitespace — matches the app's existing phone cleaning. */
  private strip(value: string): string {
    return String(value).replace(/\+/g, '').replace(/\s/g, '');
  }

  /**
   * Completeness hint, config-driven (never a hard-coded length): reduce to
   * digits, drop a leading country code or trunk '0', then require exactly
   * `country.nationalLength` national digits. The backend remains authoritative.
   */
  private checkValid(clean: string): boolean {
    const digits = clean.replace(/\D/g, '');
    let national = digits;
    if (national.startsWith(this.country.dialCode)) {
      national = national.slice(this.country.dialCode.length);
    } else if (national.startsWith('0')) {
      national = national.slice(1);
    }
    return national.length === this.country.nationalLength;
  }
}
