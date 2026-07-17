// Shared export bar for the Reports module. Renders three actions — Export XLSX,
// Export CSV, Print — that generate files entirely frontend-side from whatever
// table (columns + rows + totals) it is bound to. ZERO report-specific logic: it
// just forwards to the pure report-export / report-print-sheet utilities. When
// disabled, all three actions disable and a tooltip explains why.

import { Component, Input } from '@angular/core';

import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { TooltipDirective } from '../../../../_shared/ui/tooltip/tooltip.directive';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { ReportColumn, ReportDateRange } from '../../models/reports.models';
import { exportCsv, exportXlsx } from '../../utils/report-export';
import { printReport } from '../../utils/report-print-sheet';

@Component({
  selector: 'app-report-export-bar',
  standalone: true,
  imports: [ButtonComponent, TooltipDirective],
  templateUrl: './report-export-bar.component.html',
})
export class ReportExportBarComponent {
  @Input() columns: ReportColumn[] = [];
  @Input() rows: any[] = [];
  @Input() totals: Record<string, number> | null = null;
  @Input() reportTitle = '';
  @Input() range: ReportDateRange | null = null;
  @Input() disabled = false;
  @Input() disabledReason = '';

  constructor(private auth: AuthenticationService) {}

  /** Guard every action: nothing to export while disabled, range-less or empty. */
  private get canExport(): boolean {
    return !this.disabled && !!this.range && this.rows.length > 0;
  }

  onExportXlsx(): void {
    if (!this.canExport || !this.range) return;
    void exportXlsx(this.columns, this.rows, this.totals, {
      reportTitle: this.reportTitle,
      range: this.range,
    });
  }

  onExportCsv(): void {
    if (!this.canExport || !this.range) return;
    exportCsv(this.columns, this.rows, this.totals, {
      reportTitle: this.reportTitle,
      range: this.range,
    });
  }

  onPrint(): void {
    if (!this.canExport || !this.range) return;
    printReport(this.columns, this.rows, this.totals, {
      reportTitle: this.reportTitle,
      restaurantName: this.auth.currentRestaurant?.name || 'Restaurant',
      range: this.range,
    });
  }
}
