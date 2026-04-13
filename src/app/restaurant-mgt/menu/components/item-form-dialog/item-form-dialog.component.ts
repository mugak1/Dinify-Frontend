import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
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
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';
import { environment } from 'src/environments/environment';

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

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<any>();

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

  constructor(
    private fb: FormBuilder,
    private menuService: MenuService,
    private tagService: TagService
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
      this.itemModifiers = { hasModifiers: false, groups: [] };
      this.itemHasDiscount = false;
      this.itemDiscountDetails = null;
      this.itemIsExtra = false;
      this.itemHasExtras = false;
      this.itemExtrasApplicable = [];

      if (this.item) {
        // Load modifiers from existing item
        if (this.item.options) {
          this.itemModifiers = typeof this.item.options === 'string'
            ? JSON.parse(this.item.options)
            : this.item.options;
        }

        // Load extras from existing item
        this.itemIsExtra = this.item.is_extra ?? false;
        this.itemHasExtras = this.item.has_extras ?? false;
        this.itemExtrasApplicable = (this.item.extras ?? []).map(
          (e: any) => (typeof e === 'string' ? e : e.id)
        );

        // Load discount from existing item
        this.itemHasDiscount = this.item.running_discount ?? this.item.has_discount ?? false;
        if (this.item.discount_details) {
          this.itemDiscountDetails = typeof this.item.discount_details === 'string'
            ? JSON.parse(this.item.discount_details)
            : this.item.discount_details;
        }

        // Restore raw discount values for the edit form
        if (this.itemDiscountDetails?.raw_discount_value !== undefined) {
          this.itemDiscountDetails = {
            ...this.itemDiscountDetails,
            discount_amount: this.itemDiscountDetails.raw_discount_value,
            discount_type: this.itemDiscountDetails.raw_discount_type || this.itemDiscountDetails.discount_type,
          };
        }
        this.form.patchValue({
          id: this.item.id,
          name: this.item.name,
          description: this.item.description,
          calories: this.item.calories ?? null,
          primary_price: this.item.primary_price,
          available: this.item.available,
          allergens: this.item.allergens ?? [],
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

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return;
    }

    this.form.get('image')?.setValue(file);

    const reader = new FileReader();
    reader.onload = () => {
      this.imagePreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  onAllergenAdd(value: string): void {
    const trimmed = value?.trim();
    if (!trimmed) return;

    const current: string[] = this.form.get('allergens')?.value ?? [];
    this.form.get('allergens')?.setValue([...current, trimmed]);
  }

  onAllergenRemove(index: number): void {
    const current: string[] = [...(this.form.get('allergens')?.value ?? [])];
    current.splice(index, 1);
    this.form.get('allergens')?.setValue(current);
  }

  onPresetTagToggle(tagName: string): void {
    const current: string[] = this.form.get('allergens')?.value ?? [];
    if (current.includes(tagName)) {
      this.form.get('allergens')?.setValue(current.filter((t: string) => t !== tagName));
    } else {
      if (current.length >= 20) return;
      this.form.get('allergens')?.setValue([...current, tagName]);
    }
  }

  isTagSelected(tagName: string): boolean {
    const current: string[] = this.form.get('allergens')?.value ?? [];
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

  // Stubs for future tab-specific validation
  get hasModifiersErrors(): boolean { return false; }
  get hasExtrasErrors(): boolean { return false; }
  get hasDiscountsErrors(): boolean { return false; }

  onSubmit(): void {
    this.attemptedSave = true;
    if (this.form.invalid) {
      this.activeTab = 'details';
      return;
    }

    const payload = { ...this.form.getRawValue() };

    // If image is a string (existing URL, not changed), remove from payload
    // so the API service doesn't try to send it as FormData
    if (typeof payload.image === 'string') {
      delete payload.image;
    }

    // Include modifiers — stringify for FormData compatibility
    payload.has_options = this.itemModifiers.hasModifiers;
    payload.options = JSON.stringify(this.itemModifiers);

    // Include discount — stringify for FormData compatibility
    payload.running_discount = this.itemHasDiscount;

    if (this.itemHasDiscount && this.itemDiscountDetails) {
      const primaryPrice = parseFloat(payload.primary_price) || 0;
      let discountedPrice: number;

      if (this.itemDiscountDetails.discount_type === 'percentage') {
        discountedPrice = Math.round(primaryPrice * (1 - (this.itemDiscountDetails.discount_amount || 0) / 100));
      } else {
        // Fixed amount discount
        discountedPrice = Math.max(0, primaryPrice - (this.itemDiscountDetails.discount_amount || 0));
      }

      payload.discounted_price = discountedPrice;
      payload.discount_details = JSON.stringify({
        ...this.itemDiscountDetails,
        discount_amount: discountedPrice,  // Store computed final price for diner menu display
        raw_discount_value: this.itemDiscountDetails.discount_amount,  // Preserve the raw input value
        raw_discount_type: this.itemDiscountDetails.discount_type,     // Preserve the type
      });
    } else {
      payload.running_discount = false;
      payload.discounted_price = null;
      payload.discount_details = JSON.stringify(null);
    }

    // Include extras
    payload.is_extra = this.itemIsExtra;
    payload.has_extras = this.itemHasExtras;
    payload.extras_applicable = JSON.stringify(this.itemExtrasApplicable);

    this.saved.emit(payload);
  }

  onClose(): void {
    this.closed.emit();
  }

  private buildForm(): void {
    this.form = this.fb.group({
      id: [''],
      name: ['', Validators.required],
      section: ['', Validators.required],
      description: [''],
      calories: [null],
      image: [null],
      primary_price: [0, [Validators.required, Validators.min(1)]],
      available: [true],
      allergens: [[] as string[]],
      is_featured: [false],
      is_popular: [false],
      is_new: [false],
      in_stock: [true],
    });
  }
}
