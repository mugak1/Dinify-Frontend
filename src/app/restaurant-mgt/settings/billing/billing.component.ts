import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RestaurantDetail, TransactionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { BadgeVariant } from 'src/app/_shared/ui/badge/badge.component';
import { formatUGX } from 'src/app/_shared/utils/price-utils';
import { SectionPageState } from '../components/section-page/section-page.component';
import {
  BILLING_PLANS,
  BILLING_PLAN_FEATURES,
  BillingCycle,
  BillingPlan,
  MONTHLY_PRICE_UGX,
  YEARLY_PRICE_UGX,
} from './billing-plans';

/**
 * Billing — the restaurant's B2B SaaS subscription to Dinify. Rebuilt on the
 * shared settings section-page scaffold: a status-display + discrete-action
 * surface (subscription status, monthly/yearly plan cards, billing history),
 * subscription-only (the per_order / surcharge model was dropped).
 *
 * The payment path is PRESERVED VERBATIM: `PayNow()` opens the existing dn-dialog
 * and `Save()`/`sendOtp()` drive the live MoMo/card/OTP integration against
 * `finances/transactions/`. The redesign rebuilds everything UP TO that seam and
 * hands off unchanged — the dialog markup, the form shape, and the endpoints are
 * untouched. Plan cards are display-only: prices come from a FE catalogue
 * (`billing-plans.ts`) while the charged amount stays the configured `flat_fee`.
 */
@Component({
  selector: 'app-billing',
  templateUrl: './billing.component.html',
  styleUrl: './billing.component.css',
  standalone: false,
})
export class BillingComponent implements OnInit {
  rest?: RestaurantDetail;
  rest_id: any;

  /** Drives the section-page chrome (loading skeleton / error+retry / ready). */
  loadState: SectionPageState = 'loading';

  // Plan catalogue (FE-defined; display only — see billing-plans.ts).
  readonly plans = BILLING_PLANS;
  readonly planFeatures = BILLING_PLAN_FEATURES;

  // ── Payment / dialog state (PRESERVED) ──────────────────────────────────────
  showModal = false;
  PaymentForm?: FormGroup;
  require_otp = false;
  data = '';
  sub_details?: { subscription_validity: boolean; subscription_expiry_date: any };
  BillingForm?: FormGroup;
  date_now = Date.now();
  transaction_list: TransactionListItem[] = [];
  load_list = false;

  constructor(
    private auth: AuthenticationService,
    private route: ActivatedRoute,
    private api: ApiService,
    private fb: FormBuilder,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.rest = this.auth.currentRestaurant;
    this.rest_id = this.auth.currentRestaurantRole?.restaurant_id ?? this.rest?.id;
    if (!this.rest_id) {
      this.loadState = 'error';
      return;
    }
    this.reload();
    this.route.params.subscribe((x) => {
      if (x['id']) {
        ///// PopUp Payment Status (post-payment return route: billing/paid/:id)
      }
    });
  }

  /** (Re)load subscription details + history; subscription-details gates the state. */
  reload(): void {
    this.loadState = 'loading';
    this.loadingBillingSub();
    this.getTransactionList();
  }

  // ── Display helpers ─────────────────────────────────────────────────────────

  /** The restaurant's active cycle, or null if not on a monthly/yearly plan. */
  get currentCycle(): BillingCycle | null {
    const m = this.rest?.preferred_subscription_method;
    return m === 'monthly' || m === 'yearly' ? m : null;
  }

  isCurrentPlan(plan: BillingPlan): boolean {
    return plan.cycle === this.currentCycle;
  }

  /** Freshest validity/expiry — prefer the just-fetched sub_details over stale rest. */
  get validity(): boolean {
    return this.sub_details?.subscription_validity ?? this.rest?.subscription_validity ?? false;
  }
  get expiryDate(): any {
    return this.sub_details?.subscription_expiry_date ?? this.rest?.subscription_expiry_date ?? null;
  }
  get isFreeTrial(): boolean {
    return this.validity && (this.expiryDate === null || this.expiryDate === undefined);
  }

  get statusLabel(): string {
    if (this.isFreeTrial) return 'Free trial';
    return this.validity ? 'Active' : 'Inactive';
  }
  get statusVariant(): BadgeVariant {
    if (this.isFreeTrial) return 'secondary';
    return this.validity ? 'success' : 'destructive';
  }

  get feeDisplay(): string {
    return formatUGX(Number(this.rest?.flat_fee) || 0);
  }
  get cadenceLabel(): string {
    return this.currentCycle === 'yearly' ? 'year' : 'month';
  }
  planPrice(plan: BillingPlan): string {
    return formatUGX(plan.priceUGX);
  }
  ugx(amount: number): string {
    return formatUGX(Number(amount) || 0);
  }

  /** Yearly saving vs paying monthly for a year — derived from the FE catalogue. */
  get savingsUGX(): number {
    return Math.max(0, MONTHLY_PRICE_UGX * 12 - YEARLY_PRICE_UGX);
  }
  get savingsDisplay(): string {
    return formatUGX(this.savingsUGX);
  }

