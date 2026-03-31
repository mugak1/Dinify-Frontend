import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { TagService, PresetTag } from '../../services/tag.service';
import {
  TAG_COLORS,
  AVAILABLE_ICONS,
  getTagColorClasses,
  getTagIcon,
} from '../../utils/tag-utils';

@Component({
  selector: 'app-preset-tags-config',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogComponent],
  templateUrl: './preset-tags-config.component.html',
})
export class PresetTagsConfigComponent implements OnInit, OnChanges, OnDestroy {
  @Input() open = false;
  @Input() restaurantId = '';
  @Output() closed = new EventEmitter<void>();

  tags: PresetTag[] = [];
  formOpen = false;
  editingTag: PresetTag | null = null;
  formName = '';
  formIcon = 'tag';
  formColor = 'gray';
  saving = false;

  readonly tagColors = TAG_COLORS;
  readonly availableIcons = AVAILABLE_ICONS;

  private tagsSub!: Subscription;

  constructor(
    private tagService: TagService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.tagsSub = this.tagService.presetTags$.subscribe(
      (tags) => (this.tags = [...tags])
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.formOpen = false;
      this.editingTag = null;
    }
  }

  ngOnDestroy(): void {
    this.tagsSub?.unsubscribe();
  }

  // ── Template helpers ─────────────────────────────────────────────────

  getColorClasses(colorName: string): string {
    return getTagColorClasses(colorName);
  }

  getIconSvg(iconName: string): string {
    return getTagIcon(iconName);
  }

  getColorLabel(colorName: string): string {
    return TAG_COLORS.find((c) => c.name === colorName)?.label || colorName;
  }

  // ── Form actions ─────────────────────────────────────────────────────

  openAddForm(): void {
    this.editingTag = null;
    this.formName = '';
    this.formIcon = 'tag';
    this.formColor = 'gray';
    this.formOpen = true;
  }

  openEditForm(tag: PresetTag): void {
    this.editingTag = tag;
    this.formName = tag.name;
    this.formIcon = tag.icon;
    this.formColor = tag.color;
    this.formOpen = true;
  }

  cancelForm(): void {
    this.formOpen = false;
    this.editingTag = null;
  }

  saveForm(): void {
    const name = this.formName.trim();
    if (!name) return;

    if (this.editingTag) {
      this.tags = this.tags.map((t) =>
        t.id === this.editingTag!.id
          ? { ...t, name, icon: this.formIcon, color: this.formColor }
          : t
      );
    } else {
      const newTag: PresetTag = {
        id: crypto.randomUUID(),
        name,
        icon: this.formIcon,
        color: this.formColor,
        displayOrder: this.tags.length,
        filterable: true,
      };
      this.tags = [...this.tags, newTag];
    }

    this.persistTags(this.editingTag ? 'Tag updated' : 'Tag added');
    this.formOpen = false;
    this.editingTag = null;
  }

  deleteTag(tagId: string): void {
    this.tags = this.tags.filter((t) => t.id !== tagId);
    this.persistTags('Tag deleted');
  }

  toggleFilterable(tag: PresetTag): void {
    this.tags = this.tags.map((t) =>
      t.id === tag.id ? { ...t, filterable: !t.filterable } : t
    );
    this.persistTags();
  }

  onClose(): void {
    this.closed.emit();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private persistTags(successMessage?: string): void {
    this.saving = true;
    this.tagService.savePresetTags(this.restaurantId, this.tags).subscribe({
      next: () => {
        this.saving = false;
        if (successMessage) {
          this.toastService.success(successMessage);
        }
      },
      error: () => {
        this.saving = false;
        this.toastService.error('Failed to save tags');
      },
    });
  }
}
