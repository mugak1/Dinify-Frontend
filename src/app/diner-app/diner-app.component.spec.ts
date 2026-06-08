import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WINDOW } from '../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../_services/storage/storage-key-prefix.token';
import { MessageService } from '../_services/message.service';
import { DinerAppComponent } from './diner-app.component';

describe('DinerAppComponent', () => {
  let component: DinerAppComponent;
  let fixture: ComponentFixture<DinerAppComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DinerAppComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();

    fixture = TestBed.createComponent(DinerAppComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('surfaces the server message and clears the banner on a failed scan', () => {
    const message = TestBed.inject(MessageService);
    const clearSpy = spyOn(message, 'clear').and.callThrough();

    component.getTableDetails('dead-table-id');
    const req = httpMock.expectOne(r => r.url.includes('table-scan'));
    req.flush(
      {
        message:
          "This table isn't available right now — please ask a member of staff.",
      },
      { status: 404, statusText: 'Not Found' },
    );

    expect(component.scanFailed).toBeTrue();
    expect(component.scanMessage).toContain('please ask a member of staff');
    expect(component.table).toBeFalsy();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('falls back to a friendly message when the error carries no body', () => {
    component.getTableDetails('dead-table-id');
    const req = httpMock.expectOne(r => r.url.includes('table-scan'));
    req.flush(null, { status: 400, statusText: 'Bad Request' });

    expect(component.scanFailed).toBeTrue();
    expect(component.scanMessage).toContain('ask a member of staff');
  });

  it('opens the menu on a valid scan', () => {
    component.getTableDetails('good-id');
    const req = httpMock.expectOne(r => r.url.includes('table-scan'));
    req.flush({
      data: {
        id: 'good-id',
        restaurant: { id: 'r1', name: 'Test Restaurant', branding_configuration: {} },
      },
    });

    expect(component.scanFailed).toBeFalse();
    expect(component.table).toBeTruthy();
    expect(component.table?.id).toBe('good-id');
    // The typed scan path still populates the restaurant fields off the response.
    expect(component.restaurant_name).toBe('Test Restaurant');
    expect(component.restaurant_id).toBe('r1');
  });
});
