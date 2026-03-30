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
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { MenuItem } from 'src/app/_models/app.models';

@Component({
  selector: 'app-item-extras-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, SwitchComponent],
  templateUrl: './item-extras-tab.component.html',
})
export class ItemExtrasTabComponent implements OnChanges {
  @Input() isExtra = false;
  @Input() hasExtras = false;
  @Input() selectedExtraIds: string[] = [];
  @Input() availableExtras: MenuItem[] = [];
  @Input() currentItemId = '';

  @Output() extrasChange = new EventEmitter<{
    isExtra: boolean;
    hasExtras: boolean;
    extrasApplicable: string[];
  }>();

  enabled = false;
  markedAsExtra = false;
  selectedIds = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isExtra'] || changes['hasExtras'] || changes['selectedExtraIds']) {
      this.markedAsExtra = this.isExtra;
      this.enabled = this.hasExtras;
      this.selectedIds = new Set(this.selectedExtraIds ?? []);
    }
  }

  get filteredExtras(): MenuItem[] {
    return this.availableExtras.filter((e) => e.id !== this.currentItemId);
  }

  onIsExtraChange(value: boolean): void {
    this.markedAsExtra = value;
    this.emitChange();
  }

  onHasExtrasChange(value: boolean): void {
    this.enabled = value;
    if (!value) {
      this.selectedIds.clear();
    }
    this.emitChange();
  }

  toggleExtra(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.emitChange();
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  formatUGX(amount: number): string {
    return amount.toLocaleString('en-UG');
  }

  private emitChange(): void {
    this.extrasChange.emit({
      isExtra: this.markedAsExtra,
      hasExtras: this.enabled,
      extrasApplicable: Array.from(this.selectedIds),
    });
  }
}
