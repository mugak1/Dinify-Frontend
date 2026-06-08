import { BadgeVariant } from 'src/app/_shared/ui/badge/badge.component';
import {
  SupportCategory,
  SupportImpact,
  SupportIssueStatus,
} from 'src/app/_models/app.models';

export interface StatusMeta {
  label: string;
  variant: BadgeVariant;
}

// Single source of truth for support-issue status -> badge styling + label.
// Amber (warning) for open and emerald (success) for resolved. Shared by the
// restaurant Support page and the Dinify-admin triage screen.
export const STATUS_META: Record<SupportIssueStatus, StatusMeta> = {
  open: { label: 'Open', variant: 'warning' },
  in_progress: { label: 'In progress', variant: 'default' },
  resolved: { label: 'Resolved', variant: 'success' },
  closed: { label: 'Closed', variant: 'secondary' },
};

export const CATEGORY_LABEL: Record<SupportCategory, string> = {
  orders_kds: 'Orders & Kitchen',
  menu: 'Menu',
  tables_qr: 'Tables & QR',
  payments: 'Payments',
  reports: 'Reports',
  account: 'Account',
  bug: 'Bug',
  other: 'Other',
};

export const IMPACT_LABEL: Record<SupportImpact, string> = {
  blocking_service: 'Blocking service',
  affecting_service: 'Affecting service',
  non_urgent: 'Non-urgent',
  question: 'Question',
};

export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as SupportCategory[]).map(
  (value) => ({ value, label: CATEGORY_LABEL[value] }),
);
export const IMPACT_OPTIONS = (Object.keys(IMPACT_LABEL) as SupportImpact[]).map(
  (value) => ({ value, label: IMPACT_LABEL[value] }),
);
export const SUPPORT_STATUS_OPTIONS = (
  Object.keys(STATUS_META) as SupportIssueStatus[]
).map((value) => ({ value, label: STATUS_META[value].label }));

export function statusMeta(status: SupportIssueStatus): StatusMeta {
  return STATUS_META[status] ?? { label: status, variant: 'secondary' };
}

export function categoryLabel(category: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[category] ?? category;
}

export function impactLabel(impact: string): string {
  return (IMPACT_LABEL as Record<string, string>)[impact] ?? impact;
}
