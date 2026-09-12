import { TestBed } from '@angular/core/testing';
import { BasketService } from './basket.service';
import { SessionStorageService } from './storage/session-storage.service';
import { WINDOW } from './storage/window.token';
import { STORAGE_KEY_PREFIX } from './storage/storage-key-prefix.token';
import { BasketItem, SelectedModifier } from '../_models/app.models';

describe('BasketService (line identity, D03 client half)', () => {
  let service: BasketService;

  const mods = (
    spec: Record<string, string[]>,
  ): SelectedModifier[] =>
    Object.entries(spec).map(([groupId, choices]) => ({
      groupId,
      groupName: groupId,
      choices: choices.map((id) => ({ id, name: id, additionalCost: 0 })),
    }));

  const item = (over: Partial<BasketItem> = {}): BasketItem =>
    ({
      itemId: 'i1',
      itemName: 'Burger',
      basePrice: 5000,
      totalPrice: 5000,
      quantity: 1,
      selectedModifiers: [],
      extras: [],
      isDiscounted: false,
      ...over,
    }) as BasketItem;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        BasketService,
        SessionStorageService,
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'spec:' },
      ],
    });
    service = TestBed.inject(BasketService);
  });

  afterEach(() => sessionStorage.clear());

  const lines = () => service.Basket().items;

  describe('merging: the same variant is one line', () => {
    it('merges two identical plain lines', () => {
      service.addItem(item());
      service.addItem(item());
      expect(lines().length).toBe(1);
      expect(lines()[0].quantity).toBe(2);
    });

    // THE D03 defect in miniature: JSON.stringify made identity depend on the
    // order the diner tapped the choices in, so the basket showed two lines
    // where the server saved one and the kitchen ticket agreed with neither.
    it('merges the same selection submitted in a different order', () => {
      service.addItem(item({ selectedModifiers: mods({ g1: ['cheese', 'bacon'] }) }));
      service.addItem(item({ selectedModifiers: mods({ g1: ['bacon', 'cheese'] }) }));
      expect(lines().length).toBe(1);
      expect(lines()[0].quantity).toBe(2);
    });

    it('merges the same groups listed in a different order', () => {
      service.addItem(item({ selectedModifiers: mods({ g1: ['a'], g2: ['b'] }) }));
      service.addItem(item({ selectedModifiers: mods({ g2: ['b'], g1: ['a'] }) }));
      expect(lines().length).toBe(1);
    });

    it('merges the same extras listed in a different order', () => {
      service.addItem(item({ extras: [{ id: 'e1' }, { id: 'e2' }] as any }));
      service.addItem(item({ extras: [{ id: 'e2' }, { id: 'e1' }] as any }));
      expect(lines().length).toBe(1);
    });

    // Canonicalisation collapses a repeated choice server-side, so it must
    // collapse here too or the two sides count lines differently.
    it('merges a repeated choice with its de-duplicated form', () => {
      service.addItem(item({ selectedModifiers: mods({ g1: ['c1', 'c1'] }) }));
      service.addItem(item({ selectedModifiers: mods({ g1: ['c1'] }) }));
      expect(lines().length).toBe(1);
    });

    it('treats an empty group as no selection at all', () => {
      service.addItem(item({ selectedModifiers: mods({ g1: [] }) }));
      service.addItem(item());
      expect(lines().length).toBe(1);
    });

    // Identity is built from IDs alone: a label or price that drifted between
    // two adds must not split one dish into two lines.
    it('ignores display labels and prices', () => {
      service.addItem(item({ itemName: 'Burger', basePrice: 5000 }));
      service.addItem(item({ itemName: 'BURGER (new)', basePrice: 5500 }));
      expect(lines().length).toBe(1);
    });
  });

  describe('separating: different configurations are different lines', () => {
    it('keeps a modified line apart from a plain one', () => {
      service.addItem(item());
      service.addItem(item({ selectedModifiers: mods({ g1: ['cheese'] }) }));
      expect(lines().length).toBe(2);
    });

    it('keeps lines that differ only by extras apart', () => {
      service.addItem(item({ extras: [{ id: 'e1' }] as any }));
      service.addItem(item({ extras: [{ id: 'e2' }] as any }));
      expect(lines().length).toBe(2);
    });

    it('keeps the same choice id in different groups apart', () => {
      service.addItem(item({ selectedModifiers: mods({ g1: ['c1'] }) }));
      service.addItem(item({ selectedModifiers: mods({ g2: ['c1'] }) }));
      expect(lines().length).toBe(2);
    });

    it('keeps different dishes apart', () => {
      service.addItem(item());
      service.addItem(item({ itemId: 'i2' }));
      expect(lines().length).toBe(2);
    });
  });

  describe('removeItem matches the FULL variant', () => {
    // It used to ignore extras entirely, so removing from a basket holding two
    // variants of one dish removed whichever came first — a different dish from
    // the one the diner pointed at.
    it('removes the line whose extras match, not merely the first dish', () => {
      service.addItem(item({ extras: [{ id: 'e1' }] as any }));
      service.addItem(item({ extras: [{ id: 'e2' }] as any }));

      service.removeItem('i1', [], [{ id: 'e2' }]);

      expect(lines().length).toBe(1);
      expect((lines()[0].extras as any[])[0].id).toBe('e1');
    });

    it('removes the line whose modifiers match', () => {
      service.addItem(item({ selectedModifiers: mods({ g1: ['cheese'] }) }));
      service.addItem(item({ selectedModifiers: mods({ g1: ['bacon'] }) }));

      service.removeItem('i1', mods({ g1: ['bacon'] }), []);

      expect(lines().length).toBe(1);
      expect(lines()[0].selectedModifiers[0].choices[0].id).toBe('cheese');
    });

    it('decrements rather than deleting when more than one unit remains', () => {
      service.addItem(item({ quantity: 3 }));
      service.removeItem('i1', [], []);
      expect(lines().length).toBe(1);
      expect(lines()[0].quantity).toBe(2);
    });

    it('does nothing when no line matches the variant', () => {
      service.addItem(item({ extras: [{ id: 'e1' }] as any }));
      service.removeItem('i1', [], [{ id: 'e9' }]);
      expect(lines().length).toBe(1);
    });
  });

  describe('the idempotency key and the revision', () => {
    it('reuses one key while the basket is unchanged', () => {
      service.addItem(item());
      const key = service.getOrCreateClientOrderId();
      expect(service.getOrCreateClientOrderId()).toBe(key);
    });

    // A new key would turn one attempt into two orders, which is precisely what
    // the key exists to prevent. A lost response is not a basket change.
    it('keeps the key across repeated reads — it is never re-minted on failure', () => {
      service.addItem(item());
      const key = service.getOrCreateClientOrderId();
      expect(service.getOrCreateClientOrderId()).toBe(key);
      expect(service.getOrCreateClientOrderId()).toBe(key);
    });

    it('starts a fresh key once the basket really changes', () => {
      service.addItem(item());
      const key = service.getOrCreateClientOrderId();
      service.addItem(item({ itemId: 'i2' }));
      expect(service.getOrCreateClientOrderId()).not.toBe(key);
    });

    it('bumps the revision on every content change', () => {
      const start = service.revision();
      service.addItem(item());
      expect(service.revision()).toBeGreaterThan(start);
      const afterAdd = service.revision();
      service.incrementItem(0);
      expect(service.revision()).toBeGreaterThan(afterAdd);
    });
  });

  describe('a restored basket the server would now refuse', () => {
    // The server legitimately merges several valid lines into one stored row
    // ABOVE the per-line submit ceiling, so such a basket is not corrupt — it
    // simply cannot be submitted as it stands, and must stay reducible.
    it('lets an over-ceiling line be reduced', () => {
      service.addItem(item({ quantity: 140 }));
      service.decrementItem(0);
      expect(lines()[0].quantity).toBe(139);
    });

    it('does not clamp or drop an over-ceiling line on load', () => {
      service.addItem(item({ quantity: 140 }));
      expect(lines().length).toBe(1);
      expect(lines()[0].quantity).toBe(140);
    });
  });
});

