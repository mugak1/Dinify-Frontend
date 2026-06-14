import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Data } from '@angular/router';
import { Subscription } from 'rxjs';

import { SectionPageComponent } from '../components/section-page/section-page.component';
import { SettingsIconName } from '../components/settings-icon/settings-icon.component';

/**
 * Lightweight transitional placeholder for Settings sections whose real form is
 * a later PR (Restaurant identity & branding, Availability, Tax & receipts,
 * Account & security). One component serves them all, reading
 * `{ title, description, icon, emptyMessage }` from the route's `data`, and
 * renders the shared section-page scaffold in its "coming soon" empty state.
 */
@Component({
  selector: 'app-settings-placeholder',
  standalone: true,
  imports: [SectionPageComponent],
  templateUrl: './settings-placeholder.component.html',
})
export class SettingsPlaceholderComponent implements OnInit, OnDestroy {
  title = '';
  description = '';
  icon: SettingsIconName | '' = '';
  emptyMessage =
    "We're rebuilding this section. It'll be available here soon.";

  private sub?: Subscription;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.sub = this.route.data.subscribe((data: Data) => {
      this.title = data['title'] ?? '';
      this.description = data['description'] ?? '';
      this.icon = (data['icon'] as SettingsIconName) ?? '';
      if (data['emptyMessage']) {
        this.emptyMessage = data['emptyMessage'];
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
