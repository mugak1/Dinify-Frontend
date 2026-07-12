import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { DnSegmentedComponent, DnSegItem } from 'src/app/_shared/ui/segmented/segmented.component';
import { ItemModifiersTabComponent } from '../item-modifiers-tab/item-modifiers-tab.component';
import { ItemDiscountsTabComponent } from '../item-discounts-tab/item-discounts-tab.component';
import { ItemExtrasTabComponent } from '../item-extras-tab/item-extras-tab.component';
import { MenuItem, MenuSectionListItem, ItemModifiers, ItemDiscountDetails } from 'src/app/_models/app.models';
import { MenuService } from '../../services/menu.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MenuItemTagSelectorComponent } from 'src/app/_shared/tags/menu-item-tag-selector.component';
import { environment } from 'src/environments/environment';
import imageCompression from 'browser-image-compression';

@Component({
  selector: 'app-item-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DialogComponent,
    ButtonComponent,
    SwitchComponent,
    DnSegmentedComponent,
    ItemModifiersTabComponent,
    ItemDiscountsTabComponent,
    ItemExtrasTabComponent,
    MenuItemTagSelectorComponent,
  ],
  templateUrl: './item-form-dialog.component.html',
})
export class ItemFormDialogComponent implements OnChanges {

  @Input() open = false;
  @Input() item?: MenuItem;
  @Input() sectionId?: string;
  @Input() isSaving: boolean = false;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<any>();

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  form!: FormGroup;
  sections$: Observable<MenuSectionListItem[]>;
  imagePreview = '';
  activeTab = 'details';
  attemptedSave = false;
  itemModifiers: ItemModifiers = { hasModifiers: false, groups: [] };
  itemHasDiscount = false;
  itemDiscountDetails: ItemDiscountDetails | null = null;
  itemIsExtra = false;
  itemHasExtras = false;
  itemExtrasApplicable: string[] = [];
  itemExtrasMin = 0;
  itemExtrasMax: number | null = null;
  availableExtras$: Observable<MenuItem[]>;
  isCompressing = false;
  clearImageRequested = false;
  restaurantId = '';
  selectedTagIds: string[] = [];
  // Data-loss guard: a snapshot of the full editor state captured when the dialog
  // opens; `isDirty` compares the live state to it. `showDiscardConfirm` drives the
  // inline "Discard unsaved changes?" prompt. (form.dirty alone can't see the
  // modifiers/discount/extras/tags tabs — they live outside the FormGroup.)
  private pristineSnapshot = '';
  showDiscardConfirm = false;

