import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';

import { KitchenMenuItem } from '../../models/kitchen.models';
import { KitchenStockService } from '../../services/kitchen-stock.service';

/** A section header plus its items, for the grouped list. */
interface SectionGroup {
  section: string;
  items: KitchenMenuItem[];
}

/**
 * Sold-out ("86") panel — a right-side slide-over over the kitchen board. Lists
 * the restaurant's on-menu items grouped by section and lets staff toggle each
 * between In stock and Sold out. The board owns the open state (this component
 * is a controlled `[open]` / `(closed)` pair); all data lives in
 * KitchenStockService.
 */
@Component({
  selector: 'app-sold-out-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sold-out-panel.component.html',
  styleUrls: ['./sold-out-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SoldOutPanelComponent {
  @Input() open = false;
  // Named `closed` (not `close`) to avoid @angular-eslint/no-output-native,
  // matching the shared SheetComponent's precedent.
  @Output() closed = new EventEmitter<void>();

  /** Client-side search term filtering the list by item name. */
  readonly query = signal('');

  /** Items filtered by the search box and grouped by section (first-seen order). */
  readonly groups = computed<SectionGroup[]>(() => {
    const q = this.query().trim().toLowerCase();
    const filtered = this.stock
      .items()
      .filter(i => !q || i.name.toLowerCase().includes(q));
    const bySection = new Map<string, KitchenMenuItem[]>();
    for (const item of filtered) {
      const key = item.section_name || 'Uncategorised';
      const bucket = bySection.get(key);
      if (bucket) bucket.push(item);
      else bySection.set(key, [item]);
    }
    return [...bySection].map(([section, items]) => ({ section, items }));
  });

  constructor(public readonly stock: KitchenStockService) {}

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Flip a row between In stock and Sold out. */
  toggle(item: KitchenMenuItem): void {
    this.stock.toggleStock(item.id, !item.in_stock);
  }

  onClose(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.onClose();
  }
}
