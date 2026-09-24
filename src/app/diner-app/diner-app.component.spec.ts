import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WINDOW } from '../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../_services/storage/storage-key-prefix.token';
import { ToastService } from '../_shared/ui/toast/toast.service';
import { DinerAppComponent } from './diner-app.component';
import { MenuNavStateService } from './menu/menu-nav-state.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { DinerSessionService } from '../_services/diner-session.service';

describe('DinerAppComponent', () => {
  let component: DinerAppComponent;
  let fixture: ComponentFixture<DinerAppComponent>;
  let httpMock: HttpTestingController;
  let dinerSession: DinerSessionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DinerAppComponent],
      providers: [
        provideHttpClient(withXhr()),
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
    // Cutover: a scan only fires with a QR credential in hand. The scan-behaviour
    // specs below drive getTableDetails() directly, so seed one here; the
    // dedicated cutover spec clears it to prove a raw UUID starts nothing.
    dinerSession = TestBed.inject(DinerSessionService);
    dinerSession.setCredential('qr-credential-token');
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    window.sessionStorage.clear(); // avoid cross-test carryover of the scanned Table
  });

  function validScan(id: string, number = 5) {
    return { data: { id, number, restaurant: { id: 'r1', name: 'R', branding_configuration: {} } } };
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('surfaces the server message and clears the toast on a failed scan', () => {
    const toast = TestBed.inject(ToastService);
    const clearSpy = spyOn(toast, 'clear').and.callThrough();

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

  it('publishes the ongoing-order flag to the shared signal on a valid scan', () => {
    const navState = TestBed.inject(MenuNavStateService);
    component.getTableDetails('good-id');
    httpMock.expectOne(r => r.url.includes('table-scan')).flush({
      data: {
        id: 'good-id',
        current_order: { ongoing: true, order_id: 'o1' },
        restaurant: { id: 'r1', name: 'Test Restaurant', branding_configuration: {} },
      },
    });

    expect(navState.tableOngoingOrder()).toBeTrue();
  });

  it('clears the shared ongoing-order flag when a scan shows no ongoing order', () => {
    const navState = TestBed.inject(MenuNavStateService);
    navState.setTableOngoingOrder(true);

    component.getTableDetails('good-id');
    httpMock.expectOne(r => r.url.includes('table-scan')).flush({
      data: {
        id: 'good-id',
        current_order: { ongoing: false, order_id: null },
        restaurant: { id: 'r1', name: 'Test Restaurant', branding_configuration: {} },
      },
    });

    expect(navState.tableOngoingOrder()).toBeFalse();
  });

  it('renders the table chip with the table number on a valid scan', () => {
    component.getTableDetails('good-id');
    const req = httpMock.expectOne(r => r.url.includes('table-scan'));
    req.flush({
      data: {
        id: 'good-id',
        number: 7,
        restaurant: { id: 'r1', name: 'Test Restaurant', branding_configuration: {} },
      },
    });
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector('.brand-strip__chip');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain('Table 7');
  });

  // ── the footer is always at the very bottom ──────────────────────────────
  // A page's own sticky bottom bar (the menu's View Basket, the basket's
  // Checkout) comes to rest ABOVE the footer, never under or after it. The
  // shell's part is simply that nothing is rendered after the footer.
  it('renders the diner footer as the last thing on the page', () => {
    component.getTableDetails('good-id');
    httpMock.expectOne(r => r.url.includes('table-scan')).flush(validScan('good-id', 7));
    fixture.detectChanges();
    const shell = (fixture.nativeElement as HTMLElement).querySelector('.min-h-screen')!;
    expect(shell.lastElementChild?.tagName.toLowerCase()).toBe('app-diner-footer');
  });

  // ── the desktop sidebar's layer ──────────────────────────────────────────
  // The sticky sidebar is its own stacking context, so the overlays the basket
  // opens from it paint at ITS layer. It is raised to 45 only while one of them
  // is open (`data-basket-overlay`, pinned in basket-body.allergen-info.spec.ts).
  // Raised permanently, it covered the offline strip at the bottom of a long
  // page. Karma's window is narrower than `lg:`, so these read the COMPILED
  // stylesheet and ask the aside whether it matches, instead of measuring it.
  describe('the desktop basket sidebar\'s layer', () => {
    const scan = () => {
      component.getTableDetails('good-id');
      httpMock.expectOne(r => r.url.includes('table-scan')).flush(validScan('good-id', 7));
      fixture.detectChanges();
    };
    const aside = () => (fixture.nativeElement as HTMLElement).querySelector('aside')!;

    /** Every style rule in the page, including those inside media blocks that
     *  do not apply at Karma's width, with the media text each sits under. */
    const styleRules = (): { rule: CSSStyleRule; media: string }[] => {
      const out: { rule: CSSStyleRule; media: string }[] = [];
      const walk = (rules: CSSRuleList, media: string) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) out.push({ rule, media });
          else if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.conditionText);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try { walk(sheet.cssRules, ''); } catch { /* a cross-origin sheet */ }
      }
      return out;
    };
    const matches = (el: Element, selector: string) => {
      try { return el.matches(selector); } catch { return false; }
    };
    const withMarker = <T>(fn: () => T): T => {
      const marker = document.createElement('div');
      marker.setAttribute('data-basket-overlay', '');
      aside().appendChild(marker);
      try { return fn(); } finally { marker.remove(); }
    };

    it('is raised to 45 at lg: while a basket overlay is open inside it', () => {
      scan();
      const raises = styleRules().filter(({ rule }) =>
        rule.style.zIndex !== '' && rule.selectorText.includes(':has([data-basket-overlay])'));
      expect(raises.length).withContext('the compiled stylesheet carries the raise').toBe(1);
      const [{ rule, media }] = raises;
      expect(rule.style.zIndex).toBe('45');
      expect(media).toContain('min-width: 1024px');
      expect(matches(aside(), rule.selectorText)).withContext('nothing open').toBe(false);
      expect(withMarker(() => matches(aside(), rule.selectorText))).withContext('an overlay open').toBe(true);
    });

    it('REGRESSION: with nothing open, no rule gives the aside a z-index at any width', () => {
      scan();
      const idle = styleRules().filter(({ rule }) =>
        rule.style.zIndex !== '' && matches(aside(), rule.selectorText));
      expect(idle.map(({ rule, media }) => `${media} ${rule.selectorText}`)).toEqual([]);
    });
  });

  // ── basket safety on table change ────────────────────────────────────────
  it('clears the basket when a re-scan lands on a DIFFERENT table', () => {
    const clearSpy = spyOn(component.basketService, 'clearBasket').and.callThrough();
    TestBed.inject(SessionStorageService).setItem('Table', { id: 'table-A', number: 5 });

    component.getTableDetails('table-B');
    httpMock.expectOne(r => r.url.includes('table-scan')).flush(validScan('table-B', 8));

    expect(clearSpy).toHaveBeenCalled();
  });

  it('keeps the basket on a same-table re-scan / refresh', () => {
    const clearSpy = spyOn(component.basketService, 'clearBasket').and.callThrough();
    TestBed.inject(SessionStorageService).setItem('Table', { id: 'table-A', number: 5 });

    component.getTableDetails('table-A');
    httpMock.expectOne(r => r.url.includes('table-scan')).flush(validScan('table-A', 5));

    expect(clearSpy).not.toHaveBeenCalled();
  });

  // ── cutover: the QR credential (not a raw table UUID) is what starts a session ──
  it('does NOT start a session from a raw table id when no QR credential is present', () => {
    dinerSession.clear(); // simulate an old raw-UUID sticker: no credential in hand

    component.getTableDetails('raw-table-uuid');

    // No table-scan exchange is issued, and no session is minted.
    httpMock.expectNone(r => r.url.includes('table-scan'));
    expect(dinerSession.hasSession()).toBeFalse();
    // The diner is asked to (re)scan rather than silently trusting the UUID.
    expect(component.scanFailed).toBeTrue();
    expect(component.scanRetryable).toBeFalse();
  });

  it('captures the minted table session from a valid scan', () => {
    component.getTableDetails('good-id');
    httpMock.expectOne(r => r.url.includes('table-scan')).flush({
      data: {
        id: 'good-id',
        session_token: 'sess-abc',
        restaurant: { id: 'r1', name: 'R', branding_configuration: {} },
      },
    });

    expect(dinerSession.token).toBe('sess-abc');
    expect(dinerSession.hasSession()).toBeTrue();
  });

  it('invalidates the credential and prompts a rescan when the scan is denied (regenerated QR)', () => {
    component.getTableDetails('good-id');
    httpMock.expectOne(r => r.url.includes('table-scan')).flush(
      { message: 'Not found.' },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges(); // let the needsRescan effect paint the panel

    expect(dinerSession.needsRescan()).toBeTrue();
    expect(dinerSession.hasCredential()).toBeFalse();
    expect(component.scanFailed).toBeTrue();
    expect(component.scanRetryable).toBeFalse();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-no-table')).toBeTruthy();
  });
});
