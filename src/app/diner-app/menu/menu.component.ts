import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MenuItem, ModifierGroup, Restaurant, SelectedModifier } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { parseModifierGroups } from 'src/app/_common/utils/modifier-utils';
import { environment } from 'src/environments/environment';
import { MenuNavStateService } from './menu-nav-state.service';

@Component({
    selector: 'app-diners-menu',
    templateUrl: './menu.component.html',
    styleUrls: ['./menu.component.css'],
    standalone: false
})
export class DinersMenuComponent implements OnInit, OnDestroy {
  url = environment.apiUrl;

  globalError:string|null=null;
  selected_extras: any[]=[];
  formSubmitted = false;
  isInRestApp = false;
  private storageSub?: Subscription;

  @Input() restaurant?:Restaurant;
  @Input()restaurant_id:any='';
  menu_list?:MenuItem[]|any=[];
  basketItems = this.basketService.Basket().items;
  totalAmount = this.basketService.Basket().totalAmount;
  showModal=false;
  selected_item!:MenuItem|any
  heroImageLoaded: boolean = false;
  selected_quantity:number=1;
  selected_amount:number=0;
  modifierGroups: ModifierGroup[] = [];
  selectedModifiers: Record<string, string[]> = {};
  currentSectionItem=''
  errorMessages: any[]=[];
  isFormValidFlag: boolean=true;
  editingBasketIndex: number | null = null;
  isEditMode = false;

  constructor(
    private sessionStorage: SessionStorageService,
    private api: ApiService,
    private basketService: BasketService,
    private router: Router,
    private fb: FormBuilder,
    public navState: MenuNavStateService,
  ) {
  this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  this.navState.setPresetTags(this.restaurant?.preset_tags || []);
  this.udpateCart();

  // When coming directly from a QR scan, the table-scan API call in the
  // DinerAppComponent wrapper may not have resolved yet — so session storage
  // may still be empty. Wait for the `restaurant` key to be set, then load.
  if (!this.restaurant) {
    this.storageSub = this.sessionStorage.StorageValue.subscribe((key: any) => {
      if (typeof key !== 'string' || !key.includes('restaurant')) return;
      const r = this.sessionStorage.getItem<Restaurant>('restaurant') as any;
      if (!r) return;
      this.restaurant = r;
      this.navState.setPresetTags(this.restaurant?.preset_tags || []);
      this.storageSub?.unsubscribe();
      this.storageSub = undefined;
      this.tryLoadMenu();
    });
  }
  }

  /** Filters out empty/blank allergen entries */
  getVisibleAllergens(allergens: string[] | null | undefined): string[] {
    if (!Array.isArray(allergens)) return [];
    return allergens.filter((a: any) => typeof a === 'string' && a.trim().length > 0);
  }

  getTagItemCount(tagName: string): number {
    if (!this.menu_list) return 0;
    let count = 0;
    for (const section of this.menu_list) {
      for (const item of section.items || []) {
        if (item.allergens?.includes(tagName)) count++;
      }
    }
    return count;
  }

  ngOnInit(){
    this.isInRestApp = this.router.url.includes('rest-app');
    this.navState.setMenuActive(true);
    // If restaurant is already available (session storage sync-read OR @Input()
    // from staff ordering), proceed immediately. Otherwise the StorageValue
    // subscription in the constructor will call tryLoadMenu() once it arrives.
    if (this.restaurant) {
      this.tryLoadMenu();
    }
  }

  ngOnDestroy(): void {
    this.storageSub?.unsubscribe();
    this.navState.setMenuActive(false);
    this.navState.setMenuList(null);
    this.navState.setLoading(true);
    this.navState.searchQuery.set('');
    this.navState.showSearch.set(false);
    this.navState.selectedTags.set([]);
    this.navState.showTagFilter.set(false);
    this.navState.currentSection.set('');
    this.navState.clearPendingClickTarget();
  }

  private tryLoadMenu(): void {
    if(this.restaurant?.menu_approval_status=='approve'||(this.restaurant as any)?.first_time_menu_approval){
      this.loadMenu()
    }else{
      if(!this.router.url.includes('rest-app')){
      this.router.navigate(['/diner','error'])
      }else{
        this.router.navigate([this.router.url,'error'])
      }
    }
  }

