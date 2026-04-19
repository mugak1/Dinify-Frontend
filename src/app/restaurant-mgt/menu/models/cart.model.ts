import { SelectedModifier } from 'src/app/_models/app.models';

export { SelectedModifier } from 'src/app/_models/app.models';

export interface SelectedExtra {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
}

export interface CartItem {
  id: string;
  item: any;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  selectedExtras: SelectedExtra[];
  extrasTotal: number;
  modifiersTotal: number;
  itemPrice: number;
  totalPrice: number;
  originalPrice: number;
}
