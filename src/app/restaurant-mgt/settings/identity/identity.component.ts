import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { of, switchMap } from 'rxjs';

import {
  CountryISO,
  NgxIntlTelephoneInputModule,
  PhoneNumberFormat,
} from 'ngx-intl-telephone-input';
import imageCompression from 'browser-image-compression';

import { environment } from 'src/environments/environment';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import {
  BrandingConfiguration,
  RestaurantDetail,
} from 'src/app/_models/app.models';

import {
  SectionPageComponent,
  SectionPageState,
} from '../components/section-page/section-page.component';
import {
  IdentityFieldsPayload,
  RestaurantIdentityService,
} from 'src/app/_services/restaurant-identity.service';
import { CUISINE_OPTIONS } from './cuisine-options';

const DEFAULT_BRAND_COLOR = '#171717';

/**
 * Restaurant identity & branding — the first real Settings section. Edits the
 * restaurant's public-facing identity (name, tagline, cuisine, contact,
 * location, cover photo, socials) inside the shared section-page
 * scaffold. Owner-only: the restaurant is resolved from the authenticated
 * membership, never a route param.
 */
@Component({
  selector: 'app-identity',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SectionPageComponent,
    ButtonComponent,
    NgxIntlTelephoneInputModule,
  ],
  templateUrl: './identity.component.html',
})
export class IdentityComponent implements OnInit, OnDestroy {
  loadState: SectionPageState = 'loading';
  saving = false;

  form!: FormGroup;

  readonly cuisineOptions = CUISINE_OPTIONS;

  // Phone widget config (mirrors common-users; UG/KE preferred dial codes).
  readonly CountryISO = CountryISO;
  readonly numberFormat = PhoneNumberFormat.International;
  readonly preferredCountries: CountryISO[] = [
    CountryISO.Uganda,
    CountryISO.Kenya,
  ];

  // The intl-telephone-input widget cannot be prefilled (no value input), so we
  // surface the number already on file as helper text and only overwrite the
  // control if the owner types a new one.
  currentPhone: string | null = null;

  // Image display URL (server URL or a local object-URL preview).
  coverUrl: string | null = null;

  // Staged File awaiting the multipart upload; undefined = unchanged.
  private coverFile?: File;
  private coverObjectUrl: string | null = null;
  /** Owner removed the existing cover (and staged no replacement). */
  coverCleared = false;

  private restaurantId = '';
  private loadedDetail?: RestaurantDetail;
  /** Full branding object as loaded — preserved verbatim on save. */
  private loadedBranding: BrandingConfiguration = {
    home: {
      header_style: '',
      brand_color: DEFAULT_BRAND_COLOR,
      logo_display: '',
      tagline: '',
    },
  };

