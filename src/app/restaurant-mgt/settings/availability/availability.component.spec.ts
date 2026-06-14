import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AvailabilityComponent } from './availability.component';
import { RestaurantAvailabilityService } from 'src/app/_services/restaurant-availability.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { RestaurantDetail } from 'src/app/_models/app.models';

function makeDetail(acceptingOrders = true): RestaurantDetail {
  return { id: 'r1', accepting_orders: acceptingOrders } as RestaurantDetail;
}

describe('AvailabilityComponent', () => {
  let component: AvailabilityComponent;
  let fixture: ComponentFixture<AvailabilityComponent>;
  let svc: jasmine.SpyObj<RestaurantAvailabilityService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    svc = jasmine.createSpyObj<RestaurantAvailabilityService>(
      'RestaurantAvailabilityService',
      ['getDetail', 'save'],
    );
    svc.getDetail.and.returnValue(of(makeDetail(true)));
    svc.save.and.returnValue(of({}));

    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
      'clear',
    ]);

    await TestBed.configureTestingModule({
      imports: [AvailabilityComponent],
      providers: [
        provideRouter([]),
        { provide: RestaurantAvailabilityService, useValue: svc },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
  });

  it('creates and loads accepting_orders into state', () => {
    expect(component).toBeTruthy();
    expect(component.loadState).toBe('ready');
    expect(component.acceptingOrders).toBeTrue();
    expect(component.isDirty).toBeFalse();
  });

  it('sets the error state when the detail load fails', () => {
    svc.getDetail.and.returnValue(throwError(() => new Error('boom')));
    component.load();
    expect(component.loadState).toBe('error');
  });

  it('toggles the flag, marks dirty, and saves the new value', () => {
    component.onToggle(false);
    expect(component.isDirty).toBeTrue();

    component.onSave();

    expect(svc.save).toHaveBeenCalledTimes(1);
    expect(svc.save.calls.mostRecent().args[0]).toEqual({
      id: 'r1',
      accepting_orders: false,
    });
    expect(toast.success).toHaveBeenCalled();
    // Re-fetch (returns accepting_orders:true) re-syncs the loaded baseline.
    expect(component.isDirty).toBeFalse();
  });

  it('discards back to the loaded value and goes pristine', () => {
    component.onToggle(false);
    expect(component.isDirty).toBeTrue();

    component.onDiscard();

    expect(component.acceptingOrders).toBeTrue();
    expect(component.isDirty).toBeFalse();
  });
});
