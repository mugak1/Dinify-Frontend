import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { NotificationInboxService } from '../notification-inbox.service';
import { BADGE_CAP, NotificationBellComponent, badgeText } from './notification-bell.component';

/** SHELL-FINISH-00, PR 5 — the bell renders the count it is given, capped. */
describe('NotificationBellComponent', () => {
  let fixture: ComponentFixture<NotificationBellComponent>;
  let inbox: { unreadCount: ReturnType<typeof signal<number | null>>; start: jasmine.Spy; stop: jasmine.Spy };

  beforeEach(async () => {
    inbox = {
      unreadCount: signal<number | null>(null),
      start: jasmine.createSpy('start'),
      stop: jasmine.createSpy('stop'),
    };
    await TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [provideRouter([]), { provide: NotificationInboxService, useValue: inbox }],
    }).compileComponents();
    fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
  });

  const bell = () => fixture.nativeElement.querySelector('[data-testid="notification-bell"]') as HTMLAnchorElement;
  const badge = () => fixture.nativeElement.querySelector('[data-testid="notification-badge"]') as HTMLElement | null;

  function show(count: number | null): void {
    inbox.unreadCount.set(count);
    fixture.detectChanges();
  }

  it('opens /notifications', () => {
    expect(bell().getAttribute('href')).toBe('/notifications');
  });

  describe('the badge shows the count with its cap', () => {
    const cases: Array<[number | null, string | null]> = [
      [null, null], [0, null], [1, '1'], [9, '9'], [10, '9+'], [250, '9+'],
    ];
    for (const [count, text] of cases) {
      it(`${count} → ${text ?? 'no badge'}`, () => {
        show(count);
        expect(badge()?.textContent?.trim() ?? null).toBe(text);
        expect(badgeText(count)).toBe(text);
      });
    }

    it('caps at 9', () => {
      expect(BADGE_CAP).toBe(9);
    });
  });

  it('the accessible name carries the real count, beyond the cap', () => {
    show(null);
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
    show(0);
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
    show(27);
    expect(bell().getAttribute('aria-label')).toBe('Notifications, 27 unread');
    expect(badge()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the badge is ink, never brand red (colour roles: a count is information)', () => {
    show(3);
    const cls = badge()!.className;
    expect(cls).toContain('bg-foreground');
    expect(cls).not.toMatch(/\b(bg-primary|bg-d-red|bg-destructive)\b/);
  });

  it('polling runs while the bell is on screen: started on init, stopped on destroy', () => {
    expect(inbox.start).toHaveBeenCalledTimes(1);
    expect(inbox.stop).not.toHaveBeenCalled();
    fixture.destroy();
    expect(inbox.stop).toHaveBeenCalledTimes(1);
  });
});
