import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { TagPillComponent } from 'src/app/_shared/tags/tag-pill.component';
import {
  TAG_COLOUR_PALETTE,
  TAG_ICONS,
  TAG_CATEGORIES,
  TagColour,
  TagCategory,
  isTagColour,
} from 'src/app/_shared/tags/tag-palette';
import { RestaurantTag } from 'src/app/_models/app.models';
import { RestaurantTagPayload } from 'src/app/_services/restaurant-tag.service';

const MAX_NAME = 50;

@Component({
  selector: 'app-preset-tag-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    TagPillComponent,
  ],
  templateUrl: './preset-tag-form-dialog.component.html',
})
export class PresetTagFormDialogComponent implements OnChanges {
  @Input() open = false;
  @Input() tag: RestaurantTag | null = null;
  @Input() existingTags: RestaurantTag[] = [];
  @Input() saving = false;

  @Output() closed = new EventEmitter<void>();
  @Output() save = new EventEmitter<RestaurantTagPayload>();

  readonly palette = TAG_COLOUR_PALETTE;
  readonly icons = TAG_ICONS;
  readonly categories = TAG_CATEGORIES;
  readonly maxName = MAX_NAME;

  name = '';
  category: TagCategory = 'dietary';
  colour: TagColour = 'gray';
  icon: string | null = null;
  filterable = true;
  iconSearch = '';

  nameError: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.resetForm();
    }
  }

  get isEditing(): boolean {
    return !!this.tag;
  }

  get title(): string {
    return this.isEditing ? 'Edit tag' : 'Add tag';
  }

  get filteredIcons() {
    const q = this.iconSearch.trim().toLowerCase();
    if (!q) return this.icons;
    return this.icons.filter(
      (i) => i.name.includes(q) || i.label.toLowerCase().includes(q),
    );
  }

  onNameChange(): void {
    this.nameError = this.validateName();
  }

  selectCategory(value: TagCategory): void {
    this.category = value;
  }

  selectColour(value: TagColour): void {
    this.colour = value;
  }

  selectIcon(name: string | null): void {
    this.icon = name;
  }

  onCancel(): void {
    this.closed.emit();
  }

  onSubmit(): void {
    const trimmed = this.name.trim();
    const err = this.validateName();
    if (err) {
      this.nameError = err;
      return;
    }
    const payload: RestaurantTagPayload = {
      name: trimmed,
      category: this.category,
      icon: this.icon,
      colour: this.colour,
      filterable: this.filterable,
    };
    this.save.emit(payload);
  }

  private resetForm(): void {
    this.iconSearch = '';
    this.nameError = null;
    if (this.tag) {
      this.name = this.tag.name ?? '';
      this.category = this.tag.category ?? 'dietary';
      this.colour = isTagColour(this.tag.colour) ? this.tag.colour : 'gray';
      this.icon = this.tag.icon ?? null;
      this.filterable = !!this.tag.filterable;
    } else {
      this.name = '';
      this.category = 'dietary';
      this.colour = 'gray';
      this.icon = null;
      this.filterable = true;
    }
  }

  private validateName(): string | null {
    const trimmed = this.name.trim();
    if (!trimmed) return 'Name is required.';
    if (trimmed.length > MAX_NAME) return `Name must be ${MAX_NAME} characters or less.`;
    const lower = trimmed.toLowerCase();
    const collision = this.existingTags.some(
      (t) => t.id !== this.tag?.id && t.name.trim().toLowerCase() === lower,
    );
    if (collision) return 'A tag with that name already exists.';
    return null;
  }
}
