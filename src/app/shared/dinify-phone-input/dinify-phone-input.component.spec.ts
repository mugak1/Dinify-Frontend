import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AutofillEvent, AutofillMonitor } from '@angular/cdk/text-field';
import {
  DinifyPhoneInputComponent,
  DinifyPhoneChange,
} from './dinify-phone-input.component';

describe('DinifyPhoneInputComponent', () => {
  let component: DinifyPhoneInputComponent;
  let fixture: ComponentFixture<DinifyPhoneInputComponent>;
  let autofillEvents: Subject<AutofillEvent>;

  beforeEach(async () => {
    // Stub AutofillMonitor so the defensive autofill paths are exercised
    // deterministically without a real browser autofill.
    autofillEvents = new Subject<AutofillEvent>();
    const autofillStub = {
      monitor: () => autofillEvents.asObservable(),
      stopMonitoring: () => undefined,
    };

    await TestBed.configureTestingModule({
      imports: [DinifyPhoneInputComponent],
      providers: [{ provide: AutofillMonitor, useValue: autofillStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(DinifyPhoneInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function inputEl(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input');
  }
  function last(events: DinifyPhoneChange[]): DinifyPhoneChange {
    return events[events.length - 1];
  }

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  // ── EMIT invariant: always canonical dialCode + national ──────────────────
  it('emits a canonical 256-prefixed phoneNumber from the NATIONAL number (the manual-login fix)', () => {
    const events: DinifyPhoneChange[] = [];
    component.valueChange.subscribe((e) => events.push(e));

    component.onInput('755116061'); // national digits only

    expect(events.length).toBe(1);
    expect(events[0].phoneNumber).toBe('256755116061'); // was '755116061' before the fix
    expect(events[0].iso2Code).toBe('UG'); // always emitted, from config
    expect(events[0].isValid).toBe(true);
  });

  it('emits the SAME canonical value however the number is entered', () => {
    const seen: string[] = [];
    component.valueChange.subscribe((e) => seen.push(e.phoneNumber));

    component.onInput('755116061'); // national
    component.onInput('0755116061'); // trunk 0
    component.onInput('256755116061'); // country code, no +
    component.onInput('+256 755 116061'); // full international, spaced (autofill/paste shape)

    expect(seen).toEqual([
      '256755116061',
      '256755116061',
      '256755116061',
      '256755116061',
    ]);
  });

  it('emits an EMPTY string (never a bare "256") for an empty field', () => {
    const events: DinifyPhoneChange[] = [];
    component.valueChange.subscribe((e) => events.push(e));

    component.onInput('');

    expect(events[0].phoneNumber).toBe('');
    expect(events[0].isValid).toBe(false);
  });

  // ── DISPLAY: national only, caret-safe while typing ───────────────────────
  it('keeps the raw text visible WHILE typing (caret-safe), then settles to national on blur', () => {
    component.onInput('+256755116061'); // user types the old '+256' workaround
    expect(component.value).toBe('+256755116061'); // not reformatted mid-type

    component.onBlur();
    expect(component.value).toBe('755116061'); // settled to national — single overlay +256
  });

  it('shows the national number immediately when the national number is typed (no double +256)', () => {
    component.onInput('755116061');
    expect(component.value).toBe('755116061');
  });

  // ── isValid: derived from the national length, from config ────────────────
  it('exposes isValid as a public property for @ViewChild consumers', () => {
    component.onInput('755116061'); // 9 national digits
    expect(component.isValid).toBe(true);

    component.onInput('123'); // too short
    expect(component.isValid).toBe(false);
  });

  it('derives the validity length from config (leading 0 and 256 both accepted)', () => {
    component.onInput('0772123456'); // 0 + 9 national
    expect(component.isValid).toBe(true);

    component.onInput('256772123456'); // 256 + 9 national
    expect(component.isValid).toBe(true);
  });

  // ── writeValue: national display for form-bound (CVA) hosts ────────────────
  it('writeValue shows the NATIONAL number (strips 256/0), keeping isValid in sync', () => {
    component.writeValue('256772123456');
    expect(component.value).toBe('772123456');
    expect(component.isValid).toBe(true);

    component.writeValue('0772123456');
    expect(component.value).toBe('772123456');

    component.writeValue('772123456');
    expect(component.value).toBe('772123456');

    component.writeValue(null);
    expect(component.value).toBe('');
    expect(component.isValid).toBe(false);
  });

  // ── Defensive autofill: works even if Safari fires no `input` event ────────
  it('reconciles an autofilled full number to national display + canonical emit (no input event)', () => {
    const events: DinifyPhoneChange[] = [];
    component.valueChange.subscribe((e) => events.push(e));

    inputEl().value = '+256 755 116061'; // Safari fills the DOM directly
    autofillEvents.next({ target: inputEl(), isAutofilled: true });

    expect(component.value).toBe('755116061'); // single overlay +256, no double
    expect(last(events).phoneNumber).toBe('256755116061'); // canonical, login-ready
  });

  it('reconciles a value already present at init (autofill before AfterViewInit)', async () => {
    const events: DinifyPhoneChange[] = [];
    component.valueChange.subscribe((e) => events.push(e));

    inputEl().value = '+256 755 116061';
    component.ngAfterViewInit(); // re-run with a value now present
    await Promise.resolve(); // flush the deferred reconcile

    expect(component.value).toBe('755116061');
    expect(last(events).phoneNumber).toBe('256755116061');
  });
});
