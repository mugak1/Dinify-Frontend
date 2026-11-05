import { TestBed } from '@angular/core/testing';
import { OngoingOrderBannerComponent } from './ongoing-order-banner.component';
import { MenuNavStateService } from '../menu/menu-nav-state.service';
import { WINDOW } from '../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../_services/storage/storage-key-prefix.token';
import { readCurrentOrderHeld } from './current-order-held';
import { fingerprint, normalizedMarkup } from '../order-complete/markup-fingerprint.testing';

/** Rendered-markup fingerprint of this banner on unmodified main (0796844),
 *  taken before the template was edited. See `markup-fingerprint.testing.ts`. */
const MAIN_BANNER = 'ca1bb993';

describe('OngoingOrderBannerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OngoingOrderBannerComponent],
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(OngoingOrderBannerComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, text: () => (el.textContent ?? '').replace(/\s+/g, ' ') };
  }

  it('renders the ongoing-order title and explanation', () => {
    const { text } = render();
    expect(text()).toContain('Order in progress');
    expect(text()).toContain('order again once it has been served');
  });

  it('TODAY\'S SCAN (no held flag): byte-for-byte as main', () => {
    const { el } = render();
    expect(fingerprint(normalizedMarkup(el))).toBe(MAIN_BANNER);
  });

  it('held: "Order waiting", the contract\'s body, never "being prepared" or the kitchen', () => {
    TestBed.inject(MenuNavStateService).setTableOngoingOrderHeld(true);
    const { el, text } = render();
    expect(text()).toContain('Order waiting');
    expect(text()).toContain(
      'This table has an order waiting for staff to confirm it. Please ask a member of staff if you need help.');
    expect(text()).not.toContain('Order in progress');
    expect(text()).not.toContain('being prepared');
    expect(el.innerHTML.toLowerCase()).not.toContain('kitchen');
    expect(el.querySelector('[role="status"]')).toBeTruthy();
  });

  it('follows the flag both ways, back to main\'s markup', () => {
    const navState = TestBed.inject(MenuNavStateService);
    navState.setTableOngoingOrderHeld(true);
    const { fixture, el, text } = render();
    expect(text()).toContain('Order waiting');
    navState.setTableOngoingOrderHeld(false);
    fixture.detectChanges();
    expect(fingerprint(normalizedMarkup(el))).toBe(MAIN_BANNER);
  });
});

describe('readCurrentOrderHeld (table scan, current_order.held)', () => {
  it('is true only for an explicit true beside ongoing:true', () => {
    expect(readCurrentOrderHeld({ ongoing: true, order_id: 'o1', held: true })).toBeTrue();
  });

  it('a missing flag (today\'s scan) is released', () => {
    expect(readCurrentOrderHeld({ ongoing: true, order_id: 'o1' })).toBeFalse();
  });

  for (const held of ['true', 1, 'yes', {}, null, false]) {
    it(`a non-true flag (${JSON.stringify(held)}) is released`, () => {
      expect(readCurrentOrderHeld({ ongoing: true, order_id: 'o1', held })).toBeFalse();
    });
  }

  it('says nothing without an ongoing order', () => {
    expect(readCurrentOrderHeld({ ongoing: false, order_id: null, held: true })).toBeFalse();
  });

  for (const current of [undefined, null, 'held', true]) {
    it(`an unreadable current_order (${JSON.stringify(current)}) is released`, () => {
      expect(readCurrentOrderHeld(current)).toBeFalse();
    });
  }
});
