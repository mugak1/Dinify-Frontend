import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styles: [`
    :host {
      display: contents;
    }
  `],
})
export class SidebarComponent {
  @Input() isOpen = false;
  @Output() sidebarToggle = new EventEmitter<void>();

  collapsed = false;

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
  }
}
