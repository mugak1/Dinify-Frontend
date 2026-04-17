import { Component } from '@angular/core';
import { Location } from '@angular/common';

@Component({
  selector: 'app-terms-and-conditions',
  imports: [],
  templateUrl: './terms-and-conditions.component.html'
})
export class TermsAndConditionsComponent {
  readonly pageTitle = 'Terms and Conditions';

  constructor(private location: Location) {}

  goBack(): void {
    this.location.back();
  }
}
