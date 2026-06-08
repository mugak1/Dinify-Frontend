import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { SupportComponent } from './support.component';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MessageService } from 'src/app/_services/message.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SupportIssue } from 'src/app/_models/app.models';

function makeIssue(over: Partial<SupportIssue> = {}): SupportIssue {
  return {
    id: 'id-1',
    reference: 'SUP-000001',
    restaurant: 'rest-1',
    restaurant_name: 'Test Restaurant',
    category: 'payments',
    impact: 'affecting_service',
    status: 'open',
    title: 'Card terminal offline',
    description: 'It stopped working mid-service.',
    contact_phone: null,
    contact_email: null,
    preferred_contact_method: null,
    page_url: null,
    user_agent: null,
    resolution_summary: null,
    resolved_at: null,
    closed_at: null,
    created_by_name: 'Jane',
    time_created: '2026-06-01T10:00:00Z',
    time_last_updated: '2026-06-02T10:00:00Z',
    ...over,
  };
}

describe('SupportComponent', () => {
  let component: SupportComponent;
  let fixture: ComponentFixture<SupportComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let message: jasmine.SpyObj<MessageService>;

  const MOCK_ISSUES = [
    makeIssue({ id: 'id-1', reference: 'SUP-000001', status: 'open' }),
    makeIssue({ id: 'id-2', reference: 'SUP-000002', status: 'resolved' }),
  ];

  function configure(records: SupportIssue[] = MOCK_ISSUES): void {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: { records } } as any));
    api.postPatch.and.returnValue(of({} as any));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    message = jasmine.createSpyObj<MessageService>('MessageService', ['clear', 'add']);

    TestBed.configureTestingModule({
      declarations: [SupportComponent],
      imports: [CommonModule, ReactiveFormsModule],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: MessageService, useValue: message },
        {
          provide: AuthenticationService,
          useValue: {
            currentRestaurantRole: { restaurant_id: 'rest-1', restaurant: 'Test', roles: [] },
          },
        },
        { provide: ActivatedRoute, useValue: { parent: { snapshot: { params: {} } } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(SupportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit -> loadIssues()
  }

  it('loads the active restaurant issues from support/issues/ on init', () => {
    configure();
    expect(api.get).toHaveBeenCalledWith(null, 'support/issues/', { restaurant: 'rest-1' });
    expect(component.issues.length).toBe(2);
    expect(component.issues[0].reference).toBe('SUP-000001');
  });

  it('renders a row per issue showing its real backend reference', () => {
    configure();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('SUP-000001');
    expect(text).toContain('SUP-000002');
  });

  it('shows the empty state when there are no issues', () => {
    configure([]);
    expect(component.issues.length).toBe(0);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("You haven't reported anything yet");
  });

  it('submits a create to support/issues/ with the right payload and no fake-id row', () => {
    configure();
    component.issueForm.setValue({
      category: 'payments',
      impact: 'blocking_service',
      title: 'Payments are failing',
      description: 'Every mobile money charge is declined.',
      contact_phone: '',
      contact_email: '',
      preferred_contact_method: '',
    });
    api.get.calls.reset(); // isolate the refetch triggered by submit success

    component.submit();

    expect(api.postPatch).toHaveBeenCalledTimes(1);
    const [url, payload, method] = api.postPatch.calls.mostRecent().args;
    expect(url).toBe('support/issues/');
    expect(method).toBe('post');
    expect(payload).toEqual(
      jasmine.objectContaining({
        restaurant: 'rest-1',
        category: 'payments',
        impact: 'blocking_service',
        title: 'Payments are failing',
        description: 'Every mobile money charge is declined.',
        contact_phone: null,
        contact_email: null,
        preferred_contact_method: null,
        page_url: jasmine.any(String),
        user_agent: jasmine.any(String),
      }),
    );
    // Admin-only / fabricated fields must never be sent.
    expect('id' in (payload as object)).toBe(false);
    expect('status' in (payload as object)).toBe(false);
    expect('internal_notes' in (payload as object)).toBe(false);
    // Success refetches the list rather than pushing an optimistic phantom row.
    expect(api.get).toHaveBeenCalledWith(null, 'support/issues/', { restaurant: 'rest-1' });
    expect(component.issues.length).toBe(2);
    expect(toast.success).toHaveBeenCalledWith('Request submitted — Dinify will review it.');
  });

  it('maps each status to a single source-of-truth label and badge variant', () => {
    configure();
    expect(component.statusMeta('open')).toEqual({ label: 'Open', variant: 'warning' });
    expect(component.statusMeta('in_progress')).toEqual({ label: 'In progress', variant: 'default' });
    expect(component.statusMeta('resolved')).toEqual({ label: 'Resolved', variant: 'success' });
    expect(component.statusMeta('closed')).toEqual({ label: 'Closed', variant: 'secondary' });
  });
});
