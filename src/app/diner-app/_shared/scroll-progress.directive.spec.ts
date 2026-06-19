import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ScrollProgressDirective } from './scroll-progress.directive';

@Component({
  standalone: true,
  imports: [ScrollProgressDirective],
  template: `<div appScrollProgress [condenseAfter]="condenseAfter"></div>`,
})
class HostComponent {
  condenseAfter = 200;
}

describe('ScrollProgressDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;
  let scrollYValue = 0;

  /** Reads the raw `--sy` custom property the directive writes on the host. */
  function sy(): string {
    return host.style.getPropertyValue('--sy').trim();
  }

  /** Moves the (spied) window scroll position and fires a scroll event. */
  function scrollTo(y: number): void {
    scrollYValue = y;
    window.dispatchEvent(new Event('scroll'));
  }

  beforeEach(async () => {
    scrollYValue = 0;
    spyOnProperty(window, 'scrollY', 'get').and.callFake(() => scrollYValue);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.debugElement.query(By.directive(ScrollProgressDirective))
      .nativeElement as HTMLElement;
    fixture.detectChanges(); // triggers ngOnInit → initial update()
  });

  it('seeds --sy with the initial scroll position on init', () => {
    expect(sy()).toBe('0');
    expect(host.classList.contains('is-condensed')).toBeFalse();
  });

  it('writes the live scroll position into --sy on scroll', () => {
    scrollTo(123);
    expect(sy()).toBe('123');
  });

  it('toggles is-condensed across the condenseAfter threshold', () => {
    scrollTo(150); // below 200
    expect(host.classList.contains('is-condensed')).toBeFalse();

    scrollTo(250); // above 200
    expect(host.classList.contains('is-condensed')).toBeTrue();

    scrollTo(10); // back below
    expect(host.classList.contains('is-condensed')).toBeFalse();
  });

  it('stops responding to scroll once destroyed (listener torn down)', () => {
    scrollTo(100);
    expect(sy()).toBe('100');

    fixture.destroy();
    scrollTo(900);
    // The listener was removed in ngOnDestroy, so --sy stays at its last value.
    expect(sy()).toBe('100');
  });
});
