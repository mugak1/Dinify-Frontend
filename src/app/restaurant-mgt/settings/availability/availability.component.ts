import { Component, OnInit } from '@angular/core';

import { HasUnsavedChanges } from '../../../_helpers/unsaved-changes.guard';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';

import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import {
  DayHours,
  OpeningHours,
  OpeningHoursDay,
  RestaurantDetail,
} from 'src/app/_models/app.models';

import {
  SectionPageComponent,
  SectionPageState,
} from '../components/section-page/section-page.component';
import { RestaurantAvailabilityService } from 'src/app/_services/restaurant-availability.service';
import { OpeningHoursEditorComponent } from './components/opening-hours-editor/opening-hours-editor.component';
import {
  DEFAULT_DAY_HOURS,
  OPENING_HOURS_DAYS,
} from './opening-hours.constants';

/**
 * A day's interval is invalid when it's open and closing isn't strictly after
 * opening (or a time is missing). 24-hour "HH:MM" strings are zero-padded, so a
 * plain lexicographic compare is correct. Closed days are always valid.
 */
function closeAfterOpen(group: AbstractControl): ValidationErrors | null {
  if (group.get('closed')?.value) return null;
  const open = group.get('open')?.value as string;
  const close = group.get('close')?.value as string;
  if (!open || !close || close <= open) return { closeBeforeOpen: true };
  return null;
}

/**
 * Availability — the Settings section that controls when the restaurant takes
 * orders. Two labelled groups inside the shared section-page scaffold: "Ordering"
 * (the `accepting_orders` toggle) and "Opening hours" (the weekly schedule wired
 * to `opening_hours`). Owner-only: the restaurant is resolved from the
 * authenticated membership, never a route param.
 *
 * The toggle stays a plain boolean (`app-dn-switch` is not a ControlValueAccessor),
 * so its dirty state is a value comparison; the hours editor is a reactive form
 * (close-after-open validation) like Tax & receipts. The save bar's dirty/validity
 * is the union of both, and a single JSON PUT carries both fields.
 */
@Component({
  selector: 'app-availability',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    SectionPageComponent,
    SwitchComponent,
    OpeningHoursEditorComponent
],
  templateUrl: './availability.component.html',
})
export class AvailabilityComponent implements OnInit, HasUnsavedChanges {
  loadState: SectionPageState = 'loading';
  saving = false;

  /** Staged toggle value bound to the switch. */
  acceptingOrders = true;
  /** Last loaded/saved value — drives the toggle's dirty comparison. */
  private loadedAcceptingOrders = true;

  /** Weekly opening hours — a control per day, each `{ closed, open, close }`. */
  hoursForm: FormGroup;

  private restaurantId = '';
  private loadedDetail?: RestaurantDetail;

  constructor(
    private fb: FormBuilder,
    private auth: AuthenticationService,
    private svc: RestaurantAvailabilityService,
    private toast: ToastService,
  ) {
    this.hoursForm = this.buildHoursForm();
  }

  ngOnInit(): void {
    this.restaurantId = this.auth.currentRestaurantRole?.restaurant_id ?? '';
    if (!this.restaurantId) {
      this.loadState = 'error';
      return;
    }
    this.load();
  }

  /** Drives the scaffold's sticky save bar — true if either group changed. */
  get isDirty(): boolean {
    return (
      this.acceptingOrders !== this.loadedAcceptingOrders || this.hoursForm.dirty
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  private buildHoursForm(): FormGroup {
    const groups: Record<string, FormGroup> = {};
    for (const d of OPENING_HOURS_DAYS) {
      groups[d.key] = this.fb.group(
        {
          closed: [DEFAULT_DAY_HOURS.closed],
          open: [DEFAULT_DAY_HOURS.open],
          close: [DEFAULT_DAY_HOURS.close],
        },
        { validators: closeAfterOpen },
      );
    }
    return this.fb.group(groups);
  }

  // ── Load / populate ────────────────────────────────────────────────────────

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
    // Default to accepting when the field is absent (backend default is true).
    this.loadedAcceptingOrders = detail.accepting_orders ?? true;
    this.acceptingOrders = this.loadedAcceptingOrders;
    this.seedHours(detail.opening_hours);
  }

  /** Seed every day, filling a null/missing day with the default, then pristine. */
  private seedHours(hours: OpeningHours | null | undefined): void {
    const patch = {} as Record<OpeningHoursDay, DayHours>;
    for (const d of OPENING_HOURS_DAYS) {
      const v = hours?.[d.key];
      patch[d.key] = {
        closed: v?.closed ?? DEFAULT_DAY_HOURS.closed,
        open: v?.open || DEFAULT_DAY_HOURS.open,
        close: v?.close || DEFAULT_DAY_HOURS.close,
      };
    }
    this.hoursForm.reset(patch);
    this.hoursForm.markAsPristine();
  }

  // ── Toggle / save / discard ──────────────────────────────────────────────────

  onToggle(value: boolean): void {
    this.acceptingOrders = value;
  }

  onDiscard(): void {
    if (this.loadedDetail) {
      this.populate(this.loadedDetail);
    } else {
      this.acceptingOrders = this.loadedAcceptingOrders;
      this.seedHours(null);
    }
  }

  onSave(): void {
    if (this.hoursForm.invalid) {
      this.hoursForm.markAllAsTouched();
      this.toast.error('Please fix the highlighted opening hours.');
      return;
    }

    this.saving = true;
    this.svc
      .save({
        id: this.restaurantId,
        accepting_orders: this.acceptingOrders,
        opening_hours: this.buildHours(),
      })
      .subscribe({
        next: () => this.onSaveSuccess(),
        error: () => {
          this.saving = false;
          // Clear the interceptor's queued toast so the user sees one clean
          // message, not two (matches the Identity/Tables/Support error pattern).
          this.toast.clear();
          this.toast.error('Could not save your changes. Please try again.');
        },
      });
  }

  private onSaveSuccess(): void {
    this.toast.success('Changes saved');
    // Re-fetch so the state reflects the server's canonical value, then reset
    // the dirty state. Keeps the scaffold in 'ready' (no skeleton).
    this.svc.getDetail(this.restaurantId).subscribe({
      next: (detail) => {
        this.populate(detail);
        this.saving = false;
      },
      error: () => {
        // Save succeeded; only the refresh failed. Sync local dirty state.
        this.loadedAcceptingOrders = this.acceptingOrders;
        this.hoursForm.markAsPristine();
        this.saving = false;
      },
    });
  }

  /** The full seven-day object sent to the backend (whitelisted JSON PUT). */
  private buildHours(): OpeningHours {
    const raw = this.hoursForm.value as Record<OpeningHoursDay, DayHours>;
    const result = {} as OpeningHours;
    for (const d of OPENING_HOURS_DAYS) {
      const v = raw[d.key] ?? DEFAULT_DAY_HOURS;
      result[d.key] = {
        closed: !!v.closed,
        open: v.open || DEFAULT_DAY_HOURS.open,
        close: v.close || DEFAULT_DAY_HOURS.close,
      };
    }
    return result;
  }
}
