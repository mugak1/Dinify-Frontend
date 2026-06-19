import {
  Directive,
  ElementRef,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';

/**
 * Tracks window scroll on the host element for scroll-reactive styling, without
 * triggering Angular change detection.
 *
 * It writes the raw `window.scrollY` (unitless number) onto the host as the CSS
 * custom property `--sy`, which inherits down to descendants — the diner menu
 * hero reads it for a parallax drift (`translateY(calc(var(--sy) * …px))`).
 * Past `condenseAfter` pixels it toggles a plain `is-condensed` class on the
 * host so downstream CSS can react to a "scrolled" state.
 *
 * The scroll listener is passive and registered inside
 * `NgZone.runOutsideAngular`, so per-frame scroll updates never schedule change
 * detection. Apply on a DOM ancestor of whatever consumes `--sy`/`is-condensed`.
 */
@Directive({
  selector: '[appScrollProgress]',
  standalone: true,
})
export class ScrollProgressDirective implements OnInit, OnDestroy {
  /** Scroll offset in px past which the host gains the `is-condensed` class. */
  @Input() condenseAfter = 0;

  constructor(
    private el: ElementRef<HTMLElement>,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      this.update();
      window.addEventListener('scroll', this.onScroll, { passive: true });
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll);
  }

  // Bound arrow so add/removeEventListener share one function identity (a fresh
  // inline arrow could never be removed → leak).
  private readonly onScroll = (): void => this.update();

  private update(): void {
    const y = window.scrollY;
    const host = this.el.nativeElement;
    // Raw unitless number; consumers apply their own unit via calc().
    host.style.setProperty('--sy', String(y));
    host.classList.toggle('is-condensed', y > this.condenseAfter);
  }
}
