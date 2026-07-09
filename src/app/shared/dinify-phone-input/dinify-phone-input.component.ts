import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  forwardRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AutofillMonitor } from '@angular/cdk/text-field';
import { Subscription } from 'rxjs';
import { PHONE_COUNTRIES } from './phone-countries';

/**
 * Payload emitted on every change. Mirrors the fields the phone-input consumers
 * read across the app: login reads only `phoneNumber`; other surfaces also read
 * `iso2Code` and the validity hint.
 */
export interface DinifyPhoneChange {
  /** Canonical MSISDN — `dialCode + national` (e.g. '256755116061'), plus- and
   *  space-free. ALWAYS country-code-prefixed regardless of how the value was
   *  entered (national, trunk-'0', '+256', or autofilled full number), so
   *  consumers can use it directly as the login / lookup key. */
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
 * read validity via `@ViewChild`.
 *
 * The component owns the split between what is DISPLAYED and what is EMITTED:
 *  - DISPLAY (`value` / the input's text) is the NATIONAL number only — the
 *    static '+256' overlay is the ONLY country code shown, so a value that
 *    arrives already carrying '+256' / '256' / a leading '0' (autofill, paste,
 *    or a user typing it) never renders a double '+256'.
 *  - EMIT (`valueChange.phoneNumber` and the CVA value) is ALWAYS the canonical
 *    'dialCode + national' MSISDN, so login / lookups get a stable key however
 *    the value was entered.
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
export class DinifyPhoneInputComponent
  implements ControlValueAccessor, AfterViewInit, OnDestroy
{
  /** id of the inner <input> (for label association by the host). */
  @Input() inputId = 'phone';

  /** Emitted on every change. Consumers read `phoneNumber` (canonical MSISDN). */
  @Output() valueChange = new EventEmitter<DinifyPhoneChange>();

  /** The inner <input>, read directly for the defensive autofill reconcile. */
  @ViewChild('phoneField') private phoneField!: ElementRef<HTMLInputElement>;

  /** Active country, sourced from config (Uganda today). Drives the label, flag,
   *  validity length and emitted iso2Code — nothing is hard-coded in the logic. */
  readonly country = PHONE_COUNTRIES[0];

  /** What the user sees in the <input>. Kept raw WHILE typing so the caret never
   *  jumps; settled to the national number on blur and on every non-typing
   *  value-in path (writeValue / autofill / init). */
  value = '';

  /** Public validity hint — read by `@ViewChild` consumers. */
  isValid = false;

  disabled = false;

  private readonly autofill = inject(AutofillMonitor);
  private autofillSub?: Subscription;

  // ── ControlValueAccessor (formControlName support) ────────────────────────
  private propagateChange: (value: string) => void = () => {};
  private propagateTouched: () => void = () => {};

  writeValue(value: string | null): void {
    // Show the national number only; the canonical form is re-derived on the
    // next user change. No propagateChange here — that is the CVA contract.
    this.value = this.toNational(value ?? '');
    this.isValid = this.checkValid(this.value);
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

  // ── Autofill defence ──────────────────────────────────────────────────────
  // Safari may populate a saved credential WITHOUT firing an `input` event, so
  // `onInput` alone cannot be relied on. Read the DOM value once at init (covers
  // a value already present) and again whenever the field is autofilled, running
  // the same reconcile so the display de-dupes and the emit stays canonical.
  ngAfterViewInit(): void {
    const el = this.phoneField.nativeElement;
    if (el.value) {
      // Defer: emitting during the init change-detection pass would trip a
      // dev-mode ExpressionChangedAfterItHasBeenChecked in a parent bound to
      // the emit. The autofill callbacks below are already async.
      Promise.resolve().then(() => this.reconcileFromDom(el.value));
    }
    this.autofillSub = this.autofill.monitor(el).subscribe((e) => {
      if (e.isAutofilled) {
        this.reconcileFromDom(el.value);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.phoneField) {
      this.autofill.stopMonitoring(this.phoneField.nativeElement);
    }
    this.autofillSub?.unsubscribe();
  }

  // ── Input handling ────────────────────────────────────────────────────────
  onInput(raw: string): void {
    // Keep the shown text exactly as typed (no mid-keystroke reformat) so the
    // caret never jumps; the EMIT is canonicalised on every keystroke.
    this.value = raw;
    this.reconcileAndEmit(raw);
  }

  onBlur(): void {
    // Typing is done — settle the display to the national number (drops any
    // '+256' / leading '0' the user typed). Caret is irrelevant here; the emit
    // already fired canonically on the last keystroke, so no re-emit is needed.
    this.value = this.toNational(this.value);
    this.propagateTouched();
  }

  /** Reconcile the display to national AND emit canonical from a raw DOM value —
   *  used by the autofill / init path where there is no active typing. */
  private reconcileFromDom(raw: string): void {
    this.value = this.toNational(raw);
    this.reconcileAndEmit(raw);
  }

  /** Recompute validity and emit the canonical MSISDN for any raw input. */
  private reconcileAndEmit(raw: string): void {
    const national = this.toNational(raw);
    const canonical = this.toEmit(national);
    this.isValid = this.checkValid(national);
    this.propagateChange(canonical);
    this.valueChange.emit({
      phoneNumber: canonical,
      iso2Code: this.country.iso2,
      isValid: this.isValid,
    });
  }

  /**
   * Reduce any input (national, trunk-'0'-prefixed, '256' / '+256'-prefixed,
   * spaced or dashed) to the bare national digits. Config-driven — never a
   * hard-coded length or code. This is the single reduction that now drives
   * both the display and the emit (formerly private to the validity check).
   */
  private toNational(raw: string): string {
    let digits = String(raw).replace(/\D/g, '');
    if (digits.startsWith(this.country.dialCode)) {
      digits = digits.slice(this.country.dialCode.length);
    } else if (digits.startsWith('0')) {
      digits = digits.slice(1);
    }
    return digits;
  }

  /** Canonical MSISDN for emit: `dialCode + national`. Empty stays empty so an
   *  empty field never emits a bare '256'. */
  private toEmit(national: string): string {
    return national ? this.country.dialCode + national : '';
  }

  /** Completeness hint: exactly `country.nationalLength` national digits. */
  private checkValid(national: string): boolean {
    return national.length === this.country.nationalLength;
  }
}
