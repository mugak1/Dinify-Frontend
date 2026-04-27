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
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { SafeArrayPipe } from 'src/app/_shared/ui/safe-array.pipe';
import {
  ItemModifiers,
  ModifierGroup,
  ModifierChoice,
} from 'src/app/_models/app.models';

@Component({
  selector: 'app-item-modifiers-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    SwitchComponent,
    ButtonComponent,
    SafeArrayPipe,
  ],
  templateUrl: './item-modifiers-tab.component.html',
})
export class ItemModifiersTabComponent implements OnChanges {
  @Input() modifiers: any;
  @Output() modifiersChange = new EventEmitter<ItemModifiers>();

  hasModifiers = false;
  groups: ModifierGroup[] = [];
  expandedGroups = new Set<string>();

  private skipNextInputChange = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['modifiers']) {
      if (this.skipNextInputChange) {
        this.skipNextInputChange = false;
        return;
      }
      this.loadModifiers(this.modifiers);
    }
  }

  trackGroupById(_index: number, group: ModifierGroup): string {
    return group.id;
  }

  hasEmptyChoiceNames(group: ModifierGroup): boolean {
    return group.choices.length > 0 && group.choices.some(c => !c.name?.trim());
  }

  allChoicesDisabled(group: ModifierGroup): boolean {
    return group.choices.length > 0 && group.choices.every(c => !c.available);
  }

  trackChoiceById(_index: number, choice: ModifierChoice): string {
    return choice.id;
  }

  private loadModifiers(data: any): void {
    if (!data) {
      this.hasModifiers = false;
      this.groups = [];
      return;
    }

    if (data.groups !== undefined) {
      this.hasModifiers = data.hasModifiers ?? false;
      this.groups = (data.groups ?? []).map((g: ModifierGroup) => ({ ...g, choices: [...g.choices] }));
      return;
    }

    this.hasModifiers = false;
    this.groups = [];
  }

  // ---------------------------------------------------------------------------
  // Toggle & emit
  // ---------------------------------------------------------------------------

  onToggleModifiers(enabled: boolean): void {
    this.hasModifiers = enabled;
    this.emitChange();
  }

  // ---------------------------------------------------------------------------
  // Group operations
  // ---------------------------------------------------------------------------

  addGroup(): void {
    const group: ModifierGroup = {
      id: crypto.randomUUID(),
      name: '',
      required: false,
      selectionType: 'single',
      minSelections: 0,
      maxSelections: 1,
      choices: [],
    };
    this.groups.push(group);
    this.expandedGroups.add(group.id);
    this.emitChange();
  }

  removeGroup(index: number): void {
    const removed = this.groups.splice(index, 1);
    if (removed.length) {
      this.expandedGroups.delete(removed[0].id);
    }
    this.emitChange();
  }

  onGroupDrop(event: CdkDragDrop<ModifierGroup[]>): void {
    moveItemInArray(this.groups, event.previousIndex, event.currentIndex);
    this.emitChange();
  }

  toggleExpand(groupId: string): void {
    if (this.expandedGroups.has(groupId)) {
      this.expandedGroups.delete(groupId);
    } else {
      this.expandedGroups.add(groupId);
    }
  }

  isExpanded(groupId: string): boolean {
    return this.expandedGroups.has(groupId);
  }

  onRequiredChange(group: ModifierGroup, required: boolean): void {
    group.required = required;
    group.minSelections = required ? 1 : 0;
    this.emitChange();
  }

  onSelectionTypeChange(group: ModifierGroup, type: 'single' | 'multiple'): void {
    group.selectionType = type;
    if (type === 'single') {
      group.minSelections = group.required ? 1 : 0;
      group.maxSelections = 1;
    } else {
      group.minSelections = group.required ? 1 : 0;
      group.maxSelections = 5;
    }
    this.emitChange();
  }

  // ---------------------------------------------------------------------------
  // Choice operations
  // ---------------------------------------------------------------------------

  addChoice(group: ModifierGroup): void {
    group.choices.push({
      id: crypto.randomUUID(),
      name: '',
      additionalCost: 0,
      available: true,
    });
    this.emitChange();
  }

  removeChoice(group: ModifierGroup, choiceIndex: number): void {
    group.choices.splice(choiceIndex, 1);
    this.emitChange();
  }

  onChoiceDrop(group: ModifierGroup, event: CdkDragDrop<ModifierChoice[]>): void {
    moveItemInArray(group.choices, event.previousIndex, event.currentIndex);
    this.emitChange();
  }

  // ---------------------------------------------------------------------------
  // Emit
  // ---------------------------------------------------------------------------

  emitChange(): void {
    this.skipNextInputChange = true;
    this.modifiersChange.emit({
      hasModifiers: this.hasModifiers,
      groups: this.groups,
    });
  }
}
