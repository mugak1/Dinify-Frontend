import { reviewQuote } from './quote-review';
import { BasketLineFacts, quoteMatchesBasket } from './quote-equivalence';
import {
  burger, chips, quoteBasket, quotedLine, quotePayload,
} from './quote-equivalence.fixture';

/**
 * The line-by-line check that decides whether the plain "Are you sure?" prompt
 * may stand in for the itemised review. Every NEGATIVE case below keeps the
 * grand total exactly equal to the basket's, because an equal total is the
 * thing the check exists to see past.
 */
describe('quoteMatchesBasket', () => {
  /** Start from the faithful quote, prove it is a confirmable itemised one. */
  function faithful(basket: BasketLineFacts[], options = {}) {
    const body = quoteBasket(basket, options);
    const review = reviewQuote(body);
    expect(review.readable).withContext('premise: readable').toBe(true);
    expect(review.itemised).withContext('premise: itemised').toBe(true);
    return body;
  }
  const matches = (basket: BasketLineFacts[], body: any) =>
    quoteMatchesBasket(basket, reviewQuote(body));
  /** The premise of every negative case: the grand total did NOT move. */
  const sameTotal = (body: any, total: string) => {
    expect(reviewQuote(body).readable).withContext('premise: still readable').toBe(true);
    expect(body.order_details.quote_total).withContext('premise: total unchanged').toBe(total);
  };

  it('CONTROL: an unchanged purchase is established', () => {
    const basket = [burger(), chips()];
    expect(matches(basket, faithful(basket))).toBe(true);
  });

  it('a relabelled choice under the SAME id and price is a change', () => {
    const basket = [burger()];
    const body = faithful(basket);
    body.quote[0].modifiers = ['Size: Extra large'];
    sameTotal(body, '14000.00');
    expect(matches(basket, body)).toBe(false);
  });

  it('a relabelled GROUP is a change too', () => {
    const basket = [burger()];
    const body = faithful(basket);
    body.quote[0].modifiers = ['Portion: Large'];
    expect(matches(basket, body)).toBe(false);
  });

  it('offsetting line prices under an unchanged total are a change', () => {
    const basket = [burger(), chips()];
    const burgerLine = quotedLine(basket[0], 0);
    const chipsLine = quotedLine(basket[1], 1);
    burgerLine.line_actual_cost = '12500.00';
    burgerLine.line_total_with_extras = '14500.00';
    chipsLine.line_actual_cost = '2500.00';
    chipsLine.line_total_with_extras = '2500.00';
    const body = quotePayload([burgerLine, chipsLine]);
    sameTotal(body, '17000.00');
    expect(matches(basket, body)).toBe(false);
  });

  it('an option price moved against the dish price is a change', () => {
    const basket = [burger()];
    const body = faithful(basket);
    body.quote[0].unit_cost_of_options = '1500.00';
    sameTotal(body, '14000.00');
    expect(matches(basket, body)).toBe(false);
  });

  it('an extra priced differently, offset by the dish, is a change', () => {
    const basket = [burger()];
    const body = faithful(basket);
    body.quote[0].extras[0].actual_cost = '3000.00';
    body.quote[0].line_actual_cost = '11000.00';
    sameTotal(body, '14000.00');
    expect(matches(basket, body)).toBe(false);
  });

  it('a renamed extra is a change', () => {
    const basket = [burger()];
    const body = faithful(basket);
    body.quote[0].extras[0].item_name = 'Vegan cheese';
    expect(matches(basket, body)).toBe(false);
  });

  it('a different extra, or a different choice id, cannot be paired', () => {
    const basket = [burger()];
    const swappedExtra = faithful(basket);
    swappedExtra.quote[0].extras[0].item = 'x2';
    expect(matches(basket, swappedExtra)).toBe(false);

    const swappedChoice = faithful(basket);
    swappedChoice.quote[0].selected_modifiers = { 'g-size': ['c-medium'] };
    expect(matches(basket, swappedChoice)).toBe(false);
  });

  it('a renamed dish is a change', () => {
    const basket = [chips()];
    const body = faithful(basket);
    body.quote[0].item_name = 'Fries';
    expect(matches(basket, body)).toBe(false);
  });

  it('a different quantity is a change', () => {
    const basket = [chips({ quantity: 2 })];
    const body = quotePayload([quotedLine(chips({ quantity: 1, basePrice: 6000 }))]);
    sameTotal(body, '6000.00');
    expect(matches(basket, body)).toBe(false);
  });

  it('a missing or extra line is a change', () => {
    expect(matches([burger(), chips()], faithful([burger()]))).toBe(false);
    expect(matches([burger()], faithful([burger(), chips()]))).toBe(false);
  });

  it('CONTROL: the diner\'s tapping order changes nothing', () => {
    const basket = [burger({
      selectedModifiers: [
        { groupId: 'g-top', groupName: 'Toppings', choices: [
          { id: 'c-bacon', name: 'Bacon', additionalCost: 500 },
          { id: 'c-cheese', name: 'Cheese', additionalCost: 500 },
        ] },
        { groupId: 'g-size', groupName: 'Size', choices: [
          { id: 'c-large', name: 'Large', additionalCost: 1000 },
        ] },
      ],
    })];
    // The server lists choices in MENU order, which is not the tapping order.
    const body = faithful(basket, { definitionOrder: { 'g-top': ['c-cheese', 'c-bacon'] } });
    expect(body.quote[0].modifiers).toContain('Toppings: Cheese, Bacon');
    // ...and its groups in whatever order its stored selection has them.
    body.quote[0].modifiers = [...body.quote[0].modifiers].reverse();
    expect(matches(basket, body)).toBe(true);
  });

  it('CONTROL: two basket lines the server merged into one row still match', () => {
    const one = chips({ quantity: 1 });
    const again = chips({ quantity: 2 });
    const body = faithful([chips({ quantity: 3 })]);
    expect(matches([one, again], body)).toBe(true);
  });

  it('two basket lines of one configuration that SHOWED different prices cannot merge', () => {
    const body = faithful([chips({ quantity: 2 })]);
    expect(matches([chips({ quantity: 1 }), chips({ quantity: 1, basePrice: 3500 })], body))
      .toBe(false);
  });

  it('two server rows for one configuration are ambiguous', () => {
    const line = chips();
    const body = quotePayload([quotedLine(line, 0), quotedLine(line, 1)]);
    expect(matches([chips({ quantity: 2 })], body)).toBe(false);
  });

  it('a row with no selection to pair by is not established', () => {
    const basket = [chips()];
    const body = faithful(basket);
    delete body.quote[0].selected_modifiers;
    expect(reviewQuote(body).readable).withContext('premise').toBe(true);
    expect(matches(basket, body)).toBe(false);
  });

  it('a LEGACY quote, readable but not itemised, is never established', () => {
    const basket = [chips()];
    const body = quotePayload([], { pricing_version: 0, quote_total: '3000.00',
                                    actual_cost: '3000.00', no_available_items: 1 });
    expect(reviewQuote(body).readable).withContext('premise: readable').toBe(true);
    expect(reviewQuote(body).itemised).withContext('premise: legacy').toBe(false);
    expect(matches(basket, body)).toBe(false);
  });

  it('an unreadable quote, an unavailable line and an empty basket are never established', () => {
    const basket = [chips()];
    const unreadable = faithful(basket);
    unreadable.order_details.quote_total = '9.999';
    expect(matches(basket, unreadable)).toBe(false);

    const gone = faithful(basket);
    gone.quote[0].available = false;
    expect(matches(basket, gone)).toBe(false);

    expect(quoteMatchesBasket([], reviewQuote(faithful(basket)))).toBe(false);
    expect(quoteMatchesBasket(null, reviewQuote(faithful(basket)))).toBe(false);
  });

  it('a basket line whose own amount cannot be read is not established', () => {
    const body = faithful([chips()]);
    expect(matches([chips({ basePrice: 'n/a' })], body)).toBe(false);
  });

  it('CONTROL: a free dish and a signed option ("no cheese, -500") still match', () => {
    const basket = [chips({ basePrice: 0 }), burger({
      selectedModifiers: [{ groupId: 'g-c', groupName: 'Cheese',
        choices: [{ id: 'c-none', name: 'No cheese', additionalCost: -500 }] }],
    })];
    expect(matches(basket, faithful(basket))).toBe(true);
  });
});
