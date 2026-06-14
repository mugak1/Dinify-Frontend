import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { SupportIssueAdmin, SupportIssueStatus } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import {
  CATEGORY_OPTIONS,
  IMPACT_OPTIONS,
  StatusMeta,
  SUPPORT_STATUS_OPTIONS,
  categoryLabel as categoryLabelFn,
  impactLabel as impactLabelFn,
  statusMeta as statusMetaFn,
} from 'src/app/_shared/support';

// Admin triage endpoint (PR1). GET is paginated + filterable by
// status/category/impact/restaurant; PUT takes { id, ...changed fields }.
const ADMIN_ISSUES_URL = 'support/admin/issues/';

@Component({
  selector: 'app-mgt-support',
  templateUrl: './mgt-support.component.html',
  styleUrl: './mgt-support.component.css',
  standalone: false,
})
export class MgtSupportComponent implements OnInit {
  issues: SupportIssueAdmin[] = [];
  loading = false;
  saving = false;
  selected: SupportIssueAdmin | null = null;

  statusFilter = '';
  categoryFilter = '';
  impactFilter = '';

  triageForm: FormGroup;

  readonly statusOptions = SUPPORT_STATUS_OPTIONS;
  readonly categoryOptions = CATEGORY_OPTIONS;
  readonly impactOptions = IMPACT_OPTIONS;

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private toast: ToastService,
  ) {
    this.triageForm = this.fb.group({
      status: ['open'],
      internal_notes: [''],
      resolution_summary: [''],
    });
  }

  ngOnInit(): void {
    this.loadIssues();
  }

  loadIssues(): void {
    // Only status/category/impact/restaurant are honoured by the backend;
    // send just the filters the operator has set.
    const params: Record<string, string> = {};
    if (this.statusFilter) {
      params['status'] = this.statusFilter;
    }
    if (this.categoryFilter) {
      params['category'] = this.categoryFilter;
    }
    if (this.impactFilter) {
      params['impact'] = this.impactFilter;
    }

    this.loading = true;
    this.api.get<SupportIssueAdmin>(null, ADMIN_ISSUES_URL, params).subscribe({
      next: (res) => {
        this.issues = (res.data?.records ?? []) as SupportIssueAdmin[];
        this.loading = false;
      },
      error: () => {
        // The HTTP error interceptor already surfaces the failure banner.
        this.loading = false;
      },
    });
  }

  onFilterChange(): void {
    this.loadIssues();
  }

  openDetail(issue: SupportIssueAdmin): void {
    this.selected = issue;
    this.triageForm.reset({
      status: issue.status,
      internal_notes: issue.internal_notes ?? '',
      resolution_summary: issue.resolution_summary ?? '',
    });
  }

  closeDetail(): void {
    this.selected = null;
  }

  saveTriage(): void {
    if (!this.selected || this.saving) {
      return;
    }
    const v = this.triageForm.value;
    // The id rides in the body (PUT support/admin/issues/). resolved_at /
    // closed_at are intentionally omitted — the backend stamps them on the
    // status transition.
    const payload = {
      id: this.selected.id,
      status: v.status,
      internal_notes: v.internal_notes || null,
      resolution_summary: v.resolution_summary || null,
    };

    this.saving = true;
    this.api.postPatch(ADMIN_ISSUES_URL, payload, 'put', '', {}).subscribe({
      next: () => {
        this.saving = false;
        // The interceptor may queue a toast per request; clear it so the
        // success toast is the single message the user sees.
        this.toast.clear();
        this.toast.success('Issue updated.');
        this.loadIssues();
        this.closeDetail();
      },
      error: () => {
        this.saving = false;
      },
    });
  }

  markResolved(): void {
    this.triageForm.patchValue({ status: 'resolved' });
    this.saveTriage();
  }

  markClosed(): void {
    this.triageForm.patchValue({ status: 'closed' });
    this.saveTriage();
  }

  statusMeta(status: SupportIssueStatus): StatusMeta {
    return statusMetaFn(status);
  }

  categoryLabel(category: string): string {
    return categoryLabelFn(category);
  }

  impactLabel(impact: string): string {
    return impactLabelFn(impact);
  }
}
