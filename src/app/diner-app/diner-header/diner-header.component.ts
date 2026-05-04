import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrandingConfiguration } from '../../_models/app.models';
import { getContrastTextColor } from '../../_common/utils/color-utils';

@Component({
  selector: 'app-diner-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './diner-header.component.html',
  styleUrls: ['./diner-header.component.css'],
})
export class DinerHeaderComponent {
  @Input() brandingConfigs: BrandingConfiguration | null = null;
  @Input() restaurantName = '';
  @Input() logoUrl: string | null = null;
  @Input() coverPhotoUrl: string | null = null;

  @ViewChild('heroEl', { static: false }) heroEl?: ElementRef<HTMLElement>;

  // 'cover' falls back to 'solid' when no cover photo is set, so the hero
  // never renders an empty image area.
  get effectiveStyle(): 'cover' | 'solid' | 'minimal' {
    const style = this.brandingConfigs?.home?.header_style ?? 'solid';
    if (style === 'cover' && !this.coverPhotoUrl) return 'solid';
    return style;
  }

  get showLogo(): boolean {
    const display = this.brandingConfigs?.home?.logo_display ?? 'logo_and_name';
    return !!this.logoUrl && (display === 'logo_only' || display === 'logo_and_name');
  }

  get showName(): boolean {
    const display = this.brandingConfigs?.home?.logo_display ?? 'logo_and_name';
    return display === 'name_only' || display === 'logo_and_name';
  }

  get tagline(): string {
    return this.brandingConfigs?.home?.tagline?.trim() ?? '';
  }

  get brandColor(): string {
    return this.brandingConfigs?.home?.brand_color || '#ffffff';
  }

  get solidTextColor(): string {
    return getContrastTextColor(this.brandColor);
  }
}
