import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { RestaurantDetail } from 'src/app/_models/app.models';

import {
  SectionPageComponent,
  SectionPageState,
} from '../components/section-page/section-page.component';
import {
  RestaurantTaxReceiptsService,
  TaxReceiptsFieldsPayload,
} from 'src/app/_services/restaurant-tax-receipts.service';

/** Backend DecimalField default for an unset VAT rate. */
const DEFAULT_VAT_RATE = 18;

/**
 * Tax & receipts — the Settings section that stores a restaurant's VAT/tax
 * config and the custom footer printed on receipts. Edits four fields inside the
 * shared section-page scaffold: `vat_registered` (toggle), `vat_rate` (revealed
 * only when registered — the rate is meaningless otherwise), `tin` (always shown:
 * a Ugandan business can hold a TIN without being VAT-registered), and the free
 * `receipt_footer`. Owner-only: the restaurant is resolved from the authenticated
 * membership, never a route param.
 *
 * Mirrors the Identity section's load/save lifecycle. This section only stores
 * the config — applying the rate to totals or rendering the footer is the
 * order/receipt pipeline (separate).
 */
@Component({
  selector: 'app-tax-receipts',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SectionPageComponent,
    SwitchComponent,
  ],
  templateUrl: './tax-receipts.component.html',
})
export class TaxReceiptsComponent implements OnInit {
  loadState: SectionPageState = 'loading';
  saving = false;

  form!: FormGroup;

  private restaurantId = '';
  private loadedDetail?: RestaurantDetail;

  constructor(
    private fb: FormBuilder,
    private auth: AuthenticationService,
    private svc: RestaurantTaxReceiptsService,
    private toast: ToastService,
  ) {
    this.form = this.buildForm();
  }

  ngOnInit(): void {
    this.restaurantId = this.auth.currentRestaurantRole?.restaurant_id ?? '';
    if (!this.restaurantId) {
      this.loadState = 'error';
      return;
    }
    this.load();
  }

  // ── Form ─────────────────────────────────────────────────────────────────

  private buildForm(): FormGroup {
    return this.fb.group({
      vat_registered: [false],
      // Validators are applied/cleared by syncRateValidators based on registration.
      vat_rate: [DEFAULT_VAT_RATE],
      tin: ['', Validators.maxLength(50)],
      receipt_footer: ['', Validators.maxLength(255)],
    });
  }

  /** Drives the scaffold's sticky save bar. */
  get isDirty(): boolean {
    return this.form.dirty;
  }

  /** Gates the VAT rate field — shown/enabled only when registered. */
  get vatRegistered(): boolean {
    return !!this.form.get('vat_registered')?.value;
  }

  get receiptFooterLength(): number {
    return (this.form.get('receipt_footer')?.value ?? '').length;
  }

  get rateInvalid(): boolean {
    const c = this.form.get('vat_rate');
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  /** Shared input styling; swaps to a red ring when the field is invalid. */
  fieldClass(invalid = false): string {
    return (
      'block w-full rounded-md border px-3 py-2 text-sm text-gray-900 ' +
      'placeholder:text-gray-400 focus:outline-none focus:ring-1 ' +
      (invalid
        ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
        : 'border-gray-300 focus:border-primary focus:ring-primary')
    );
  }

  /**
   * The VAT rate only matters when registered, so its validators are conditional:
   * an unregistered (hidden) rate must never block the save. Required + 0–100 with
   * up to two decimals when registered; none otherwise.
   */
  private syncRateValidators(registered: boolean): void {
    const ctrl = this.form.get('vat_rate');
    if (!ctrl) return;
    if (registered) {
      ctrl.setValidators([
        Validators.required,
        Validators.min(0),
        Validators.max(100),
        Validators.pattern(/^\d+(\.\d{1,2})?$/),
      ]);
    } else {
      ctrl.clearValidators();
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  // ── Load / populate ──────────────────────────────────────────────────────

  load(): void {
    this.loadState = 'loading';
    this.svc.getDetail(this.restaurantId).subscribe({
      next: (detail) => {
        this.populate(detail);
        this.loadState = 'ready';
      },
      error: () => {
        this.loadState = 'error';
      },
    });
  }

  retry(): void {
    this.load();
  }

  private populate(detail: RestaurantDetail): void {
    this.loadedDetail = detail;
    const registered = detail.vat_registered ?? false;
    this.form.reset({
      vat_registered: registered,
      vat_rate: detail.vat_rate != null ? Number(detail.vat_rate) : DEFAULT_VAT_RATE,
      tin: detail.tin ?? '',
      receipt_footer: detail.receipt_footer ?? '',
    });
    this.syncRateValidators(registered);
    this.form.markAsPristine();
  }

  // ── Toggle ───────────────────────────────────────────────────────────────

  onVatRegisteredToggle(value: boolean): void {
    // The switch is not a ControlValueAccessor — set the control by hand.
    const ctrl = this.form.get('vat_registered');
    ctrl?.setValue(value);
    ctrl?.markAsDirty();
    this.syncRateValidators(value);
  }

  // ── Save / discard ─────────────────────────────────────────────────────────

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Please fix the highlighted fields.');
      return;
    }

    this.saving = true;
    this.svc.save(this.buildPayload()).subscribe({
      next: () => this.onSaveSuccess(),
      error: () => {
        this.saving = false;
        // Clear the interceptor's queued toast so the user sees one clean
        // message, not two (matches the Identity/Availability error pattern).
        this.toast.clear();
        this.toast.error('Could not save your changes. Please try again.');
      },
    });
  }

  onDiscard(): void {
    if (this.loadedDetail) {
      this.populate(this.loadedDetail);
    }
  }

  private onSaveSuccess(): void {
    this.toast.success('Changes saved');
    // Re-fetch so the state reflects the server's canonical values, then reset
    // the dirty state. Keeps the scaffold in 'ready' (no skeleton).
    this.svc.getDetail(this.restaurantId).subscribe({
      next: (detail) => {
        this.populate(detail);
        this.saving = false;
      },
      error: () => {
        // Save succeeded; only the refresh failed. Reset local dirty state.
        this.form.markAsPristine();
        this.saving = false;
      },
    });
  }

  private buildPayload(): TaxReceiptsFieldsPayload {
    const v = this.form.value;
    return {
      id: this.restaurantId,
      vat_registered: !!v.vat_registered,
      // Non-nullable (default 18.00) — always sent as a clean decimal string.
      vat_rate: this.cleanRate(v.vat_rate),
      tin: this.nullIfEmpty(v.tin),
      receipt_footer: this.nullIfEmpty(v.receipt_footer),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Format the rate as a clean decimal string for the DecimalField (no math). */
  private cleanRate(value: unknown): string {
    const n = Number(value);
    if (!isFinite(n) || n < 0) return String(DEFAULT_VAT_RATE);
    return String(n);
  }

  private nullIfEmpty(value: unknown): string | null {
    const s = (value ?? '').toString().trim();
    return s.length ? s : null;
  }
}