  /**
   * Computes the total price for the current item including selected
   * modifiers, extras, and quantity — used for the dynamic
   * "Add — UGX X,XXX" button.
   */
  get computedItemTotal(): number {
    if (!this.selected_item) return 0;
    const basePrice = this.selected_item?.running_discount
      ? (Number(this.selected_item?.discount_details?.discount_amount) || 0)
      : (Number(this.selected_item.primary_price) || 0);
    let modifiersCost = 0;
    for (const group of this.modifierGroups) {
      const selectedIds = this.selectedModifiers[group.id] || [];
      for (const choiceId of selectedIds) {
        const choice = group.choices.find(c => c.id === choiceId);
        if (choice) modifiersCost += choice.additionalCost;
      }
    }
    const extrasCost = this.selected_extras.reduce(
      (acc: number, extra: any) => acc + (Number(extra.primary_price) || 0), 0
    );
    return (basePrice + modifiersCost + extrasCost) * this.selected_quantity;
  }
  removeItem(Id: string) {
    this.basketService.removeItem(Id);
    this.udpateCart();
  }
get QuantitySum(){
 return this.basketItems.reduce((a, b) => a + b.quantity,0)
}
  udpateCart() {
    // Update cartItems and totalAmount after removing an item
    this.basketItems = this.basketService.Basket().items;
    this.totalAmount = this.basketService.Basket().totalAmount;
    this.SaveForProcessing();
  }
  loadMenu(){
    this.navState.setLoading(true);
    this.api.get<MenuItem>(null,'orders/journey/show-menu/',{restaurant:this.restaurant_id?this.restaurant_id:this.restaurant?.id}).subscribe({
      next: (x:any) => {
        this.menu_list=(x?.data as any) ?? [];
        this.navState.setMenuList(this.menu_list);
        this.navState.filterMenu();
        const firstSectionName = (this.menu_list?.[0] as MenuItem)?.name as string | undefined;
        this.navState.setCurrentSection(
          this.navState.featuredItems().length > 0 ? 'Featured' : (firstSectionName ?? '')
        );
        // Cache upsell config so the basket can render it without another round-trip
        if (x?.upsell) {
          this.sessionStorage.setItem('upsellConfig', x.upsell);
        } else {
          this.sessionStorage.removeItem?.('upsellConfig');
        }
        // If the user tapped a basket item, re-open the detail modal pre-populated
        this.checkEditMode();
        // Keep the skeleton visible until every item image has been preloaded
        // into the browser cache, so the reveal paints with no pop-in. A 5s
        // timeout caps the wait in case a CDN stalls.
        this.preloadImages(this.menu_list).then(() => {
          this.navState.setLoading(false);
        });
      },
      error: () => {
        this.navState.setLoading(false);
      }
    })
  }

