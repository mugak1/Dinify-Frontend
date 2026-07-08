import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DinifyPhoneInputComponent, DinifyPhoneChange } from './dinify-phone-input.component';

describe('DinifyPhoneInputComponent', () => {
  let component: DinifyPhoneInputComponent;
  let fixture: ComponentFixture<DinifyPhoneInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DinifyPhoneInputComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DinifyPhoneInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('emits a plus/space-free phoneNumber plus iso2Code and isValid on input', () => {
    const events: DinifyPhoneChange[] = [];
    component.valueChange.subscribe((e) => events.push(e));

    component.onInput('+256 772 123456');

    expect(events.length).toBe(1);
    expect(events[0].phoneNumber).toBe('256772123456'); // '+' and spaces stripped
    expect(events[0].iso2Code).toBe('UG'); // always emitted, from config
    expect(events[0].isValid).toBe(true);
  });

  it('exposes isValid as a public property for @ViewChild consumers', () => {
    component.onInput('772123456'); // 9 national digits
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

  it('integrates with reactive forms via writeValue', () => {
    component.writeValue('256772123456');
    expect(component.value).toBe('256772123456');
    expect(component.isValid).toBe(true);
  });
});
