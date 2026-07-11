import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnimatedNumberComponent } from './animated-number.component';

/**
 * The count-up must treat the IntersectionObserver as an enhancement, never a
 * gate: if the observer never reports the element intersecting (the mobile
 * dashboard regression — a viewport-edge element under the old '-50px'
 * rootMargin), a timer fallback still reveals and renders the real value.
 */
describe('AnimatedNumberComponent', () => {
  // Captures the callback the component hands to the observer so tests can
  // choose to fire it (intersecting) or never fire it (the regression case).
  class MockIntersectionObserver {
    static lastCallback: IntersectionObserverCallback | null = null;
    static lastInstance: MockIntersectionObserver | null = null;
    disconnected = false;
    constructor(cb: IntersectionObserverCallback) {
      MockIntersectionObserver.lastCallback = cb;
      MockIntersectionObserver.lastInstance = this;
    }
    observe(): void {}
    disconnect(): void {
      this.disconnected = true;
    }
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  const realIO = window.IntersectionObserver;
  let fixture: ComponentFixture<AnimatedNumberComponent>;
  let component: AnimatedNumberComponent;

  beforeEach(async () => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      MockIntersectionObserver;
    MockIntersectionObserver.lastCallback = null;
    MockIntersectionObserver.lastInstance = null;

    await TestBed.configureTestingModule({ imports: [AnimatedNumberComponent] }).compileComponents();
    fixture = TestBed.createComponent(AnimatedNumberComponent);
    component = fixture.componentInstance;
    component.value = 1234;
    component.duration = 40; // keep the rAF loop short for real-timer tests
    component.revealFallbackMs = 20;
  });

  afterEach(() => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = realIO;
  });

  function intersect(): void {
    MockIntersectionObserver.lastCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      MockIntersectionObserver.lastInstance as unknown as IntersectionObserver,
    );
  }

  it('reveals and renders the real value even when the observer NEVER fires (the mobile "0" regression)', (done) => {
    fixture.detectChanges(); // ngAfterViewInit: observer armed, fallback timer armed

    expect(component.visible).toBeFalse();
    setTimeout(() => {
      fixture.detectChanges();
      expect(component.visible).toBeTrue();
      expect(component.formattedValue).toBe('1,234');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('1,234');
      expect(el.querySelector('span')?.classList.contains('opacity-0')).toBeFalse();
      done();
    }, 400); // well past fallback (20ms) + animation (40ms)
  });

  it('starts the count-up as soon as the observer reports intersecting', (done) => {
    fixture.detectChanges();
    intersect();

    expect(component.visible).toBeTrue();
    // Revealing via the observer cancels the pending fallback and disconnects.
    expect(MockIntersectionObserver.lastInstance?.disconnected).toBeTrue();
    setTimeout(() => {
      expect(component.formattedValue).toBe('1,234');
      done();
    }, 400);
  });

  it('formats the final value through formatFn when provided', (done) => {
    component.formatFn = (v: number) => `UGX ${v.toLocaleString('en-US')}`;
    fixture.detectChanges();
    intersect();

    setTimeout(() => {
      expect(component.formattedValue).toBe('UGX 1,234');
      done();
    }, 400);
  });

  it('reveals only once — a late observer fire after the fallback does not restart the animation', (done) => {
    fixture.detectChanges();
    setTimeout(() => {
      expect(component.visible).toBeTrue();
      const spy = spyOn(
        component as unknown as { startAnimation(t: number): void },
        'startAnimation',
      );
      intersect(); // late fire must be a no-op
      expect(spy).not.toHaveBeenCalled();
      done();
    }, 100);
  });

  it('destroying before the fallback elapses never reveals (timer is cleaned up)', (done) => {
    fixture.detectChanges();
    fixture.destroy();
    setTimeout(() => {
      expect(component.visible).toBeFalse();
      expect(component.formattedValue).toBe('0');
      done();
    }, 100);
  });
});
