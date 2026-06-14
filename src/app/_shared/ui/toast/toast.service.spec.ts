import { fakeAsync, tick } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    service = new ToastService();
  });

  it('pushes a toast of the matching type for each method', fakeAsync(() => {
    service.success('s');
    service.error('e');
    service.warning('w');
    service.info('i');

    expect(service.toasts.map((t) => t.type)).toEqual(['success', 'error', 'warning', 'info']);
    expect(service.toasts.map((t) => t.message)).toEqual(['s', 'e', 'w', 'i']);

    service.clear(); // cancel pending timers so fakeAsync ends clean
  }));

  it('auto-dismisses non-error toasts at 4s', fakeAsync(() => {
    service.success('saved');
    expect(service.toasts.length).toBe(1);

    tick(3999);
    expect(service.toasts.length).toBe(1);

    tick(1);
    expect(service.toasts.length).toBe(0);
  }));

  it('keeps error toasts visible longer (6s)', fakeAsync(() => {
    service.error('boom');

    tick(4000);
    expect(service.toasts.length).toBe(1); // still up past the 4s default

    tick(2000);
    expect(service.toasts.length).toBe(0); // gone at 6s
  }));

  it('de-dupes an identical message and refreshes its timer in place', fakeAsync(() => {
    service.error('offline');
    const firstId = service.toasts[0].id;

    tick(5000); // 1s before the original 6s dismissal
    service.error('offline'); // duplicate → resets the timer, no new card
    expect(service.toasts.length).toBe(1);
    expect(service.toasts[0].id).toBe(firstId); // same toast, not replaced

    tick(5999);
    expect(service.toasts.length).toBe(1); // still alive — timer was refreshed

    tick(1);
    expect(service.toasts.length).toBe(0);
  }));

  it('dismiss(id) removes only the matching toast', fakeAsync(() => {
    service.success('a');
    service.error('b');
    const targetId = service.toasts[0].id;

    service.dismiss(targetId);

    expect(service.toasts.map((t) => t.message)).toEqual(['b']);

    service.clear();
  }));

  it('clear() removes all toasts and cancels their timers', fakeAsync(() => {
    service.success('a');
    service.error('b');
    expect(service.toasts.length).toBe(2);

    service.clear();
    expect(service.toasts.length).toBe(0);

    // No pending timers remain (fakeAsync would throw at teardown otherwise),
    // and ticking past every duration must not resurrect or re-dismiss anything.
    tick(6000);
    expect(service.toasts.length).toBe(0);
  }));
});
