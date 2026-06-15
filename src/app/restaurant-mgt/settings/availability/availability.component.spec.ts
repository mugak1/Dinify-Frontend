import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AvailabilityComponent } from './availability.component';
import {
  AvailabilityFieldsPayload,
  RestaurantAvailabilityService,
} from 'src/app/_services/restaurant-availability.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import {
  DayHours,
  OpeningHours,
  OpeningHoursDay,
  RestaurantDetail,
} from 'src/app/_models/app.models';

const DAYS: OpeningHoursDay[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

function fullWeek(over: Partial<Record<OpeningHoursDay, DayHours>> = {}): OpeningHours {
  const wk = {} as OpeningHours;
  for (const d of DAYS) {
    wk[d] = { closed: false, open: '09:00', close: '17:00', ...(over[d] ?? {}) };
  }
  return wk;
}

function makeDetail(overrides: Partial<RestaurantDetail> = {}): RestaurantDetail {
  return {
    id: 'r1',
    accepting_orders: true,
    opening_hours: fullWeek(),
    ...overrides,
  } as RestaurantDetail;
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
    svc.getDetail.and.returnValue(of(makeDetail()));
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

  function day(key: OpeningHoursDay) {
    return component.hoursForm.get(key)!;
  }

  it('creates and loads accepting_orders + opening hours into state', () => {
    expect(component).toBeTruthy();
    expect(component.loadState).toBe('ready');
    expect(component.acceptingOrders).toBeTrue();
    expect(day('monday').value).toEqual({
      closed: false,
      open: '09:00',
      close: '17:00',
    });
    expect(component.isDirty).toBeFalse();
  });

  it('seeds defaults and stays pristine when opening_hours is null', () => {
    svc.getDetail.and.returnValue(of(makeDetail({ opening_hours: null })));
    component.load();
    expect(day('monday').value).toEqual({
      closed: false,
      open: '09:00',
      close: '17:00',
    });
    expect(component.isDirty).toBeFalse();
  });

  it('sets the error state when the detail load fails', () => {
    svc.getDetail.and.returnValue(throwError(() => new Error('boom')));
    component.load();
    expect(component.loadState).toBe('error');
  });

  it('marks dirty on a time change and saves the full seven-day object', () => {
    day('monday').get('open')!.setValue('08:00');
    day('monday').get('open')!.markAsDirty();
    expect(component.isDirty).toBeTrue();

    component.onSave();

    expect(svc.save).toHaveBeenCalledTimes(1);
    const payload = svc.save.calls.mostRecent().args[0] as AvailabilityFieldsPayload;
    expect(payload.id).toBe('r1');
    expect(payload.accepting_orders).toBeTrue();
    expect(Object.keys(payload.opening_hours).length).toBe(7);
    expect(payload.opening_hours.monday).toEqual({
      closed: false,
      open: '08:00',
      close: '17:00',
    });
    expect(toast.success).toHaveBeenCalled();
    // Re-fetch (default week) re-syncs the baseline.
    expect(component.isDirty).toBeFalse();
  });

  it('marks dirty when the accepting_orders toggle changes', () => {
    component.onToggle(false);
    expect(component.isDirty).toBeTrue();
  });

  it('blocks the save and toasts when a day closes before it opens', () => {
    const mon = day('monday');
    mon.get('close')!.setValue('08:00'); // before the 09:00 open
    mon.markAsDirty();
    expect(component.hoursForm.invalid).toBeTrue();

    component.onSave();

    expect(svc.save).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('keeps a closed day valid regardless of its times', () => {
    const sun = day('sunday');
    sun.get('close')!.setValue('08:00'); // would be invalid while open
    sun.get('closed')!.setValue(true);
    expect(sun.valid).toBeTrue();
    expect(component.hoursForm.valid).toBeTrue();
  });

  it('discards back to the loaded values and goes pristine', () => {
    day('monday').get('open')!.setValue('06:00');
    day('monday').get('open')!.markAsDirty();
    component.onToggle(false);
    expect(component.isDirty).toBeTrue();

    component.onDiscard();

    expect(component.acceptingOrders).toBeTrue();
    expect(day('monday').get('open')!.value).toBe('09:00');
    expect(component.isDirty).toBeFalse();
  });
});
