import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PresetTag } from '../../services/tag.service';
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';

@Component({
  selector: 'app-tag-filter-sheet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tag-filter-sheet.component.html',
})
export class TagFilterSheetComponent implements OnChanges {
  @Input() open = false;
  @Input() tags: PresetTag[] = [];
  @Input() selectedTags: string[] = [];
  @Input() items: any[] = [];

  @Output() openChange = new EventEmitter<boolean>();
  @Output() apply = new EventEmitter<string[]>();

  localSelectedTags: string[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.localSelectedTags = [...this.selectedTags];
    }
  }

  get filterableTags(): PresetTag[] {
    return this.tags.filter(t => t.filterable);
  }

  getItemCount(tagName: string): number {
    return this.items.filter(item => item.allergens?.includes(tagName)).length;
  }

  isSelected(tagName: string): boolean {
    return this.localSelectedTags.includes(tagName);
  }

  toggleTag(tagName: string): void {
    if (this.localSelectedTags.includes(tagName)) {
      this.localSelectedTags = this.localSelectedTags.filter(t => t !== tagName);
    } else {
      this.localSelectedTags = [...this.localSelectedTags, tagName];
    }
  }

  clearAll(): void {
    this.localSelectedTags = [];
  }

  onApply(): void {
    this.apply.emit(this.localSelectedTags);
    this.close();
  }

  close(): void {
    this.open = false;
    this.openChange.emit(false);
  }

  getColorClasses(colorName: string): string {
    return getTagColorClasses(colorName);
  }

  getIconSvg(iconName: string): string {
    return getTagIcon(iconName);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.close();
    }
  }
}
