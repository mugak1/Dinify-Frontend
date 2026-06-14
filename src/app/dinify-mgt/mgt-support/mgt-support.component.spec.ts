import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { of } from 'rxjs';

import { MgtSupportComponent } from './mgt-support.component';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SupportIssueAdmin } from 'src/app/_models/app.models';

function makeIssue(over: Partial<SupportIssueAdmin> = {}): SupportIssueAdmin {
  return {
    id: 'id-1',
    reference: 'SUP-000001',
    restaurant: 'rest-1',
    restaurant_name: 'Kampala Grill',
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
    assigned_to: null,
    assigned_to_name: null,
    internal_notes: null,
    created_by: 'user-1',
    ...over,
  };
}

describe('MgtSupportComponent', () => {
  let component: MgtSupportComponent;
  let fixture: ComponentFixture<MgtSupportComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  const MOCK_ISSUES = [
    makeIssue({ id: 'id-1', reference: 'SUP-000001', restaurant_name: 'Kampala Grill', status: 'open' }),
    makeIssue({ id: 'id-2', reference: 'SUP-000002', restaurant_name: 'Nile Cafe', status: 'resolved' }),
  ];

  function configure(records: SupportIssueAdmin[] = MOCK_ISSUES): void {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: { records } } as any));
    api.postPatch.and.returnValue(of({} as any));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'clear']);

    TestBed.configureTestingModule({
      declarations: [MgtSupportComponent],
      imports: [CommonModule, ReactiveFormsModule, FormsModule],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(MgtSupportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit -> loadIssues()
  }

  it('lists issues from the admin endpoint on init', () => {
    configure();
    expect(api.get).toHaveBeenCalledWith(null, 'support/admin/issues/', {});
    expect(component.issues.length).toBe(2);
    expect(component.issues[0].reference).toBe('SUP-000001');
  });

  it('renders a row per issue showing reference and restaurant name', () => {
    configure();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('SUP-000001');
    expect(text).toContain('SUP-000002');
    expect(text).toContain('Kampala Grill');
    expect(text).toContain('Nile Cafe');
  });

  it('shows the empty state when there are no issues', () => {
    configure([]);
    expect(component.issues.length).toBe(0);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No support issues');
  });

  it('sends only the set status/category/impact filters as query params', () => {
    configure();
    api.get.calls.reset();

    component.statusFilter = 'open';
    component.categoryFilter = 'payments';
    component.impactFilter = 'blocking_service';
    component.onFilterChange();

    expect(api.get).toHaveBeenCalledWith(null, 'support/admin/issues/', {
      status: 'open',
      category: 'payments',
      impact: 'blocking_service',
    });
  });

  it('PUTs { id, status } with NO timestamps on a status update', () => {
    configure();
    component.openDetail(MOCK_ISSUES[0]); // open, blank notes/resolution
    api.get.calls.reset(); // isolate the refetch triggered by save success

    component.triageForm.patchValue({ status: 'in_progress' });
    component.saveTriage();

    expect(api.postPatch).toHaveBeenCalledTimes(1);
    const [url, payload, method] = api.postPatch.calls.mostRecent().args;
    expect(url).toBe('support/admin/issues/');
    expect(method).toBe('put');
    expect(payload).toEqual(
      jasmine.objectContaining({ id: 'id-1', status: 'in_progress' }),
    );
    // The backend stamps these on the transition — the client must never send them.
    expect('resolved_at' in (payload as object)).toBe(false);
    expect('closed_at' in (payload as object)).toBe(false);
    expect('time_created' in (payload as object)).toBe(false);
    expect('time_last_updated' in (payload as object)).toBe(false);
    // Blank notes/resolution serialise as null (not empty string).
    expect((payload as any).internal_notes).toBeNull();
    expect((payload as any).resolution_summary).toBeNull();
    // Success refetches the list, clears the banner, toasts, and closes.
    expect(api.get).toHaveBeenCalledWith(null, 'support/admin/issues/', {});
    expect(toast.clear).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Issue updated.');
    expect(component.selected).toBeNull();
  });

  it('sends edited internal_notes and resolution_summary in the PUT', () => {
    configure();
    component.openDetail(MOCK_ISSUES[0]);

    component.triageForm.patchValue({
      internal_notes: 'Investigating with the payments provider.',
      resolution_summary: 'Terminal rebooted; back online.',
    });
    component.saveTriage();

    const payload = api.postPatch.calls.mostRecent().args[1] as any;
    expect(payload.id).toBe('id-1');
    expect(payload.internal_notes).toBe('Investigating with the payments provider.');
    expect(payload.resolution_summary).toBe('Terminal rebooted; back online.');
  });

  it('mark resolved / closed just set the status (no timestamps sent)', () => {
    configure();

    component.openDetail(MOCK_ISSUES[0]);
    component.markResolved();
    let payload = api.postPatch.calls.mostRecent().args[1] as any;
    expect(payload.status).toBe('resolved');
    expect('resolved_at' in payload).toBe(false);

    component.openDetail(MOCK_ISSUES[0]);
    component.markClosed();
    payload = api.postPatch.calls.mostRecent().args[1] as any;
    expect(payload.status).toBe('closed');
    expect('closed_at' in payload).toBe(false);
  });

  it('maps each status to a single source-of-truth label and badge variant', () => {
    configure();
    expect(component.statusMeta('open')).toEqual({ label: 'Open', variant: 'warning' });
    expect(component.statusMeta('in_progress')).toEqual({ label: 'In progress', variant: 'default' });
    expect(component.statusMeta('resolved')).toEqual({ label: 'Resolved', variant: 'success' });
    expect(component.statusMeta('closed')).toEqual({ label: 'Closed', variant: 'secondary' });
  });
});
