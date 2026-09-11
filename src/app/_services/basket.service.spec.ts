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
