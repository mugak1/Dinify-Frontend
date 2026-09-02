import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Location } from '@angular/common';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-privacy-policy',
  imports: [],
  templateUrl: './privacy-policy.component.html'
})
export class PrivacyPolicyComponent {
  readonly pageTitle = 'Privacy Policy';

  constructor(private location: Location) {}

  goBack(): void {
    this.location.back();
  }
}
