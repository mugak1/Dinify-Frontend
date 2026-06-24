import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { IdentityComponent } from './identity.component';
import { RestaurantIdentityService } from 'src/app/_services/restaurant-identity.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { RestaurantDetail } from 'src/app/_models/app.models';

function makeDetail(): RestaurantDetail {
  return {
    id: 'r1',
    name: 'The Lawns',
    location: 'Nakasero',
    logo: 'https://cdn/logo.png',
    cover_photo: null,
    tagline: 'Grills under the trees',
    cuisine_types: ['Grill / BBQ', 'Café'],
    contact_phone: '256700123456',
    contact_email: 'hello@lawns.ug',
    landmark: 'Near the museum',
    socials: { instagram: 'lawns', facebook: '', x: '', tiktok: '' },
    branding_configuration: {
      home: {
        header_style: 'standard',
        brand_color: '#2E7D32',
        logo_display: 'logo_and_name',
        tagline: 'branding-blurb',
      },
    },
  } as RestaurantDetail;
}

describe('IdentityComponent', () => {
  let component: IdentityComponent;
  let fixture: ComponentFixture<IdentityComponent>;
  let svc: jasmine.SpyObj<RestaurantIdentityService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    svc = jasmine.createSpyObj<RestaurantIdentityService>('RestaurantIdentityService', [
      'getDetail',
      'saveFields',
      'uploadImages',
    ]);
    svc.getDetail.and.returnValue(of(makeDetail()));
    svc.saveFields.and.returnValue(of({}));
    svc.uploadImages.and.returnValue(of({}));

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [IdentityComponent],
      providers: [
        provideRouter([]),
        { provide: RestaurantIdentityService, useValue: svc },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityComponent);
    component = fixture.componentInstance;
    // Drive logic directly; avoid rendering the third-party phone/colour widgets.
    component.ngOnInit();
  });

  it('creates and loads detail into the form', () => {
    expect(component).toBeTruthy();
    expect(component.loadState).toBe('ready');
    expect(component.form.get('name')?.value).toBe('The Lawns');
    expect(component.form.get('cuisine_types')?.value).toEqual(['Grill / BBQ', 'Café']);
    expect(component.isDirty).toBeFalse();
  });

  it('sets the error state when the detail load fails', () => {
    svc.getDetail.and.returnValue(throwError(() => new Error('boom')));
    component.load();
    expect(component.loadState).toBe('error');
  });

  it('toggles cuisine chips and marks the form dirty', () => {
    expect(component.isCuisineSelected('Indian')).toBeFalse();
    component.toggleCuisine('Indian');
    expect(component.isCuisineSelected('Indian')).toBeTrue();
    expect(component.isDirty).toBeTrue();

    component.toggleCuisine('Grill / BBQ');
    expect(component.isCuisineSelected('Grill / BBQ')).toBeFalse();
  });

  it('builds a save payload that null-clears emptied fields and preserves branding siblings', () => {
    // Empty the tagline.
    component.form.get('tagline')?.setValue('');
    component.form.get('tagline')?.markAsDirty();

    component.onSave();

    expect(svc.saveFields).toHaveBeenCalledTimes(1);
    const payload = svc.saveFields.calls.mostRecent().args[0];
    expect(payload.id).toBe('r1');
    expect(payload.tagline).toBeNull(); // emptied optional → null
    // All four home keys are preserved verbatim (brand_color is no longer edited).
    expect(payload.branding_configuration.home).toEqual({
      header_style: 'standard',
      brand_color: '#2E7D32',
      logo_display: 'logo_and_name',
      tagline: 'branding-blurb',
    });
    // No staged images → no multipart call.
    expect(svc.uploadImages).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('blocks save and toasts when required fields are invalid', () => {
    component.form.get('name')?.setValue('');
    component.onSave();
    expect(svc.saveFields).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('discards back to the loaded values and goes pristine', () => {
    component.form.get('name')?.setValue('Changed');
    component.form.get('name')?.markAsDirty();
    expect(component.isDirty).toBeTrue();

    component.onDiscard();

    expect(component.form.get('name')?.value).toBe('The Lawns');
    expect(component.isDirty).toBeFalse();
  });
});
