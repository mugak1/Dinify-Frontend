import { Component, Input, Output, EventEmitter, ContentChildren, QueryList, AfterContentInit } from '@angular/core';
import { cn } from '../../utils/cn';

@Component({
  selector: 'app-dn-tab-trigger',
  standalone: true,
  template: `<button type="button" [class]="buttonClass" (click)="select()"><ng-content></ng-content></button>`,
})
export class TabTriggerComponent {
  @Input() value = '';
  active = false;
  onSelect: ((value: string) => void) | null = null;

  get buttonClass(): string {
    return cn(
      'px-4 py-2 text-sm font-medium rounded-md transition-colors',
      this.active
        ? 'bg-background text-foreground shadow-[var(--shadow-sm)]'
        : 'text-muted-foreground hover:text-foreground'
    );
  }

  select(): void {
    this.onSelect?.(this.value);
  }
}

@Component({
  selector: 'app-dn-tab-list',
  standalone: true,
  template: `
    <div class="inline-flex bg-muted rounded-lg p-1.5 gap-1">
      <ng-content></ng-content>
    </div>
  `,
})
export class TabListComponent {}

@Component({
  selector: 'app-dn-tab-content',
  standalone: true,
  template: `
    @if (active) {
      <div class="mt-3">
        <ng-content></ng-content>
      </div>
    }
  `,
})
export class TabContentComponent {
  @Input() value = '';
  active = false;
}

@Component({
  selector: 'app-dn-tabs',
  standalone: true,
  template: `<ng-content></ng-content>`,
})
export class TabsComponent implements AfterContentInit {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  @ContentChildren(TabTriggerComponent, { descendants: true }) triggers!: QueryList<TabTriggerComponent>;
  @ContentChildren(TabContentComponent, { descendants: true }) contents!: QueryList<TabContentComponent>;

  ngAfterContentInit(): void {
    this.triggers.forEach((t) => {
      t.onSelect = (val: string) => {
        this.value = val;
        this.valueChange.emit(val);
        this.updateActive();
      };
    });
    this.updateActive();
  }

  private updateActive(): void {
    this.triggers?.forEach((t) => (t.active = t.value === this.value));
    this.contents?.forEach((c) => (c.active = c.value === this.value));
  }
}