  /** Primary action label on the current-plan card. */
  get payActionLabel(): string {
    return this.validity ? 'Renew' : 'Subscribe';
  }

  /**
   * Switching billing cycle is not self-serve yet (no restaurant-facing
   * plan-change endpoint). Surface a clear next step instead of a dead button.
   */
  requestSwitch(plan: BillingPlan): void {
    this.toast.info(`To switch to the ${plan.name} plan, please contact support.`);
  }

  // ── Billing date (admin only) — PRESERVED ───────────────────────────────────
  AddDate() {
    this.BillingForm = this.fb.group({
      restaurant: [this.rest_id],
      subscription_validity: [true],
      subscription_expiry_date: [null, [Validators.required]],
    });
    this.showModal = true;
  }
  SaveDate() {
    this.api
      .postPatch('restaurant-setup/subscription-details/', this.BillingForm?.value, 'put', null, {
        restaurant: this.rest_id,
      })
      .subscribe((x: any) => {
        if (x.status == 200) {
          this.toast.success(x.message);
          this.loadRestaurant(this.rest_id);
          this.loadingBillingSub();
          this.closeModal();
        }
      });
  }
  subtractMonths(date: Date, monthsToSubtract: number): Date {
    const dateCopy = new Date(date);
    dateCopy.setMonth(dateCopy.getMonth() - monthsToSubtract);
    return dateCopy;
  }

  getTransactionList() {
    this.load_list = false;
    const today = new Date();
    const from_today = this.subtractMonths(today, 5);
    this.api
      .get<any>(null, `reports/restaurant/` + 'transactions-listing/', {
        restaurant: this.rest_id,
        from: `${from_today.getFullYear()}-${from_today.getMonth() + 1}-${from_today.getDate()}`,
        to: `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
        type: 'subscription',
      })
      .subscribe((x) => {
        if (x?.status == 200) {
          this.transaction_list = x?.data as any;
          this.load_list = true;
        }
      });
  }
  loadRestaurant(id: string) {
    this.api
      .get<any>(null, 'restaurant-setup/' + (id ? 'details/' : 'restaurants/'), id ? { id: id, record: 'restaurants' } : {})
      .subscribe((x) => {
        this.rest = x?.data as any;
      });
  }
  loadingBillingSub() {
    this.api.get<any>(null, 'restaurant-setup/subscription-details/', { restaurant: this.rest_id }).subscribe({
      next: (x) => {
        this.sub_details = x?.data as any;
        this.loadState = 'ready';
      },
      error: () => {
        this.loadState = 'error';
      },
    });
  }

  // ── Payment flow (PRESERVED VERBATIM — the untouched seam) ───────────────────
  closeModal() {
    this.showModal = false;
    this.PaymentForm != null;
    this.data = '';
    this.require_otp = false;
  }
  PayNow() {
    this.PaymentForm = this.InitPayment();
    this.showModal = true;
  }
  InitPayment() {
    return this.fb.group({
      transaction_type: ['subscription'],
      transaction_platform: ['web'],
      payment_mode: [''],
      restaurant_id: [this.rest_id],
      msisdn: [''],
      otp: [],
    });
  }
  Save() {
    if (this.data != '' && this.require_otp && this.PaymentForm?.get('payment_mode')?.value == 'momo') {
      this.PaymentForm.get('otp')?.setValue(this.data);
      const d = this.PaymentForm.value;
      d.msisdn = '256' + this.PaymentForm.get('msisdn')?.value;
      this.api.postPatch('finances/transactions/', d, 'post').subscribe((x: any) => {
        if (x.status == 200) {
          this.toast.success(x.message);
          this.closeModal();
        }
      });
    } else if (this.PaymentForm?.get('payment_mode')?.value == 'momo') {
      this.api.get<any>(null, 'users/msisdn-lookup/?msisdn=256' + this.PaymentForm.get('msisdn')?.value).subscribe((x) => {
        if (x.status == 400) {
          this.sendOtp('msisdn', '256' + this.PaymentForm?.get('msisdn')?.value, null);
        } else if (x.status == 200) {
          const d = this.PaymentForm?.value;
          d.msisdn = '256' + this.PaymentForm?.get('msisdn')?.value;
          this.api.postPatch('finances/transactions/', d, 'post').subscribe((x: any) => {
            if (x.status == 200) {
              this.toast.success(x.message);
              this.closeModal();

              //window.location.href=res.redirect_url;
            }
          });
        }
      });
    } else if (this.PaymentForm?.get('payment_mode')?.value == 'card') {
      this.api.postPatch('finances/transactions/', this.PaymentForm.value, 'post').subscribe((x: any) => {
        const res = x?.data;
        if (x.status == 200) {
          this.toast.success(x.message);
          this.closeModal();
          window.location.href = res.redirect_url;
        }
      });
    }
  }
  sendOtp(identification: any, identifier: any, purpose: any) {
    this.api
      .postPatch('users/auth/resend-otp/', { identification: identification, identifier: identifier, purpose: purpose }, 'post')
      .subscribe((_x) => {
        this.require_otp = true;
      });
  }
  get canChangeBillingDate() {
    return this.auth.userValue?.profile.roles.includes('dinify_admin');
  }
}
