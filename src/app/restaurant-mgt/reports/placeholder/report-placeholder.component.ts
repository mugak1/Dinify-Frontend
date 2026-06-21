// Honest under-construction stand-in for the reports not yet built (Menu
// performance, Transactions, Diners). PR2 swaps the routes for real components.

import { Component } from '@angular/core';
import { ReportStateComponent } from '../components/report-state/report-state.component';

@Component({
  selector: 'app-report-placeholder',
  standalone: true,
  imports: [ReportStateComponent],
  template: `<app-report-state mode="under-construction"></app-report-state>`,
})
export class ReportPlaceholderComponent {}
