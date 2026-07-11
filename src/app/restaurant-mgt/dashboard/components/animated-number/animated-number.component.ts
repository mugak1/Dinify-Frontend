import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';

@Component({
  selector: 'app-animated-number',
  standalone: true,
  template: `
    <span
      #wrapper
      class="inline-block transition-[opacity,transform] duration-300"
      [class.opacity-0]="!visible"
      [class.scale-90]="!visible"
    >
      {{ prefix }}{{ formattedValue }}{{ suffix }}
    </span>
  `,
})
export class AnimatedNumberComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) value!: number;
  @Input() duration = 2000;
  @Input() prefix = '';
  @Input() suffix = '';
  @Input() decimals = 0;
  @Input() formatFn?: (v: number) => string;
  /** How long to wait for the IntersectionObserver before revealing anyway. */
  @Input() revealFallbackMs = 1000;

  @ViewChild('wrapper', { static: true }) wrapperRef!: ElementRef<HTMLSpanElement>;

  formattedValue = '0';
  visible = false;

  private displayValue = 0;
  private hasAnimated = false;
  private rafId: number | null = null;
  private startTime: number | null = null;
  private observer?: IntersectionObserver;
  private fallbackId: ReturnType<typeof setTimeout> | null = null;

  ngAfterViewInit(): void {
    // The observer only ENHANCES (it starts the count-up when the number scrolls
    // into view); it must never gate whether the value renders at all. The old
    // `rootMargin: '-50px'` inset meant an element within 50px of any viewport
    // edge never counted as intersecting — on a phone the collapsed sidebar puts
    // the dashboard revenue figure ~30px from the left edge, so it sat at an
    // invisible "0" forever. No inset, plus a timer fallback: whichever fires
    // first reveals and animates.
    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) this.reveal();
    });
    this.observer.observe(this.wrapperRef.nativeElement);
    this.fallbackId = setTimeout(() => this.reveal(), this.revealFallbackMs);
  }

  private reveal(): void {
    if (this.visible) return;
    this.visible = true;
    if (this.fallbackId !== null) {
      clearTimeout(this.fallbackId);
      this.fallbackId = null;
    }
    this.observer?.disconnect();
    this.startAnimation(this.value);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.hasAnimated) {
      const prev = changes['value'].previousValue ?? 0;
      if (Math.abs(this.value - prev) > Math.abs(this.value * 0.1)) {
        this.hasAnimated = false;
        this.startTime = null;
        this.startAnimation(this.value);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.fallbackId !== null) clearTimeout(this.fallbackId);
    this.observer?.disconnect();
  }

  private startAnimation(target: number): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.startTime = null;

    const stepSize = this.getStepSize(target);

    const animate = (timestamp: number) => {
      if (this.startTime === null) this.startTime = timestamp;

      const elapsed = timestamp - this.startTime;
      const progress = Math.min(elapsed / this.duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const raw = target * eased;

      this.displayValue = progress >= 1 ? target : Math.round(raw / stepSize) * stepSize;
      this.formattedValue = this.formatNumber(this.displayValue);

      if (progress < 1) {
        this.rafId = requestAnimationFrame(animate);
      } else {
        this.hasAnimated = true;
        this.rafId = null;
      }
    };

    this.rafId = requestAnimationFrame(animate);
  }

  private formatNumber(num: number): string {
    if (this.formatFn) return this.formatFn(num);
    return num.toLocaleString('en-US', {
      minimumFractionDigits: this.decimals,
      maximumFractionDigits: this.decimals,
    });
  }

  private getStepSize(target: number): number {
    if (target === 0) return 1;
    const magnitude = Math.abs(target);
    const rawStep = magnitude / 25;
    const order = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / order;
    if (normalized <= 1) return order;
    if (normalized <= 2) return 2 * order;
    if (normalized <= 5) return 5 * order;
    return 10 * order;
  }
}
