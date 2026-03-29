import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { MenuItem, MenuSectionListItem } from 'src/app/_models/app.models';
import { MenuService } from '../../services/menu.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-menu-search',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  templateUrl: './menu-search.component.html',
})
export class MenuSearchComponent {

  @Input() open = false;
  @Output() closed = new EventEmitter<void>();

  searchQuery = '';
  searchResults$: Observable<MenuItem[]>;
  isSearching$: Observable<boolean>;
  sections$: Observable<MenuSectionListItem[]>;

  constructor(
    private menuService: MenuService,
    private auth: AuthenticationService
  ) {
    this.searchResults$ = this.menuService.searchResults$;
    this.isSearching$ = this.menuService.isSearching$;
    this.sections$ = this.menuService.sections$;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.close();
    }
  }

  onSearch(): void {
    const query = this.searchQuery.trim();
    if (!query) return;

    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (restaurantId) {
      this.menuService.searchItems(query, restaurantId);
    }
  }

  onSelectResult(_item: MenuItem): void {
    this.close();
  }

  getImageUrl(item: MenuItem): string {
    return item.image ? environment.apiUrl + item.image : '';
  }

  close(): void {
    this.searchQuery = '';
    this.open = false;
    this.closed.emit();
  }
}
