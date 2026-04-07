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
      class="inline-block transition-opacity transition-transform duration-400"
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

  @ViewChild('wrapper', { static: true }) wrapperRef!: ElementRef<HTMLSpanElement>;

  formattedValue = '0';
  visible = false;

  private displayValue = 0;
  private hasAnimated = false;
  private rafId: number | null = null;
  private startTime: number | null = null;
  private observer?: IntersectionObserver;

  ngAfterViewInit(): void {
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !this.hasAnimated) {
          this.visible = true;
          this.startAnimation(this.value);
        }
      },
      { rootMargin: '-50px' },
    );
    this.observer.observe(this.wrapperRef.nativeElement);
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