  /**
   * Preloads every item image in the menu into the browser cache.
   * Resolves when all images have fired load or error, or after 5s — whichever
   * comes first. Broken images never block; a missing image list short-circuits.
   */
  private preloadImages(menuSections: any[]): Promise<void> {
    const imageUrls: string[] = [];
    for (const section of menuSections || []) {
      for (const item of section?.items || []) {
        if (item?.image) {
          imageUrls.push(this.url + item.image);
        }
      }
    }

    if (imageUrls.length === 0) {
      return Promise.resolve();
    }

    const imagePromises = imageUrls.map(url =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      })
    );

    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
    return Promise.race([Promise.all(imagePromises).then(() => {}), timeout]);
  }

  /**
   * Locates a menu item by its id across all sections of the loaded menu.
   */
  findMenuItemById(itemId: string): any {
    for (const section of this.menu_list || []) {
      const item = (section.items || []).find((i: any) => i.id === itemId);
      if (item) return item;
    }
    return null;
  }

  /**
   * If sessionStorage has an `editingBasketItem` context, enter edit mode:
   * pre-populate the detail modal selections from the basket item and open it.
   */
  private checkEditMode(): void {
    const editContext = this.sessionStorage.getItem<any>('editingBasketItem');
    if (!editContext) return;
    // Clear immediately so it doesn't re-fire on a future menu visit
    this.sessionStorage.removeItem('editingBasketItem');

    const menuItem = this.findMenuItemById(editContext.itemId);
    if (!menuItem) return;

    const basketItem = this.basketItems[editContext.basketIndex];
    if (!basketItem) return;

    this.editingBasketIndex = editContext.basketIndex;
    this.isEditMode = true;

    this.selected_item = menuItem;
    this.selected_quantity = basketItem.quantity;
    this.modifierGroups = parseModifierGroups(menuItem.options);

    // Reconstruct selectedModifiers from stored groupId → choiceIds mapping
    this.selectedModifiers = {};
    for (const mod of (basketItem.selectedModifiers || [])) {
      this.selectedModifiers[mod.groupId] = mod.choices.map((c: any) => c.id);
    }

    // Reconstruct selected_extras by id (use the menuItem's own refs so
    // isExtraSelected's identity-based check matches)
    this.selected_extras = (basketItem.extras || [])
      .map((ext: any) => (menuItem.extras || []).find((e: any) => e.id === ext.id))
      .filter(Boolean);

    this.heroImageLoaded = false;
    this.validateForm();
    this.showModal = true;
  }

  private resetEditMode(): void {
    this.isEditMode = false;
    this.editingBasketIndex = null;
    this.selected_quantity = 1;
    this.selectedModifiers = {};
    this.selected_extras = [];
  }

  SaveForProcessing(){
    this.sessionStorage.setItem('Basket',this.basketItems);

  }
  viewItem(i:MenuItem){
    if (this.isOutOfStock(i)) return;
    this.selected_item = i as any;
    this.modifierGroups = parseModifierGroups(i.options);
    this.selectedModifiers = {};
    this.selected_extras = [];
    this.heroImageLoaded = false;
    this.validateForm();
    this.showModal = true;
  }
  closeModal(){
    this.showModal=false;
    if (this.isEditMode) {
      this.resetEditMode();
      this.router.navigate(['/diner/basket']);
    }
  }
  AddSelectedItem(){
    this.formSubmitted = false;
    if (!this.isFormValid()) {
      this.formSubmitted = true;
      return;
    }

    const selectedModifiersList: SelectedModifier[] = this.modifierGroups
      .filter(g => (this.selectedModifiers[g.id] || []).length > 0)
      .map(g => ({
        groupId: g.id,
        groupName: g.name,
        choices: (this.selectedModifiers[g.id] || [])
          .map(cid => g.choices.find(c => c.id === cid))
          .filter(Boolean)
          .map(c => ({ id: c!.id, name: c!.name, additionalCost: c!.additionalCost })),
      }));

    const selectedExtras = this.selected_extras.map((extra) => ({
      id: extra.id,
      name: extra.name,
      cost: Number(extra.primary_price) || 0,
    }));

    const discount = Number(this.selected_item?.discount_details?.discount_amount) || 0;
    const isDiscounted = this.selected_item?.running_discount;

    const originalBasePrice = Number(this.selected_item?.primary_price) || 0;
    const basePrice = isDiscounted ? discount : originalBasePrice;

    const modifiersCost = selectedModifiersList.reduce(
      (acc, mod) => acc + mod.choices.reduce((s, c) => s + c.additionalCost, 0),
      0
    );
    const extrasCost = selectedExtras.reduce((acc, extra) => acc + extra.cost, 0);
    const totalPrice = basePrice + modifiersCost + extrasCost;

    const basketItem = {
      itemId: this.selected_item.id,
      itemName: this.selected_item.name,
      image: this.selected_item.image || null,
      basePrice: basePrice,
      totalPrice: totalPrice,
      quantity: this.selected_quantity,
      selectedModifiers: selectedModifiersList,
      extras: selectedExtras,
      isDiscounted: isDiscounted,
      originalBasePrice: isDiscounted ? originalBasePrice : undefined,
      discountAmount: isDiscounted ? originalBasePrice - basePrice : undefined,
      discountPercentage: isDiscounted ? Math.round((1 - basePrice / originalBasePrice) * 100) : undefined
    };

    if (this.isEditMode && this.editingBasketIndex !== null) {
      this.basketService.updateItem(this.editingBasketIndex, basketItem);
      this.udpateCart();
      this.closeModal();
      return;
    }

    this.basketService.addItem(basketItem);
    this.udpateCart();
    this.closeModal();
    this.selected_quantity = 1;
    this.selectedModifiers = {};
    this.selected_extras = [];
  }

