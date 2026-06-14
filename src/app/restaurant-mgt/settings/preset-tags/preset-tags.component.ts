import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';

import { AuthenticationService } from 'src/app/_services/authentication.service';
import {
  RestaurantTagService,
  RestaurantTagPayload,
} from 'src/app/_services/restaurant-tag.service';
import { RestaurantTag } from 'src/app/_models/app.models';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { TagPillComponent } from 'src/app/_shared/tags/tag-pill.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';

import { SectionPageComponent } from '../components/section-page/section-page.component';
import { PresetTagFormDialogComponent } from './components/preset-tag-form-dialog/preset-tag-form-dialog.component';
import { PresetTagDeleteDialogComponent } from './components/preset-tag-delete-dialog/preset-tag-delete-dialog.component';

type LoadState = 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-preset-tags',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    TagPillComponent,
    ButtonComponent,
    SectionPageComponent,
    PresetTagFormDialogComponent,
    PresetTagDeleteDialogComponent,
  ],
  templateUrl: './preset-tags.component.html',
})
export class PresetTagsComponent implements OnInit {
  tags: RestaurantTag[] = [];
  loadState: LoadState = 'loading';

  formOpen = false;
  editingTag: RestaurantTag | null = null;

  deleteOpen = false;
  tagPendingDelete: RestaurantTag | null = null;
  tagPendingDeleteCount = 0;

  saving = false;

  private restaurantId = '';

  constructor(
    private auth: AuthenticationService,
    private tagApi: RestaurantTagService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.restaurantId = this.auth.currentRestaurantRole?.restaurant_id ?? '';
    this.loadTags();
  }

  // ── Loading ──────────────────────────────────────────────────────────

  loadTags(): void {
    if (!this.restaurantId) {
      this.loadState = 'error';
      return;
    }
    this.loadState = 'loading';
    this.tagApi.list(this.restaurantId).subscribe({
      next: (tags) => {
        this.tags = [...tags].sort(
          (a, b) => a.display_order - b.display_order,
        );
        this.loadState = 'ready';
      },
      error: () => {
        this.loadState = 'error';
      },
    });
  }

  retry(): void {
    this.loadTags();
  }

  // ── Reorder ──────────────────────────────────────────────────────────

  onDrop(event: CdkDragDrop<RestaurantTag[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    const previousOrder = [...this.tags];
    const newOrder = [...this.tags];
    moveItemInArray(newOrder, event.previousIndex, event.currentIndex);

    // Optimistic UI — apply new display_order values locally.
    this.tags = newOrder.map((t, i) => ({ ...t, display_order: i }));

    const orderedIds = newOrder.map((t) => t.id);
    this.tagApi.reorder(orderedIds).subscribe({
      error: () => {
        this.tags = previousOrder;
        this.toast.error('Could not save the new tag order.');
      },
    });
  }

  // ── Filterable toggle (inline) ───────────────────────────────────────

  toggleFilterable(tag: RestaurantTag): void {
    const next = !tag.filterable;
    // Optimistic local update.
    this.tags = this.tags.map((t) =>
      t.id === tag.id ? { ...t, filterable: next } : t,
    );
    this.tagApi.update(tag.id, { filterable: next }).subscribe({
      error: () => {
        this.tags = this.tags.map((t) =>
          t.id === tag.id ? { ...t, filterable: !next } : t,
        );
        this.toast.error('Could not update tag.');
      },
    });
  }

  // ── Create / Edit modal ──────────────────────────────────────────────

  openAdd(): void {
    this.editingTag = null;
    this.formOpen = true;
  }

  openEdit(tag: RestaurantTag): void {
    this.editingTag = tag;
    this.formOpen = true;
  }

  onFormClosed(): void {
    this.formOpen = false;
    this.editingTag = null;
  }

  onFormSaved(payload: RestaurantTagPayload): void {
    this.saving = true;
    if (this.editingTag) {
      const id = this.editingTag.id;
      this.tagApi.update(id, payload).subscribe({
        next: (updated) => {
          this.saving = false;
          this.tags = this.tags.map((t) => (t.id === id ? { ...t, ...updated } : t));
          this.toast.success('Tag updated');
          this.onFormClosed();
        },
        error: () => {
          this.saving = false;
          this.toast.error('Could not save tag.');
        },
      });
    } else {
      this.tagApi
        .create(this.restaurantId, {
          ...payload,
          display_order: this.tags.length,
        })
        .subscribe({
          next: (created) => {
            this.saving = false;
            this.tags = [...this.tags, created];
            this.toast.success('Tag added');
            this.onFormClosed();
          },
          error: () => {
            this.saving = false;
            this.toast.error('Could not add tag.');
          },
        });
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────

  openDelete(tag: RestaurantTag): void {
    this.tagPendingDelete = tag;
    this.tagPendingDeleteCount = 0;
    this.deleteOpen = true;
    this.tagApi.countItemsUsing(tag.id).subscribe({
      next: (count) => (this.tagPendingDeleteCount = count),
      error: () => (this.tagPendingDeleteCount = 0),
    });
  }

  onDeleteCancelled(): void {
    this.deleteOpen = false;
    this.tagPendingDelete = null;
  }

  onDeleteConfirmed(): void {
    const tag = this.tagPendingDelete;
    if (!tag) return;
    this.tagApi.delete(tag.id).subscribe({
      next: () => {
        this.tags = this.tags.filter((t) => t.id !== tag.id);
        this.toast.success('Tag deleted');
        this.deleteOpen = false;
        this.tagPendingDelete = null;
      },
      error: () => {
        this.toast.error('Could not delete tag.');
      },
    });
  }

  // ── Template helpers ─────────────────────────────────────────────────

  trackById(_index: number, tag: RestaurantTag): string {
    return tag.id;
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
}
