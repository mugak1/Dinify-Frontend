import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { MenuItem, MenuSectionListItem } from 'src/app/_models/app.models';
import { environment } from 'src/environments/environment';

interface GroupedItems {
  sectionName: string;
  items: MenuItem[];
}

@Component({
  selector: 'app-add-upsell-item-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogComponent, ButtonComponent],
  templateUrl: './add-upsell-item-modal.component.html',
})
export class AddUpsellItemModalComponent implements OnChanges {

  @Input() open = false;
  @Input() menuItems: MenuItem[] = [];
  @Input() sections: MenuSectionListItem[] = [];
  @Input() addedItemIds = new Set<string>();
  @Output() closed = new EventEmitter<void>();
  @Output() add = new EventEmitter<string[]>();

  searchTerm = '';
  selectedCategory = 'all';
  selectedIds = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.searchTerm = '';
      this.selectedCategory = 'all';
      this.selectedIds = new Set<string>();
    }
  }

  get filteredItemsBySection(): GroupedItems[] {
    const term = this.searchTerm.toLowerCase().trim();
    const groups: GroupedItems[] = [];

    // Build a section name map
    const sectionMap = new Map<string, string>();
    this.sections.forEach(s => sectionMap.set(s.id, s.name));

    // Group items by section (group.id)
    const grouped = new Map<string, MenuItem[]>();
    for (const item of this.menuItems) {
      // Filter by search
      if (term && !item.name?.toLowerCase().includes(term)) continue;
      // Filter by category (section)
      if (this.selectedCategory !== 'all' && item.group?.id !== this.selectedCategory) continue;

      const groupId = item.group?.id || 'uncategorized';
      if (!grouped.has(groupId)) grouped.set(groupId, []);
      grouped.get(groupId)!.push(item);
    }

    grouped.forEach((items, groupId) => {
      groups.push({
        sectionName: sectionMap.get(groupId) || items[0]?.group?.name || 'Uncategorized',
        items,
      });
    });

    return groups;
  }

  get totalFilteredCount(): number {
    return this.filteredItemsBySection.reduce((sum, g) => sum + g.items.length, 0);
  }

  getItemImageUrl(item: MenuItem): string {
    if (!item.image) return '';
    if (item.image.startsWith('http')) return item.image;
    return environment.apiUrl + item.image;
  }

  isAlreadyAdded(item: MenuItem): boolean {
    return this.addedItemIds.has(item.id);
  }

  isSelected(item: MenuItem): boolean {
    return this.selectedIds.has(item.id);
  }

  toggleItem(item: MenuItem): void {
    if (this.isAlreadyAdded(item)) return;
    if (this.selectedIds.has(item.id)) {
      this.selectedIds.delete(item.id);
    } else {
      this.selectedIds.add(item.id);
    }
    // Force change detection
    this.selectedIds = new Set(this.selectedIds);
  }

  onAdd(): void {
    this.add.emit([...this.selectedIds]);
  }

  onClose(): void {
    this.closed.emit();
  }
}
