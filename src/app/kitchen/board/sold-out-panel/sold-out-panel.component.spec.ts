import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { KitchenMenuItem } from '../../models/kitchen.models';
import { SoldOutPanelComponent } from './sold-out-panel.component';

/** Two sections, one sold-out item (m2). */
function items(): KitchenMenuItem[] {
  return [
    { id: 'm1', name: 'Margherita Pizza', in_stock: true, available: true, section_name: 'Pizzas' },
    { id: 'm2', name: 'Pepperoni Pizza', in_stock: false, available: true, section_name: 'Pizzas' },
    { id: 'm3', name: 'Cola', in_stock: true, available: true, section_name: 'Drinks' },
  ];
}

function rows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll('.sop-row')) as HTMLElement[];
}
function rowFor(host: HTMLElement, name: string): HTMLElement {
  return rows(host).find(r => (r.textContent ?? '').includes(name))!;
}

describe('SoldOutPanelComponent', () => {
  let fixture: ComponentFixture<SoldOutPanelComponent>;
  let component: SoldOutPanelComponent;

  beforeEach(async () => {
    const apiStub = {
      get: jasmine.createSpy('get').and.callFake(() =>
        of({ status: 200, data: { records: items() } })),
      postPatch: jasmine.createSpy('postPatch').and.returnValue(of({})),
    };
    const authStub = {
      userValue: {
        profile: { restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] }] },
      },
    };

    await TestBed.configureTestingModule({
      imports: [SoldOutPanelComponent],
      providers: [
        { provide: ApiService, useValue: apiStub },
        { provide: AuthenticationService, useValue: authStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SoldOutPanelComponent);
    component = fixture.componentInstance;
    component.stock.loadItems(); // populate via the synchronous api stub
    component.open = true;
  });

  it('renders items grouped by section', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Pizzas');
    expect(text).toContain('Drinks');
    expect(text).toContain('Margherita Pizza');
    expect(text).toContain('Cola');
  });

  it('shows the sold-out summary count', () => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('1 sold out');
  });

  it('applies the sold-out treatment to out-of-stock rows', () => {
    fixture.detectChanges();
    const soldOutRow = rowFor(fixture.nativeElement, 'Pepperoni Pizza');
    expect(soldOutRow.className).toContain('bg-red-50');
    expect(soldOutRow.textContent).toContain('Sold out');
  });

  it('toggles a row through the service', () => {
    const spy = spyOn(component.stock, 'toggleStock');
    fixture.detectChanges();
    rowFor(fixture.nativeElement, 'Margherita Pizza').click();
    expect(spy).toHaveBeenCalledWith('m1', false);
  });

  it('filters the list by the search box', () => {
    fixture.detectChanges();
    component.query.set('cola');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Cola');
    expect(text).not.toContain('Margherita Pizza');
  });

  it('emits closed when the X button is clicked', () => {
    const spy = jasmine.createSpy('closed');
    component.closed.subscribe(spy);
    fixture.detectChanges();
    const closeBtn = (fixture.nativeElement as HTMLElement)
      .querySelector('button[aria-label="Close sold-out panel"]') as HTMLElement;
    closeBtn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits closed when the scrim is clicked', () => {
    const spy = jasmine.createSpy('closed');
    component.closed.subscribe(spy);
    fixture.detectChanges();
    const scrim = (fixture.nativeElement as HTMLElement).querySelector('.sop-scrim') as HTMLElement;
    scrim.click();
    expect(spy).toHaveBeenCalled();
  });
});
