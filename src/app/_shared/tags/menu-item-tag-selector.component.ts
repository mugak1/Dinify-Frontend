import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { RestaurantTag } from 'src/app/_models/app.models';
import {
  RestaurantTagService,
  RestaurantTagPayload,
} from 'src/app/_services/restaurant-tag.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { TagPillComponent } from './tag-pill.component';
import { PresetTagFormDialogComponent } from
  'src/app/restaurant-mgt/settings/preset-tags/components/preset-tag-form-dialog/preset-tag-form-dialog.component';

const MAX_TAGS_PER_ITEM = 20;

/**
 * Typeahead tag selector backed by a restaurant's RestaurantTag catalog.
 *
 * Behaviour:
 * - Renders selected tags as inline pills (each removable via X).
 * - Typing filters the dropdown by case-insensitive name match.
 * - If typed text has no exact match, the dropdown shows
 *   "+ Create '<typed>' as new tag" which opens the shared preset-tag
 *   create dialog pre-filled with that name.
 * - On modal save, the new tag is created via RestaurantTagService.create()
 *   and immediately added to the current item's selection.
 * - At MAX_TAGS_PER_ITEM (20) selected, the input becomes read-only with a
 *   "Maximum 20 tags reached." hint, matching the Lovable spec.
 *
 * Inputs / Outputs:
 * - `restaurantId` is required so the catalog scope and tenant for any new
 *   tag are both unambiguous.
 * - `selectedTagIds` is the current selection (two-way via the
 *   `selectedTagIdsChange` output).
 */
@Component({
  selector: 'app-menu-item-tag-selector',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TagPillComponent,
    PresetTagFormDialogComponent,
  ],
  templateUrl: './menu-item-tag-selector.component.html',
})
export class MenuItemTagSelectorComponent
  implements OnInit, OnChanges, OnDestroy
{
  @Input({ required: true }) restaurantId = '';
  @Input() selectedTagIds: string[] = [];

  @Output() selectedTagIdsChange = new EventEmitter<string[]>();

  @ViewChild('tagInput') tagInput?: ElementRef<HTMLInputElement>;

  readonly maxTags = MAX_TAGS_PER_ITEM;

  catalog: RestaurantTag[] = [];
  catalogLoaded = false;
  query = '';
  dropdownOpen = false;

  createOpen = false;
  createSaving = false;
  createInitialName: string | null = null;

  private sub?: Subscription;

  constructor(
    private tagApi: RestaurantTagService,
    private toast: ToastService,
    private host: ElementRef<HTMLElement>,
  ) {}

  ngOnInit(): void {
    if (this.restaurantId) this.loadCatalog();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['restaurantId'] && this.restaurantId) {
      this.loadCatalog();
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ── Document-level click handler closes the dropdown on outside clicks. ──
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.dropdownOpen) return;
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.dropdownOpen = false;
    }
  }

  // ── Catalog ─────────────────────────────────────────────────────────────

  private loadCatalog(): void {
    this.sub?.unsubscribe();
    this.sub = this.tagApi.list(this.restaurantId).subscribe({
      next: (tags) => {
        this.catalog = [...tags].sort(
          (a, b) =>
            (a.display_order ?? 0) - (b.display_order ?? 0) ||
            a.name.localeCompare(b.name),
        );
        this.catalogLoaded = true;
      },
      error: () => {
        this.catalog = [];
        this.catalogLoaded = true;
      },
    });
  }

  // ── Derived state ───────────────────────────────────────────────────────

  get selectedTags(): RestaurantTag[] {
    const byId = new Map(this.catalog.map((t) => [t.id, t]));
    const out: RestaurantTag[] = [];
    for (const id of this.selectedTagIds || []) {
      const tag = byId.get(id);
      if (tag) out.push(tag);
    }
    return out;
  }

  get atCapacity(): boolean {
    return (this.selectedTagIds?.length ?? 0) >= this.maxTags;
  }

  get filteredDropdown(): RestaurantTag[] {
    const q = this.query.trim().toLowerCase();
    const selected = new Set(this.selectedTagIds ?? []);
    return this.catalog
      .filter((t) => !selected.has(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  }

  get hasExactMatch(): boolean {
    const q = this.query.trim().toLowerCase();
    if (!q) return true;
    return this.catalog.some((t) => t.name.trim().toLowerCase() === q);
  }

  get showCreateOption(): boolean {
    const q = this.query.trim();
    return !!q && !this.hasExactMatch && !this.atCapacity;
  }

  categoryLabel(category: RestaurantTag['category']): string {
    switch (category) {
      case 'allergen': return 'Allergen';
      case 'dietary':  return 'Dietary';
      case 'descriptor': return 'Descriptor';
      default: return category;
    }
  }

  categoryBadgeClass(category: RestaurantTag['category']): string {
    switch (category) {
      case 'allergen':
        return 'bg-red-50 text-red-700 border border-red-100';
      case 'dietary':
        return 'bg-green-50 text-green-700 border border-green-100';
      case 'descriptor':
      default:
        return 'bg-gray-100 text-gray-700 border border-gray-200';
    }
  }

  trackById(_index: number, tag: RestaurantTag): string {
    return tag.id;
  }

  // ── Interactions ────────────────────────────────────────────────────────

  onInputFocus(): void {
    this.dropdownOpen = true;
  }

  onQueryChange(): void {
    if (!this.dropdownOpen) this.dropdownOpen = true;
  }

  selectTag(tag: RestaurantTag): void {
    if (this.atCapacity) return;
    if ((this.selectedTagIds ?? []).includes(tag.id)) return;
    const next = [...(this.selectedTagIds ?? []), tag.id];
    this.selectedTagIdsChange.emit(next);
    this.query = '';
  }

  removeTag(tagId: string): void {
    const next = (this.selectedTagIds ?? []).filter((id) => id !== tagId);
    this.selectedTagIdsChange.emit(next);
  }

  // ── Inline create flow ──────────────────────────────────────────────────

  openCreate(): void {
    if (this.atCapacity) return;
    this.createInitialName = this.query.trim();
    this.createOpen = true;
    this.dropdownOpen = false;
  }

  onCreateClosed(): void {
    this.createOpen = false;
    this.createInitialName = null;
  }

  onCreateSubmit(payload: RestaurantTagPayload): void {
    if (!this.restaurantId) return;
    this.createSaving = true;
    this.tagApi
      .create(this.restaurantId, {
        ...payload,
        display_order: this.catalog.length,
      })
      .subscribe({
        next: (created) => {
          this.createSaving = false;
          this.catalog = [...this.catalog, created];
          // Immediately apply the freshly-created tag to the item.
          if (!this.atCapacity && !(this.selectedTagIds ?? []).includes(created.id)) {
            this.selectedTagIdsChange.emit([
              ...(this.selectedTagIds ?? []),
              created.id,
            ]);
          }
          this.query = '';
          this.createOpen = false;
          this.createInitialName = null;
          this.toast.success('Tag added');
        },
        error: () => {
          this.createSaving = false;
          this.toast.error('Could not add tag.');
        },
      });
  }
}
