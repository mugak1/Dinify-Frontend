import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToastComponent } from './toast.component';
import { ToastService } from './toast.service';

describe('ToastComponent', () => {
  let fixture: ComponentFixture<ToastComponent>;
  let service: ToastService;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ToastComponent] });
    fixture = TestBed.createComponent(ToastComponent);
    service = TestBed.inject(ToastService);
    host = fixture.nativeElement as HTMLElement;
  });

  function toastEl(): HTMLElement {
    fixture.detectChanges();
    return host.querySelector('.border-l-4') as HTMLElement;
  }

  it('announces errors assertively (role=alert) with the destructive token colour', () => {
    service.error('Something failed');
    const el = toastEl();
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
    expect(el.className).toContain('border-l-destructive');
  });

  it('announces warnings assertively with the warning token colour', () => {
    service.warning('Heads up');
    const el = toastEl();
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
    expect(el.className).toContain('border-l-warning');
  });

  it('announces success politely (role=status) with the success token colour', () => {
    service.success('Saved');
    const el = toastEl();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.className).toContain('border-l-success');
  });

  it('announces info politely with the primary token colour', () => {
    service.info('FYI');
    const el = toastEl();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.className).toContain('border-l-primary');
  });
});
