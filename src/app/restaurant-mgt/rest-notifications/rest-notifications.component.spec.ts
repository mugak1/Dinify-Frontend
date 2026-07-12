import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RestNotificationsComponent } from './rest-notifications.component';

describe('RestNotificationsComponent', () => {
  let component: RestNotificationsComponent;
  let fixture: ComponentFixture<RestNotificationsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [RestNotificationsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();

    fixture = TestBed.createComponent(RestNotificationsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function makeNotif(over: Record<string, unknown> = {}): any {
    return {
      _id: 'a', subject: 'Subject', email: '<p>Body</p>', sms: '', read: false,
      creation_timestamp: { timestamp: '2026-01-01T09:00:00Z' }, ...over,
    };
  }

  function initAndFlush(data: any[]): void {
    fixture.detectChanges(); // ngOnInit → load() → GET
    httpMock.expectOne((r) => r.method === 'GET' && r.url.includes('notifications/')).flush({ data });
  }

  it('should create', () => {
    initAndFlush([]);
    expect(component).toBeTruthy();
  });

  it('stays in the loading state until the fetch resolves (no empty-state flash)', () => {
    fixture.detectChanges();
    expect(component.state).toBe('loading');
    httpMock.expectOne((r) => r.url.includes('notifications/')).flush({ data: [] });
    expect(component.state).toBe('empty');
  });

  it('transitions to ready and counts the unread rows', () => {
    initAndFlush([makeNotif({ _id: 'a', read: false }), makeNotif({ _id: 'b', read: true })]);
    expect(component.state).toBe('ready');
    expect(component.unreadCount).toBe(1);
  });

  it('transitions to error when the fetch fails', () => {
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.includes('notifications/')).error(new ProgressEvent('fail'));
    expect(component.state).toBe('error');
  });

  it('marks an unread row read optimistically and PUTs its id on expand', () => {
    initAndFlush([makeNotif({ _id: 'a', read: false })]);
    const n = component.notifys[0];

    component.toggle(n);

    expect(component.expandedId).toBe('a');
    expect(n.read).toBeTrue(); // optimistic — the unread pill clears at once
    const put = httpMock.expectOne((r) => r.method === 'PUT' && r.url.includes('notifications/'));
    expect(put.request.body.notification_id).toBe('a');
    put.flush({});
  });

  it('does not PUT again when toggling an already-read row (verify() enforces no extra request)', () => {
    initAndFlush([makeNotif({ _id: 'a', read: true })]);
    const n = component.notifys[0];
    component.toggle(n);   // already read → no PUT
    expect(component.expandedId).toBe('a');
    component.toggle(n);   // collapse
    expect(component.expandedId).toBeNull();
  });
});
