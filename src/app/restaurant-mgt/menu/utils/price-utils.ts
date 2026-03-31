export function formatUGX(amount: number): string {
  if (amount == null || isNaN(amount)) return 'UGX 0';
  return `UGX ${amount.toLocaleString('en-UG')}`;
}

export function isDiscountActive(discountDetails: any): boolean {
  if (!discountDetails || !discountDetails.discount_amount) return false;

  const now = new Date();

  if (!discountDetails.start_date || !discountDetails.end_date) return false;
  const start = new Date(discountDetails.start_date);
  const end = new Date(discountDetails.end_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
  if (now < start || now > end) return false;

  if (
    Array.isArray(discountDetails.recurring_days) &&
    discountDetails.recurring_days.length > 0
  ) {
    // JS getDay(): 0=Sun,1=Mon,...,6=Sat → backend: 1=Mon,...,7=Sun
    const jsDay = now.getDay();
    const backendDay = jsDay === 0 ? 7 : jsDay;
    return discountDetails.recurring_days.includes(backendDay);
  }

  return true;
}

export function getCurrentPrice(item: any): number {
  const primaryPrice = parseFloat(item.primary_price) || 0;
  if (isDiscountActive(item.discount_details)) {
    const discountAmount = parseFloat(item.discount_details.discount_amount) || 0;
    return Math.max(0, primaryPrice - discountAmount);
  }
  return primaryPrice;
}

export function getDiscountBadgeText(
  discountDetails: any,
  primaryPrice: number
): string {
  if (!isDiscountActive(discountDetails) || !primaryPrice) return '';

  const discountAmount = parseFloat(discountDetails.discount_amount) || 0;
  const percentage = Math.round((discountAmount / primaryPrice) * 100);
  return `-${percentage}%`;
}

export function calculateSavings(
  primaryPrice: number,
  discountDetails: any
): number {
  if (!isDiscountActive(discountDetails)) return 0;
  return parseFloat(discountDetails.discount_amount) || 0;
}