addUnderScore(x:string){
  return x.replace(/ /g,"_");
}

removeUnderscore(x:string){
  return x.replace(/_/g," ");
}
  onSectionChange(sectionId: string): void {
    const pending = this.navState.pendingClickTarget();
    if (pending) {
      if (sectionId === pending) {
        // Scroll has arrived at the click target — commit and release the lock.
        this.navState.setCurrentSection(sectionId);
        this.navState.clearPendingClickTarget();
      }
      // Otherwise: the smooth-scroll animation is mid-flight and the spy is
      // emitting intermediate sections. Don't clobber the click's intent.
      return;
    }
    this.navState.setCurrentSection(sectionId);
  }

  scrollTo(section:any,_i:number) {
    document.querySelector('#' + this.addUnderScore(section))?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  }
  checkSelected(): any {
    return this.selected_quantity > 1 ? this.selected_quantity-- : null
  }
  AddSelected(): any {
    this.selected_quantity++
  }
  sanitizeId(name: string): string {
    return name.replace(/\s+/g, '-').toLowerCase();
  }

  isModifierChoiceSelected(groupId: string, choiceId: string): boolean {
    return (this.selectedModifiers[groupId] || []).includes(choiceId);
  }

  getModifierSelectedCount(groupId: string): number {
    return (this.selectedModifiers[groupId] || []).length;
  }

  handleModifierSingleSelect(groupId: string, choiceId: string): void {
    const current = this.selectedModifiers[groupId] || [];
    if (current.length === 1 && current[0] === choiceId) {
      this.selectedModifiers = { ...this.selectedModifiers, [groupId]: [] };
    } else {
      this.selectedModifiers = { ...this.selectedModifiers, [groupId]: [choiceId] };
    }
    this.validateForm();
  }

  handleModifierMultiSelect(
    groupId: string,
    choiceId: string,
    checked: boolean,
    maxSelections: number
  ): void {
    const current = this.selectedModifiers[groupId] || [];
    if (checked) {
      if (current.length >= maxSelections) return;
      this.selectedModifiers = { ...this.selectedModifiers, [groupId]: [...current, choiceId] };
    } else {
      this.selectedModifiers = {
        ...this.selectedModifiers,
        [groupId]: current.filter((id) => id !== choiceId),
      };
    }
    this.validateForm();
  }

  validateForm(): void {
    this.errorMessages = [];
    for (const group of this.modifierGroups) {
      const selectedCount = (this.selectedModifiers[group.id] || []).length;
      if (group.minSelections > 0 && selectedCount < group.minSelections) {
        this.errorMessages.push(
          group.minSelections === 1
            ? `Please select an option for "${group.name}".`
            : `Please select at least ${group.minSelections} options for "${group.name}".`
        );
      }
    }
    this.isFormValidFlag = this.errorMessages.length === 0;
  }

  isFormValid(): boolean {
    return this.isFormValidFlag;
  }

  submitForm(): void {
    this.validateForm();
  }
  calculateDiscount(item:any): number {
    if (!item?.discount_details?.discount_amount) return 0;
    const price = Number(item.primary_price) || 0;
    const discountAmt = Number(item.discount_details.discount_amount) || 0;
    return Math.round(((price - discountAmt) / price) * 100);
  }
  priceSaved(item:any): number {
    if (!item?.discount_details?.discount_amount) return 0;
    return Number(item.primary_price) - Number(item.discount_details.discount_amount);
  }
  isOutOfStock(item: any): boolean {
    return item.in_stock === false;
  }
  getDiscountBadge(item: any): string {
    if (!item?.running_discount) return '';
    const pct = this.calculateDiscount(item);
    return pct > 0 ? `-${pct}%` : '';
  }
  isExtraSelected(extra: {id:any,name:any, primary_price:number}): boolean {
    return this.selected_extras.includes(extra);
  }
  SetExtra(i:number,extra:{id:any,name:any, primary_price:number}){
    const index = this.selected_extras.findIndex(x => x.id === extra.id);

    if (index === -1) {
      this.selected_extras.push(extra);
    } else {
      this.selected_extras.splice(index, 1);
    }

  }

}