  constructor(
    private fb: FormBuilder,
    private menuService: MenuService,
    private toast: ToastService,
    private auth: AuthenticationService,
  ) {
    this.sections$ = this.menuService.sections$;
    this.availableExtras$ = this.menuService.extras$;
    this.restaurantId = this.auth.currentRestaurantRole?.restaurant_id ?? '';
    this.buildForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.buildForm();
      this.imagePreview = '';
      this.activeTab = 'details';
      this.attemptedSave = false;
      this.showDiscardConfirm = false;
      this.clearImageRequested = false;
      this.itemModifiers = { hasModifiers: false, groups: [] };
      this.itemHasDiscount = false;
      this.itemDiscountDetails = null;
      this.itemIsExtra = false;
      this.itemHasExtras = false;
      this.itemExtrasApplicable = [];
      this.itemExtrasMin = 0;
      this.itemExtrasMax = null;
      this.selectedTagIds = [];

      if (this.item) {
        // Load modifiers from existing item
        if (this.item.options) {
          this.itemModifiers = this.item.options;
        }

        // Load extras from existing item
        this.itemIsExtra = this.item.is_extra ?? false;
        this.itemHasExtras = this.item.has_extras ?? false;
        this.itemExtrasApplicable = (this.item.extras ?? []).map(e => e.id);
        this.itemExtrasMin = this.item.extras_min_selections ?? 0;
        this.itemExtrasMax = this.item.extras_max_selections ?? null;

        // Load discount from existing item — read canonical schema only.
        // Pre-0042 buggy rows (raw_discount_value/raw_discount_type) are
        // migrated by the backend before this code runs.
        this.itemHasDiscount = this.item.running_discount ?? false;
        if (this.item.discount_details) {
          const dd = this.item.discount_details;
          if (dd && (Number(dd.discount_percentage) || Number(dd.discount_amount))) {
            const isPct = dd.discount_type === 'percentage'
              || (Number(dd.discount_percentage) || 0) > 0;
            this.itemDiscountDetails = {
              discount_type: isPct ? 'percentage' : 'fixed',
              discount_amount: isPct
                ? Number(dd.discount_percentage) || 0
                : Number(dd.discount_amount) || 0,
              recurring_days: dd.recurring_days ?? [],
              start_date: dd.start_date ?? '',
              end_date: dd.end_date ?? '',
              start_time: dd.start_time ?? '',
              end_time: dd.end_time ?? '',
            };
          }
        }
        this.selectedTagIds = Array.isArray(this.item.tags)
          ? this.item.tags
              .map((t: any) => (t && typeof t === 'object' ? t.id : t))
              .filter((id: any): id is string => typeof id === 'string' && !!id)
          : [];

        this.form.patchValue({
          id: this.item.id,
          name: this.item.name,
          description: this.item.description,
          calories: this.item.calories ?? null,
          primary_price: this.item.primary_price,
          available: this.item.available,
          image: this.item.image,
          is_featured: this.item.is_featured ?? false,
          is_popular: this.item.is_popular ?? false,
          is_new: this.item.is_new ?? false,
          age_restricted: this.item.age_restricted ?? false,
          in_stock: this.item.in_stock ?? true,
        });

        // Set section from item's group context or provided sectionId
        if (this.sectionId) {
          this.form.get('section')?.setValue(this.sectionId);
        }

        if (this.item.image) {
          this.imagePreview = environment.apiUrl + this.item.image;
        }
      } else {
        // New item — set default section
        if (this.sectionId) {
          this.form.get('section')?.setValue(this.sectionId);
        }
      }

      // Capture the pristine baseline AFTER hydration. The child tabs hydrate
      // from their inputs WITHOUT emitting (they emit only on user action), so
      // this snapshot reflects the loaded item and isDirty stays false until a
      // genuine edit.
      this.pristineSnapshot = this.serializeState();
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      this.toast.error('Image must be JPEG, PNG, or GIF.');
      input.value = '';
      return;
    }

    // Hard upper bound — refuse files over 25 MB before we even try to compress.
    // Keeps memory usage bounded on low-end devices.
    const HARD_LIMIT_BYTES = 25 * 1024 * 1024;
    if (file.size > HARD_LIMIT_BYTES) {
      this.toast.error('Image is too large. Please pick one under 25 MB.');
      input.value = '';
      return;
    }

    // Skip compression for already-small images (under 200 KB).
    // Compression of small images wastes CPU and can occasionally produce
    // a *larger* output due to JPEG re-encode overhead.
    const SKIP_THRESHOLD_BYTES = 200 * 1024;
    let finalFile: File = file;

    if (file.size > SKIP_THRESHOLD_BYTES) {
      this.isCompressing = true;
      try {
        const compressed = await imageCompression(file, {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 1280,
          useWebWorker: true,
          initialQuality: 0.85,
          fileType: 'image/jpeg',
        });
        finalFile = compressed.size < file.size ? new File(
          [compressed],
          file.name.replace(/\.(png|gif)$/i, '.jpg'),
          { type: compressed.type, lastModified: Date.now() }
        ) : file;
      } catch (err) {
        console.error('Image compression failed:', err);
        this.toast.error('Could not compress image; uploading original (may be slow).');
        finalFile = file;
      } finally {
        this.isCompressing = false;
      }
    }

    this.form.get('image')?.setValue(finalFile);
    this.clearImageRequested = false;

