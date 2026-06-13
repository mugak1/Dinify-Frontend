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
    fixture.detectChanges();

    // A terminal 4xx stays the no-retry "ask staff" dead-end.
    expect(component.scanFailed).toBeTrue();
    expect(component.scanRetryable).toBeFalse();
    expect(component.scanMessage).toContain('please ask a member of staff');
    expect(component.table).toBeFalsy();
    expect(clearSpy).toHaveBeenCalled();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-no-table')).toBeTruthy();
    expect(el.querySelector('app-diner-connection-error')).toBeFalsy();
  });

  it('offers a Try again retry state on a connectivity failure', () => {
    component.getTableDetails('any-table-id');
    const req = httpMock.expectOne(r => r.url.includes('table-scan'));
    // A status-0 network error — what a flaky connection produces. (In prod the
    // ErrorInterceptor collapses this to the string 'no network'; here, with no
    // interceptor in front, the raw status-0 HttpErrorResponse reaches the
    // handler — isRetryableScanError must treat both the same.)
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    fixture.detectChanges();

    expect(component.scanFailed).toBeTrue();
    expect(component.scanRetryable).toBeTrue();
    expect(component.table).toBeFalsy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-diner-connection-error')).toBeTruthy();
    expect(el.querySelector('app-no-table')).toBeFalsy();
  });

  it('re-fetches the table when the retry state asks for it', () => {
    component.getTableDetails('flaky-id');
    httpMock
      .expectOne(r => r.url.includes('table-scan'))
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(component.scanRetryable).toBeTrue();

    // The connection-error (retry) output is wired to getTableDetails(table_id);
    // invoking it again must issue a fresh table-scan request.
    component.getTableDetails('flaky-id');
    const retryReq = httpMock.expectOne(r => r.url.includes('table-scan'));
    expect(component.scanRetryable).toBeFalse(); // reset while the retry is in flight
    retryReq.flush({
      data: {
        id: 'flaky-id',
        restaurant: { id: 'r1', name: 'Test Restaurant', branding_configuration: {} },
      },
    });

    expect(component.table?.id).toBe('flaky-id');
    expect(component.scanFailed).toBeFalse();
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
