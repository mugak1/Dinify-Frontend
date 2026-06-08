import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  SupportCategory,
  SupportImpact,
  SupportIssue,
  SupportIssueStatus,
} from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MessageService } from 'src/app/_services/message.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { BadgeVariant } from 'src/app/_shared/ui/badge/badge.component';

interface StatusMeta {
  label: string;
  variant: BadgeVariant;
}

// Single source of truth for support-issue status -> badge styling + label.
// Amber (warning) for open and emerald (success) for resolved.
const STATUS_META: Record<SupportIssueStatus, StatusMeta> = {
  open: { label: 'Open', variant: 'warning' },
  in_progress: { label: 'In progress', variant: 'default' },
  resolved: { label: 'Resolved', variant: 'success' },
  closed: { label: 'Closed', variant: 'secondary' },
};

const CATEGORY_LABEL: Record<SupportCategory, string> = {
  orders_kds: 'Orders & Kitchen',
  menu: 'Menu',
  tables_qr: 'Tables & QR',
  payments: 'Payments',
  reports: 'Reports',
  account: 'Account',
  bug: 'Bug',
  other: 'Other',
};

const IMPACT_LABEL: Record<SupportImpact, string> = {
  blocking_service: 'Blocking service',
  affecting_service: 'Affecting service',
  non_urgent: 'Non-urgent',
  question: 'Question',
};

// TODO: replace with real Dinify support contacts
const SUPPORT_CONTACTS = {
  whatsapp: '256700000000',
  phone: '+256700000000',
  email: 'support@dinify.example',
};

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as SupportCategory[]).map(
  (value) => ({ value, label: CATEGORY_LABEL[value] }),
);
const IMPACT_OPTIONS = (Object.keys(IMPACT_LABEL) as SupportImpact[]).map(
  (value) => ({ value, label: IMPACT_LABEL[value] }),
);

@Component({
  selector: 'app-support',
  templateUrl: './support.component.html',
  styleUrl: './support.component.css',
  standalone: false,
})
export class SupportComponent implements OnInit {
  issues: SupportIssue[] = [];
  loading = false;
  submitting = false;
  showForm = false;
  selected: SupportIssue | null = null;
  restaurant?: string;
  issueForm!: FormGroup;

  readonly categoryOptions = CATEGORY_OPTIONS;
  readonly impactOptions = IMPACT_OPTIONS;
  readonly contacts = SUPPORT_CONTACTS;

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private auth: AuthenticationService,
    private route: ActivatedRoute,
    private toast: ToastService,
    private message: MessageService,
  ) {}

  ngOnInit(): void {
    this.restaurant =
      this.auth.currentRestaurantRole?.restaurant_id ??
      this.route.parent?.snapshot.params['id'];

    this.issueForm = this.fb.group({
      category: ['', Validators.required],
      impact: ['', Validators.required],
      title: ['', Validators.required],
      description: ['', Validators.required],
      contact_phone: [''],
      contact_email: ['', Validators.email],
      preferred_contact_method: [''],
    });

    if (this.restaurant) {
      this.loadIssues();
    }
  }

  loadIssues(): void {
    if (!this.restaurant) {
      return;
    }
    this.loading = true;
    this.api
      .get<SupportIssue>(null, 'support/issues/', { restaurant: this.restaurant })
      .subscribe({
        next: (res) => {
          const records = (res.data?.records ?? []) as SupportIssue[];
          // The backend already scopes to the caller's owner/manager
          // restaurants; filter to the active restaurant for portal consistency.
          this.issues = records.filter((i) => i.restaurant === this.restaurant);
          this.loading = false;
        },
        error: () => {
          // The HTTP error interceptor already surfaces the failure banner.
          this.loading = false;
        },
      });
  }

  openForm(): void {
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.issueForm.reset({
      category: '',
      impact: '',
      title: '',
      description: '',
      contact_phone: '',
      contact_email: '',
      preferred_contact_method: '',
    });
  }

  submit(): void {
    if (this.issueForm.invalid || !this.restaurant || this.submitting) {
      this.issueForm.markAllAsTouched();
      return;
    }

    const v = this.issueForm.value;
    const payload = {
      restaurant: this.restaurant,
      category: v.category,
      impact: v.impact,
      title: v.title,
      description: v.description,
      contact_phone: v.contact_phone || null,
      contact_email: v.contact_email || null,
      preferred_contact_method: v.preferred_contact_method || null,
      page_url: window.location.href,
      user_agent: navigator.userAgent,
    };

    this.submitting = true;
    this.api.postPatch('support/issues/', payload, 'post', '', {}).subscribe({
      next: () => {
        this.submitting = false;
        // The interceptor clears + may queue banners per request; clear so the
        // success toast is the single message the user sees.
        this.message.clear();
        this.toast.success('Request submitted — Dinify will review it.');
        this.closeForm();
        this.loadIssues();
      },
      error: () => {
        // No optimistic/phantom row was added; the interceptor banners the error.
        this.submitting = false;
      },
    });
  }

  openDetail(issue: SupportIssue): void {
    this.selected = issue;
  }

  closeDetail(): void {
    this.selected = null;
  }

  statusMeta(status: SupportIssueStatus): StatusMeta {
    return STATUS_META[status] ?? { label: status, variant: 'secondary' };
  }

  categoryLabel(category: string): string {
    return (CATEGORY_LABEL as Record<string, string>)[category] ?? category;
  }

  impactLabel(impact: string): string {
    return (IMPACT_LABEL as Record<string, string>)[impact] ?? impact;
  }
}
