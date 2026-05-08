import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { BadgeComponent } from 'src/app/_shared/ui/badge/badge.component';
import {
  TabsComponent,
  TabListComponent,
  TabTriggerComponent,
  TabContentComponent,
} from 'src/app/_shared/ui/tabs/tabs.component';
import { ItemModifiersTabComponent } from '../item-modifiers-tab/item-modifiers-tab.component';
import { ItemDiscountsTabComponent } from '../item-discounts-tab/item-discounts-tab.component';
import { ItemExtrasTabComponent } from '../item-extras-tab/item-extras-tab.component';
import { MenuItem, MenuSectionListItem, ItemModifiers, ItemDiscountDetails } from 'src/app/_models/app.models';
import { MenuService } from '../../services/menu.service';
import { TagService, PresetTag } from '../../services/tag.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';
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
    BadgeComponent,
    TabsComponent,
    TabListComponent,
    TabTriggerComponent,
    TabContentComponent,
    ItemModifiersTabComponent,
    ItemDiscountsTabComponent,
    ItemExtrasTabComponent,
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
  availableExtras$: Observable<MenuItem[]>;
  presetTags$: Observable<PresetTag[]>;
  isCompressing = false;
  clearImageRequested = false;

  constructor(
    private fb: FormBuilder,
    private menuService: MenuService,
    private tagService: TagService,
    private toast: ToastService
  ) {
    this.sections$ = this.menuService.sections$;
    this.availableExtras$ = this.menuService.extras$;
    this.presetTags$ = this.tagService.presetTags$;
    this.buildForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.buildForm();
      this.imagePreview = '';
      this.activeTab = 'details';
      this.attemptedSave = false;
      this.clearImageRequested = false;
      this.itemModifiers = { hasModifiers: false, groups: [] };
      this.itemHasDiscount = false;
      this.itemDiscountDetails = null;
      this.itemIsExtra = false;
      this.itemHasExtras = false;
      this.itemExtrasApplicable = [];

      if (this.item) {
        // Load modifiers from existing item
        if (this.item.options) {
          this.itemModifiers = this.item.options;
        }

        // Load extras from existing item
        this.itemIsExtra = this.item.is_extra ?? false;
        this.itemHasExtras = this.item.has_extras ?? false;
        this.itemExtrasApplicable = (this.item.extras ?? []).map(e => e.id);

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
        this.form.patchValue({
          id: this.item.id,
          name: this.item.name,
          description: this.item.description,
          calories: this.item.calories ?? null,
          primary_price: this.item.primary_price,
          available: this.item.available,
          tags: this.item.tags ?? [],
          image: this.item.image,
          is_featured: this.item.is_featured ?? false,
          is_popular: this.item.is_popular ?? false,
          is_new: this.item.is_new ?? false,
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

  onTagAdd(value: string): void {
    const trimmed = value?.trim();
    if (!trimmed) return;

    const current: string[] = this.form.get('tags')?.value ?? [];
    this.form.get('tags')?.setValue([...current, trimmed]);
  }

  onTagRemove(index: number): void {
    const current: string[] = [...(this.form.get('tags')?.value ?? [])];
    current.splice(index, 1);
    this.form.get('tags')?.setValue(current);
  }

  onPresetTagToggle(tagName: string): void {
    const current: string[] = this.form.get('tags')?.value ?? [];
    if (current.includes(tagName)) {
      this.form.get('tags')?.setValue(current.filter((t: string) => t !== tagName));
    } else {
      if (current.length >= 20) return;
      this.form.get('tags')?.setValue([...current, tagName]);
    }
  }

  isTagSelected(tagName: string): boolean {
    const current: string[] = this.form.get('tags')?.value ?? [];
    return current.includes(tagName);
  }

  getPresetTagColorClasses(tag: PresetTag): string {
    return getTagColorClasses(tag.color);
  }

  getPresetTagIconSvg(tag: PresetTag): string {
    return getTagIcon(tag.icon);
  }

  getSelectedTagClasses(tagName: string): string {
    const presetTags = this.tagService.getPresetTagsSnapshot();
    const match = presetTags.find((t) => t.name === tagName);
    if (match) return getTagColorClasses(match.color);
    return 'bg-gray-100 text-gray-800';
  }

  onModifiersChange(modifiers: ItemModifiers): void {
    this.itemModifiers = modifiers;
  }

  onDiscountChange(data: { hasDiscount: boolean; discountDetails: ItemDiscountDetails }): void {
    this.itemHasDiscount = data.hasDiscount;
    this.itemDiscountDetails = data.discountDetails;
  }

  onExtrasChange(data: { isExtra: boolean; hasExtras: boolean; extrasApplicable: string[] }): void {
    this.itemIsExtra = data.isExtra;
    this.itemHasExtras = data.hasExtras;
    this.itemExtrasApplicable = data.extrasApplicable;
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

  get hasExtrasErrors(): boolean { return false; }

  get hasDiscountsErrors(): boolean {
    if (!this.itemHasDiscount) return false;
    if (!this.itemDiscountDetails) return true;

    const amount = this.itemDiscountDetails.discount_amount ?? 0;

    if (amount <= 0) return true;

    if (this.itemDiscountDetails.discount_type === 'percentage') {
      return amount < 1 || amount > 99;
    }

    const price = this.form.get('primary_price')?.value ?? 0;
    if (price > 0 && amount >= price) return true;

    return false;
  }

  onSubmit(): void {
    if (this.hasModifiersErrors) {
      this.activeTab = 'modifiers';
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

    this.addClearSentinels(payload);

    this.saved.emit(payload);
  }

  onClose(): void {
    this.closed.emit();
  }

  /**
   * For each nullable field that was set on the original item but is
   * null in the outgoing payload, replace the null with a `clear_<field>`
   * sentinel. ApiService strips null values from JSON payloads
   * (api.service.ts:137), so the sentinel is the unambiguous "clear me"
   * signal — same pattern as clear_image. The matching backend handler
   * lives in restaurants_app/endpoints/restaurant_setup.py.
   */
  private addClearSentinels(payload: any): void {
    const NULLABLE_CLEARABLE = ['calories', 'discounted_price'];
    for (const field of NULLABLE_CLEARABLE) {
      const originalValue = (this.item as any)?.[field];
      const wasSet = originalValue !== null && originalValue !== undefined;
      if (wasSet && payload[field] === null) {
        payload[`clear_${field}`] = true;
        delete payload[field];
      }
    }
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
      tags: [[] as string[]],
      is_featured: [false],
      is_popular: [false],
      is_new: [false],
      in_stock: [true],
    });
  }
}