describe('BasketService total exactness (R3b)', () => {
  let service: BasketService;

  const item = (over: Partial<BasketItem> = {}): BasketItem =>
    ({
      itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
      quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
      ...over,
    }) as BasketItem;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        BasketService,
        SessionStorageService,
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'spec-total:' },
      ],
    });
    service = TestBed.inject(BasketService);
  });

  afterEach(() => sessionStorage.clear());

  it('reports an ordinary basket as EXACT', () => {
    const state = service.totalState([item({ quantity: 3 })]);
    expect(state).toEqual({ amount: 15000, exact: true });
  });

  it('applies the server rounding rule rather than double arithmetic', () => {
    // Two sub-cent adjustments on a 1000 base: the server quantizes each
    // component half-even to 1.00, so the unit is exactly 1002.00. In doubles
    // the same sum is 1002.0099999999999.
    const state = service.totalState([item({
      basePrice: 1000, totalPrice: 1000,
      selectedModifiers: [{
        groupId: 'g', groupName: 'g',
        choices: [
          { id: 'a', name: 'a', additionalCost: 1.005 },
          { id: 'b', name: 'b', additionalCost: 1.005 },
        ],
      }],
    })]);
    expect(state).toEqual({ amount: 1002, exact: true });
  });

  it('reads an ABSENT optional adjustment as zero, not as malformed', () => {
    // `additionalCost` and an extra's `cost` have an established meaning of
    // zero when absent. That is not the same fact as an explicitly malformed
    // monetary value, and conflating them would make ordinary legacy baskets
    // inexact for no reason.
    const state = service.totalState([item({
      selectedModifiers: [{
        groupId: 'g', groupName: 'g',
        choices: [{ id: 'a', name: 'a' } as any],
      }],
      extras: [{ id: 'x' } as any],
    })]);
    expect(state).toEqual({ amount: 5000, exact: true });
  });

  it('parses a legacy decimal-STRING component rather than refusing it', () => {
    const state = service.totalState([item({ basePrice: '4500.50' as any })]);
    expect(state).toEqual({ amount: 4500.5, exact: true });
  });

  it('reports a genuinely unreadable component as an ESTIMATE, not as exact', () => {
    // THE DEFECT THIS CLOSES. The exact helper returns `null` here, and the
    // service used to hand the old double arithmetic back as an ordinary
    // total — a figure it had just established it could not represent,
    // presented with the same confidence as one it could.
    const state = service.totalState([item({
      basePrice: 'not-a-price' as any, totalPrice: 5000, quantity: 2,
    })]);
    expect(state.exact).toBeFalse();
    // The estimate is the SAME arithmetic as before, so a stored basket keeps
    // behaving exactly as it did; only the claim about the number changes.
    expect(state.amount).toBe(10000);
  });

  it('reports an out-of-range basket as an ESTIMATE', () => {
    const state = service.totalState([item({
      basePrice: 1e13, totalPrice: 1e13,
    })]);
    expect(state.exact).toBeFalse();
  });

  it('reports a fractional quantity as an ESTIMATE', () => {
    const state = service.totalState([item({ quantity: 1.5 })]);
    expect(state.exact).toBeFalse();
  });

  it('keeps calculateTotalAmount returning the same number it always did', () => {
    // The persisted `totalAmount` shape is unchanged — no storage migration.
    expect(service.calculateTotalAmount([item({ quantity: 2 })])).toBe(10000);
    expect(service.calculateTotalAmount([
      item({ basePrice: 'not-a-price' as any, totalPrice: 5000, quantity: 2 }),
    ])).toBe(10000);
  });

  it('leaves the basket itself untouched when a total cannot be stated exactly', () => {
    const broken = item({ basePrice: 'not-a-price' as any });
    service.addItem(broken);
    expect(service.Basket().items.length).toBe(1);
    expect(service.Basket().items[0].basePrice).toBe('not-a-price' as any);
  });

  it('is empty-safe', () => {
    expect(service.totalState([])).toEqual({ amount: 0, exact: true });
  });
});
