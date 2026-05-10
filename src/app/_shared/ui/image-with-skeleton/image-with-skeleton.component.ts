import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Polished image loader: holds a fixed box, shows a pulsing skeleton until the
 * <img> fires `load`, then fades the image in. On error, renders a neutral
 * placeholder instead of the browser's broken-image icon.
 *
 * The host element is positioned `absolute inset-0`, so the consumer is
 * expected to provide a `relative` container with explicit dimensions. Other
 * overlays (badges, quick-add affordances) can sit alongside this element in
 * the same relative container at higher z-index.
 */
@Component({
  selector: 'app-image-with-skeleton',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *ngIf="!loaded && !errored"
         class="absolute inset-0 bg-gray-200 animate-pulse"
         aria-hidden="true"></div>

    <img *ngIf="src && !errored"
         [src]="src"
         [alt]="alt"
         [ngClass]="imgClass"
         [class.opacity-0]="!loaded"
         [attr.fetchpriority]="fetchPriority"
         decoding="async"
         (load)="onLoad()"
         (error)="onError()" />

    <div *ngIf="!src || errored"
         class="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-300"
         aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
        <circle cx="9" cy="9" r="2"/>
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
      </svg>
    </div>
  `,
  host: {
    class: 'absolute inset-0 block',
  },
})
export class ImageWithSkeletonComponent implements OnChanges {
  @Input() src: string | null = null;
  @Input() alt: string = '';
  @Input() imgClass: string = 'w-full h-full object-cover transition-opacity duration-300';
  @Input() fetchPriority: 'high' | 'low' | 'auto' | null = null;

  loaded = false;
  errored = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['src']) {
      this.loaded = false;
      this.errored = false;
    }
  }

  onLoad(): void {
    this.loaded = true;
  }

  onError(): void {
    this.errored = true;
  }
}
