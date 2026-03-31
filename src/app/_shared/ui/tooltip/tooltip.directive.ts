import { Directive, ElementRef, HostListener, Input, OnDestroy } from '@angular/core';

@Directive({
  selector: '[appTooltip]',
  standalone: true,
})
export class TooltipDirective implements OnDestroy {
  @Input('appTooltip') text = '';

  private tooltipEl: HTMLDivElement | null = null;

  constructor(private el: ElementRef<HTMLElement>) {}

  @HostListener('mouseenter')
  onMouseEnter(): void {
    if (!this.text) return;

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.textContent = this.text;
    this.tooltipEl.className =
      'fixed z-50 bg-foreground text-background text-xs px-2 py-1 rounded shadow-md pointer-events-none whitespace-nowrap';
    document.body.appendChild(this.tooltipEl);

    const hostRect = this.el.nativeElement.getBoundingClientRect();
    const tipRect = this.tooltipEl.getBoundingClientRect();

    this.tooltipEl.style.top = `${hostRect.top - tipRect.height - 6}px`;
    this.tooltipEl.style.left = `${hostRect.left + hostRect.width / 2 - tipRect.width / 2}px`;
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.removeTooltip();
  }

  ngOnDestroy(): void {
    this.removeTooltip();
  }

  private removeTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }
}
