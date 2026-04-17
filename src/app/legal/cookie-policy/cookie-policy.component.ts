import { Component } from '@angular/core';
import { Location } from '@angular/common';

@Component({
  selector: 'app-cookie-policy',
  imports: [],
  templateUrl: './cookie-policy.component.html'
})
export class CookiePolicyComponent {
  readonly pageTitle = 'Cookie Policy';

  constructor(private location: Location) {}

  goBack(): void {
    this.location.back();
  }
}
