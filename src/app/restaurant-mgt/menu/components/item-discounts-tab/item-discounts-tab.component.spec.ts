import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItemDiscountsTabComponent } from './item-discounts-tab.component';

describe('ItemDiscountsTabComponent — date-window validation', () => {
  let component: ItemDiscountsTabComponent;
  let fixture: ComponentFixture<ItemDiscountsTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ItemDiscountsTabComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemDiscountsTabComponent);
    component = fixture.componentInstance;
  });

  it('hasDateError is true only when end is strictly before start', () => {
    component.startDate = '2026-06-24';
    component.endDate = '2026-06-19';
    expect(component.hasDateError).toBe(true);
  });

  it('hasDateError is false for equal, forward, or empty windows', () => {
    component.startDate = '2026-06-24';
    component.endDate = '2026-06-24'; // one-day window
    expect(component.hasDateError).toBe(false);

    component.endDate = '2026-06-30'; // end after start
    expect(component.hasDateError).toBe(false);

    component.startDate = '';
    component.endDate = ''; // unbounded
    expect(component.hasDateError).toBe(false);
  });

  it('isWindowPast is true for a past end date, false for today/future/empty', () => {
    component.startDate = '';
    component.endDate = '2000-01-01';
    expect(component.isWindowPast).toBe(true);

    component.endDate = '2999-12-31';
    expect(component.isWindowPast).toBe(false);

    component.endDate = '';
    expect(component.isWindowPast).toBe(false);
  });

  it('isWindowPast defers to hasDateError (no past-warning on an inverted window)', () => {
    component.startDate = '2026-06-24';
    component.endDate = '2000-01-01'; // past AND inverted
    expect(component.hasDateError).toBe(true);
    expect(component.isWindowPast).toBe(false);
  });
});