  constructor(
    private fb: FormBuilder,
    private auth: AuthenticationService,
    private svc: RestaurantIdentityService,
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

  ngOnDestroy(): void {
    this.revoke(this.coverObjectUrl);
  }

  // ── Form ─────────────────────────────────────────────────────────────────

  private buildForm(): FormGroup {
    return this.fb.group({
      name: ['', Validators.required],
      tagline: ['', Validators.maxLength(255)],
      cuisine_types: [[] as string[]],
      contact_phone: [''],
      contact_email: ['', Validators.email],
      location: [''],
      landmark: [''],
      socials: this.fb.group({
        instagram: [''],
        facebook: [''],
        x: [''],
        tiktok: [''],
      }),
    });
  }

  /** Drives the scaffold's sticky save bar. */
  get isDirty(): boolean {
    return this.form.dirty || !!this.coverFile || this.coverCleared;
  }

  get taglineLength(): number {
    return (this.form.get('tagline')?.value ?? '').length;
  }

  get nameInvalid(): boolean {
    const c = this.form.get('name');
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  get emailInvalid(): boolean {
    const c = this.form.get('contact_email');
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
    this.clearStaged();

    const home = detail.branding_configuration?.home;
    this.loadedBranding = {
      home: home
        ? { ...home }
        : {
            header_style: '',
            brand_color: DEFAULT_BRAND_COLOR,
            logo_display: '',
            tagline: '',
          },
    };

    this.form.reset({
      name: detail.name ?? '',
      tagline: detail.tagline ?? '',
      cuisine_types: Array.isArray(detail.cuisine_types)
        ? [...detail.cuisine_types]
        : [],
      contact_phone: detail.contact_phone ?? '',
      contact_email: detail.contact_email ?? '',
      location: detail.location ?? '',
      landmark: detail.landmark ?? '',
      socials: {
        instagram: detail.socials?.instagram ?? '',
        facebook: detail.socials?.facebook ?? '',
        x: detail.socials?.x ?? '',
        tiktok: detail.socials?.tiktok ?? '',
      },
    });

    this.currentPhone = detail.contact_phone ?? null;
    this.coverUrl = detail.cover_photo
      ? environment.apiUrl + '/media/' + detail.cover_photo
      : null;
    this.form.markAsPristine();
  }

  // ── Cuisine chips ──────────────────────────────────────────────────────────

  isCuisineSelected(name: string): boolean {
    const list: string[] = this.form.get('cuisine_types')?.value ?? [];
    return list.includes(name);
  }

  toggleCuisine(name: string): void {
    const ctrl = this.form.get('cuisine_types');
    const list: string[] = ctrl?.value ?? [];
    const next = list.includes(name)
      ? list.filter((c) => c !== name)
      : [...list, name];
    ctrl?.setValue(next);
    ctrl?.markAsDirty();
  }

  // ── Phone ──────────────────────────────────────────────────────────────────

  onPhone(event: any): void {
    const raw = String(event?.phoneNumber ?? '')
      .replace('+', '')
      .replace(/\s/g, '');
    const ctrl = this.form.get('contact_phone');
    ctrl?.setValue(raw);
    ctrl?.markAsDirty();
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  async onPickImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file later
    if (!file) return;

    const compressed = await this.compress(file);
    const url = URL.createObjectURL(compressed);

    this.revoke(this.coverObjectUrl);
    this.coverObjectUrl = url;
    this.coverFile = compressed;
    this.coverUrl = url;
    this.coverCleared = false;
  }

  clearCover(): void {
    this.revoke(this.coverObjectUrl);
    this.coverObjectUrl = null;
    this.coverFile = undefined;
    this.coverUrl = null;
    this.coverCleared = true;
  }

  private async compress(file: File): Promise<File> {
    // Skip tiny files; compression overhead isn't worth it.
    if (file.size <= 200 * 1024) return file;
    try {
      const out = await imageCompression(file, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1280,
        useWebWorker: true,
        initialQuality: 0.85,
        fileType: 'image/jpeg',
      });
      // If compression somehow inflated the file, keep the original.
      return out.size < file.size ? out : file;
    } catch {
      return file;
    }
  }

  // ── Save / discard ─────────────────────────────────────────────────────────

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Please fix the highlighted fields.');
      return;
    }

    this.saving = true;
    const payload = this.buildFieldsPayload();
    const hasImages = !!this.coverFile;

    this.svc
      .saveFields(payload)
      .pipe(
        switchMap(() =>
          hasImages
            ? this.svc.uploadImages({
                id: this.restaurantId,
                ...(this.coverFile ? { cover_photo: this.coverFile } : {}),
              })
            : of(null),
        ),
      )
      .subscribe({
        next: () => this.onSaveSuccess(),
        error: () => {
          this.saving = false;
          // Clear the interceptor's queued toast so the user sees one clean
          // message, not two (matches the Tables/Support error pattern).
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
    // Re-fetch so image URLs and branding reflect the server's canonical state,
    // then reset the dirty/staged state. Keeps the scaffold in 'ready' (no skeleton).
    this.svc.getDetail(this.restaurantId).subscribe({
      next: (detail) => {
        this.populate(detail);
        this.saving = false;
      },
      error: () => {
        // Save succeeded; only the refresh failed. Reset local dirty state.
        this.clearStaged();
        this.form.markAsPristine();
        this.saving = false;
      },
    });
  }

  private buildFieldsPayload(): IdentityFieldsPayload {
    const v = this.form.value;
    const payload: IdentityFieldsPayload = {
      id: this.restaurantId,
      name: (v.name ?? '').trim(),
      tagline: this.nullIfEmpty(v.tagline),
      cuisine_types: v.cuisine_types ?? [],
      contact_phone: this.nullIfEmpty(v.contact_phone),
      contact_email: this.nullIfEmpty(v.contact_email),
      location: this.nullIfEmpty(v.location),
      landmark: this.nullIfEmpty(v.landmark),
      socials: {
        instagram: this.nullIfEmpty(v.socials?.instagram),
        facebook: this.nullIfEmpty(v.socials?.facebook),
        x: this.nullIfEmpty(v.socials?.x),
        tiktok: this.nullIfEmpty(v.socials?.tiktok),
      },
      // Preserve every branding key verbatim.
      branding_configuration: {
        home: { ...this.loadedBranding.home },
      },
    };
    // Clearing the cover rides the JSON PUT as null (multipart drops null).
    if (this.coverCleared && !this.coverFile) {
      payload.cover_photo = null;
    }
    return payload;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private nullIfEmpty(value: unknown): string | null {
    const s = (value ?? '').toString().trim();
    return s.length ? s : null;
  }

  private clearStaged(): void {
    this.revoke(this.coverObjectUrl);
    this.coverObjectUrl = null;
    this.coverFile = undefined;
    this.coverCleared = false;
  }

  private revoke(url: string | null): void {
    if (url) URL.revokeObjectURL(url);
  }
}