    const reader = new FileReader();
    reader.onload = () => { this.imagePreview = reader.result as string; };
    reader.readAsDataURL(finalFile);
  }

  onRemoveImage(): void {
    this.clearImageRequested = true;
    this.imagePreview = '';
    this.form.get('image')?.setValue(null);
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  onSelectedTagIdsChange(ids: string[]): void {
    this.selectedTagIds = ids;
  }

  onModifiersChange(modifiers: ItemModifiers): void {
    this.itemModifiers = modifiers;
  }

  onDiscountChange(data: { hasDiscount: boolean; discountDetails: ItemDiscountDetails }): void {
    this.itemHasDiscount = data.hasDiscount;
    this.itemDiscountDetails = data.discountDetails;
  }

  onExtrasChange(data: { isExtra: boolean; hasExtras: boolean; extrasApplicable: string[]; extrasMin: number; extrasMax: number | null }): void {
    this.itemIsExtra = data.isExtra;
    this.itemHasExtras = data.hasExtras;
    this.itemExtrasApplicable = data.extrasApplicable;
    this.itemExtrasMin = data.extrasMin;
    this.itemExtrasMax = data.extrasMax;
  }

  get hasDetailsErrors(): boolean {
    if (!this.attemptedSave) return false;
    const f = this.form;
    return !!(f.get('name')?.invalid || f.get('section')?.invalid || f.get('primary_price')?.invalid);
  }

  get hasModifiersErrors(): boolean {
    if (!this.itemModifiers.hasModifiers) return false;
    return this.itemModifiers.groups.some(group => {
      // Required group with no choices at all
      if (group.required && group.choices.length === 0) return true;
      // Empty group name
      if (!group.name?.trim()) return true;
      // Any choice with an empty name
      if (group.choices.some(c => !c.name?.trim())) return true;
      // Required group where every choice is disabled
      if (group.required && group.choices.length > 0 && group.choices.every(c => !c.available)) return true;
      // Min selections exceeds max selections
      if (group.minSelections > group.maxSelections) return true;
      return false;
    });
  }

  get hasExtrasErrors(): boolean {
    return this.itemHasExtras && this.itemExtrasMax != null
      && this.itemExtrasMax > 0 && this.itemExtrasMin > this.itemExtrasMax;
  }

  get hasDiscountsErrors(): boolean {
    if (!this.itemHasDiscount) return false;
    if (!this.itemDiscountDetails) return true;

    // Hard-block an inverted window (end strictly before start). end === start
    // is a valid one-day discount, and empty dates skip the check. The
    // past-window case is only an advisory warning in the tab — never block it.
    const start = this.itemDiscountDetails.start_date || '';
    const end = this.itemDiscountDetails.end_date || '';
    if (start && end && end < start) return true;

    const amount = this.itemDiscountDetails.discount_amount ?? 0;

    if (amount <= 0) return true;

    if (this.itemDiscountDetails.discount_type === 'percentage') {
      return amount < 1 || amount > 99;
    }

    const price = this.form.get('primary_price')?.value ?? 0;
    if (price > 0 && amount >= price) return true;

    return false;
  }

  /** Tab descriptors for the shared segmented control. A stable array whose per-tab
   *  hasError flags are refreshed in place each read, so the reference never churns
   *  (no ExpressionChanged, no needless glider re-measure) while the asterisks stay live. */
  private readonly _segTabs: DnSegItem[] = [
    { value: 'details', label: 'Details' },
    { value: 'modifiers', label: 'Modifiers' },
    { value: 'extras', label: 'Extras' },
    { value: 'discounts', label: 'Discounts' },
  ];

  get segTabs(): DnSegItem[] {
    const errors = [
      this.hasDetailsErrors,
      this.hasModifiersErrors,
      this.hasExtrasErrors,
      this.hasDiscountsErrors,
    ];
    this._segTabs.forEach((t, i) => (t.hasError = errors[i]));
    return this._segTabs;
  }

  onSubmit(): void {
    // Light up the required-field affordances (section/price red borders + error
    // text, the Details-tab error dot via hasDetailsErrors) the moment a save is
    // attempted. The Save button is already [disabled] on form.invalid, but Enter
    // can still reach onSubmit — so guard each tab and route to the first with a
    // problem (Details first) instead of emitting an invalid payload.
    this.attemptedSave = true;
    if (this.form.invalid) {
      this.activeTab = 'details';
      return;
    }
    if (this.hasModifiersErrors) {
      this.activeTab = 'modifiers';
      return;
    }
    if (this.hasExtrasErrors) {
      this.activeTab = 'extras';
      return;
    }
    if (this.hasDiscountsErrors) {
      this.activeTab = 'discounts';
      return;
    }

    const payload = { ...this.form.getRawValue() };

    // If image is a string (existing URL, not changed), remove from payload
    // so the API service doesn't try to send it as FormData
    if (typeof payload.image === 'string') {
      delete payload.image;
    }

    // If the user explicitly removed the image and didn't replace it,
    // signal the backend to clear it. The image field itself should not
    // be sent — clear_image is the unambiguous signal.
    if (this.clearImageRequested && !payload.image) {
      payload.clear_image = true;
      delete payload.image;
    }

    // Include modifiers — stringify for FormData compatibility
    payload.has_options = this.itemModifiers.hasModifiers;
    payload.options = JSON.stringify(this.itemModifiers);

    // Include discount — write the canonical schema documented at
    // restaurants_app/models.py:234-242. discount_percentage and
    // discount_amount are SUBTRACTION values; the unused one is set to 0.
    if (this.itemHasDiscount && this.itemDiscountDetails) {
      const primaryPrice = parseFloat(payload.primary_price) || 0;
      const userValue = Number(this.itemDiscountDetails.discount_amount) || 0;
      const dtype = this.itemDiscountDetails.discount_type ?? 'fixed';

      let discountedPrice: number;
      const canonical: ItemDiscountDetails = {
        discount_type: dtype,
        discount_percentage: 0,
        discount_amount: 0,
        recurring_days: this.itemDiscountDetails.recurring_days || [],
        start_date: this.itemDiscountDetails.start_date || '',
        end_date: this.itemDiscountDetails.end_date || '',
        start_time: this.itemDiscountDetails.start_time || '',
        end_time: this.itemDiscountDetails.end_time || '',
      };

      if (dtype === 'percentage') {
        canonical.discount_percentage = userValue;
        discountedPrice = Math.max(0, Math.round(primaryPrice * (1 - userValue / 100)));
      } else {
        canonical.discount_amount = userValue;
        discountedPrice = Math.max(0, primaryPrice - userValue);
      }

      payload.discount_details = JSON.stringify(canonical);
      payload.discounted_price = discountedPrice;
      payload.running_discount = true;
      payload.consider_discount_object = true;
    } else {
      payload.discount_details = JSON.stringify({});
      payload.discounted_price = null;
      payload.running_discount = false;
      payload.consider_discount_object = false;
    }

    // Include extras
    payload.is_extra = this.itemIsExtra;
    payload.has_extras = this.itemHasExtras;
    payload.extras_applicable = JSON.stringify(this.itemExtrasApplicable);
    payload.extras_min_selections = this.itemExtrasMin || 0;
    payload.extras_max_selections = this.itemExtrasMax || null;

    // Tags now ride on the structured `tag_ids` field — the legacy free-text
    // `tags` array is no longer accepted by the backend.
    payload.tag_ids = [...this.selectedTagIds];

    this.saved.emit(payload);
  }

  onClose(): void {
    this.closed.emit();
  }

  /**
   * Serialised editor state — the form values (image reduced to a stable token)
   * plus the tab state held outside the FormGroup. Compared against the open-time
   * snapshot so unsaved edits in ANY of the four tabs are detected.
   */
  private serializeState(): string {
    const raw = this.form.getRawValue();
    const image = typeof raw.image === 'string' ? raw.image : (raw.image ? 'FILE' : null);
    return JSON.stringify({
      ...raw,
      image,
      clearImageRequested: this.clearImageRequested,
      itemModifiers: this.itemModifiers,
      itemHasDiscount: this.itemHasDiscount,
      itemDiscountDetails: this.itemDiscountDetails,
      itemIsExtra: this.itemIsExtra,
      itemHasExtras: this.itemHasExtras,
      itemExtrasApplicable: this.itemExtrasApplicable,
      itemExtrasMin: this.itemExtrasMin,
      itemExtrasMax: this.itemExtrasMax,
      selectedTagIds: this.selectedTagIds,
    });
  }

  /** Whether the editor holds unsaved changes since it opened. */
  get isDirty(): boolean {
    return this.serializeState() !== this.pristineSnapshot;
  }

  /**
   * Close intent from Cancel / backdrop / Escape. Prompts before discarding
   * unsaved edits; closes straight away when the editor is pristine.
   */
  requestClose(): void {
    if (this.isDirty) {
      this.showDiscardConfirm = true;
    } else {
      this.onClose();
    }
  }

  confirmDiscard(): void {
    this.showDiscardConfirm = false;
    this.onClose();
  }

  private buildForm(): void {
    this.form = this.fb.group({
      id: [''],
      name: ['', [Validators.required, Validators.minLength(2)]],
      section: ['', Validators.required],
      description: [''],
      calories: [null],
      image: [null],
      primary_price: [0, [Validators.required, Validators.min(1)]],
      available: [true],
      is_featured: [false],
      is_popular: [false],
      is_new: [false],
      age_restricted: [false],
      in_stock: [true],
    });
  }
}
