import { Component, Input } from '@angular/core';
import { NgSwitch, NgSwitchCase } from '@angular/common';

/**
 * Section identities used across the Settings hub. One name maps to one
 * single-colour, currentColor inline SVG below.
 */
export type SettingsIconName =
  | 'restaurant'
  | 'availability'
  | 'staff'
  | 'tax'
  | 'billing'
  | 'preset-tags'
  | 'account';

/**
 * Shared inline-SVG icon set for the Settings hub. Single consistent style
 * (24×24, stroke="currentColor", round caps) so colour/size come from the
 * host (text/width/height utilities). Mirrors the sidebar's [ngSwitch] +
 * svg:path pattern — no lucide-angular, no SVGRepo dumps.
 */
@Component({
  selector: 'app-settings-icon',
  standalone: true,
  imports: [NgSwitch, NgSwitchCase],
  host: { class: 'inline-flex' },
  template: `
    <svg
      class="w-full h-full"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      [ngSwitch]="name"
    >
      <ng-container *ngSwitchCase="'restaurant'">
        <svg:path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
        <svg:path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <svg:path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
        <svg:path d="M2 7h20" />
        <svg:path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
      </ng-container>

      <ng-container *ngSwitchCase="'availability'">
        <svg:circle cx="12" cy="12" r="10" />
        <svg:polyline points="12 6 12 12 16 14" />
      </ng-container>

      <ng-container *ngSwitchCase="'staff'">
        <svg:path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <svg:circle cx="9" cy="7" r="4" />
        <svg:path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <svg:path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </ng-container>

      <ng-container *ngSwitchCase="'tax'">
        <svg:path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
        <svg:path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
        <svg:path d="M12 17.5v-11" />
      </ng-container>

      <ng-container *ngSwitchCase="'billing'">
        <svg:rect width="20" height="14" x="2" y="5" rx="2" />
        <svg:line x1="2" x2="22" y1="10" y2="10" />
      </ng-container>

      <ng-container *ngSwitchCase="'preset-tags'">
        <svg:path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <svg:circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </ng-container>

      <ng-container *ngSwitchCase="'account'">
        <svg:path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <svg:path d="m9 12 2 2 4-4" />
      </ng-container>
    </svg>
  `,
})
export class SettingsIconComponent {
  @Input() name: SettingsIconName = 'restaurant';
}
