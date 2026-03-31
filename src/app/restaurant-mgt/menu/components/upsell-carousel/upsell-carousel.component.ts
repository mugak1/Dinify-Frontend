import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, combineLatest } from 'rxjs';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { UpsellService } from '../../services/upsell.service';
import { MenuService } from '../../services/menu.service';
import { TagService, PresetTag } from '../../services/tag.service';
import { CartItem } from '../../models/cart.model';
import { UpsellConfig } from 'src/app/_models/app.models';
import { getCurrentPrice, formatUGX, isDiscountActive } from '../../utils/price-utils';
import { getTagColorClasses, getTagIcon } from '../../utils/tag-utils';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-upsell-carousel',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './upsell-carousel.component.html',
})
export class UpsellCarouselComponent implements OnInit, OnDestroy {
  @Input() cartItems: CartItem[] = [];

  @Output() addItem = new EventEmitter<any>();
  @Output() itemNeedsModifiers = new EventEmitter<any>();

  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

  config: UpsellConfig | null = null;
  allItems: any[] = [];
  presetTags: PresetTag[] = [];
  filteredItems: any[] = [];
  canScrollLeft = false;
  canScrollRight = false;
  addedItems = new Set<string>();
  imageBaseUrl = environment.apiUrl;

  private sub?: Subscription;

  constructor(
    private upsellService: UpsellService,
    private menuService: MenuService,
    private tagService: TagService
  ) {}

  ngOnInit(): void {
    this.sub = combineLatest([
      this.upsellService.config$,
      this.menuService.allItems$,
      this.tagService.presetTags$,
    ]).subscribe(([config, allItems, presetTags]) => {
      this.config = config;
      this.allItems = allItems;
      this.presetTags = presetTags;
      this.computeFilteredItems();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private computeFilteredItems(): void {
    if (!this.config?.enabled || !this.config.items?.length) {
      this.filteredItems = [];
      return;
    }

    // Map upsell items by position order to actual menu items
    const sorted = [...this.config.items].sort((a, b) => a.position - b.position);
    let items = sorted
      .map(ui => this.allItems.find(mi => mi.id === ui.menu_item))
      .filter((item): item is any => !!item);

    // Filter based on config
    items = items.filter(item => {
      if (this.config!.hide_out_of_stock && item.in_stock === false) return false;
      if (this.config!.hide_if_in_basket) {
        if (this.cartItems.some(ci => ci.item.id === item.id)) return false;
      }
      if (!item.available) return false;
      return true;
    });

    this.filteredItems = items.slice(0, this.config.max_items_to_show || 5);

    // Defer scroll check
    setTimeout(() => this.checkScroll(), 100);
  }

  get showArrows(): boolean {
    return this.filteredItems.length > 3;
  }

  get visible(): boolean {
    return !!this.config?.enabled && this.filteredItems.length > 0;
  }

  checkScroll(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    this.canScrollLeft = el.scrollLeft > 5;
    this.canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 5;
  }

  scroll(direction: 'left' | 'right'): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    const firstChild = el.firstElementChild as HTMLElement;
    if (firstChild) {
      const itemWidth = firstChild.offsetWidth + 12;
      el.scrollBy({ left: direction === 'left' ? -itemWidth : itemWidth, behavior: 'smooth' });
    }
  }

  handleAddClick(item: any): void {
    const hasRequiredModifiers = this.parseOptions(item.options)?.groups?.some(
      (g: any) => g.required
    );

    if (hasRequiredModifiers) {
      this.itemNeedsModifiers.emit(item);
    } else {
      this.addItem.emit(item);
      this.addedItems.add(item.id);
      setTimeout(() => {
        this.addedItems.delete(item.id);
      }, 2000);
    }
  }

  isAdded(itemId: string): boolean {
    return this.addedItems.has(itemId);
  }

  getPrice(item: any): string {
    return formatUGX(getCurrentPrice(item));
  }

  hasDiscount(item: any): boolean {
    return isDiscountActive(item.discount_details);
  }

  getItemTags(item: any): { name: string; colorClasses: string; iconSvg: string }[] {
    const tags = item.allergens || [];
    return tags.slice(0, 2).map((tagName: string) => {
      const preset = this.presetTags.find(p => p.name === tagName);
      return {
        name: tagName,
        colorClasses: preset ? getTagColorClasses(preset.color) : 'bg-muted text-muted-foreground',
        iconSvg: preset ? getTagIcon(preset.icon) : '',
      };
    });
  }

  getRemainingTagCount(item: any): number {
    const tags = item.allergens || [];
    return Math.max(0, tags.length - 2);
  }

  private parseOptions(options: any): any {
    if (!options) return null;
    try {
      const parsed = typeof options === 'string' ? JSON.parse(options) : options;
      if (parsed?.hasModifiers && parsed?.groups) return parsed;
      return null;
    } catch {
      return null;
    }
  }
}
