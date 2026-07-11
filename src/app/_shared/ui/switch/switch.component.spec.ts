import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SwitchComponent } from './switch.component';

describe('SwitchComponent', () => {
  let fixture: ComponentFixture<SwitchComponent>;
  let component: SwitchComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SwitchComponent] }).compileComponents();
    fixture = TestBed.createComponent(SwitchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const button = () => fixture.debugElement.query(By.css('button')).nativeElement as HTMLButtonElement;

  it('emits the new value on toggle when enabled', () => {
    const spy = jasmine.createSpy('checkedChange');
    component.checkedChange.subscribe(spy);
    component.toggle();
    expect(component.checked).toBeTrue();
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('does NOT emit and does not flip when disabled', () => {
    component.checked = false;
    component.disabled = true;
    fixture.detectChanges();
    const spy = jasmine.createSpy('checkedChange');
    component.checkedChange.subscribe(spy);

    component.toggle();

    expect(component.checked).toBeFalse();
    expect(spy).not.toHaveBeenCalled();
  });

  it('marks the underlying button disabled and the track non-interactive when disabled', () => {
    component.disabled = true;
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();
    expect(component.trackClass).toContain('cursor-not-allowed');
  });

  it('keeps the load-bearing transparent border on the track', () => {
    expect(component.trackClass).toContain('border-2');
    expect(component.trackClass).toContain('border-transparent');
  });

  it('exposes an accessible name via the ariaLabel input (none by default)', () => {
    expect(button().hasAttribute('aria-label')).toBeFalse();

    component.ariaLabel = 'Item is visible on the menu';
    fixture.detectChanges();
    expect(button().getAttribute('aria-label')).toBe('Item is visible on the menu');
  });
});
