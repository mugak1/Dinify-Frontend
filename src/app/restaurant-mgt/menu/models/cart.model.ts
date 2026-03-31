export interface SelectedExtra {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  choices: {
    id: string;
    name: string;
    additionalCost: number;
  }[];
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
