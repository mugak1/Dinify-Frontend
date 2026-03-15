import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgApexchartsModule } from 'ng-apexcharts';
import { CommonChartComponent } from './common-chart.component';

@NgModule({
  declarations: [CommonChartComponent],
  exports: [CommonChartComponent],
  imports: [CommonModule, NgApexchartsModule],
})
export class CommonChartModule {}
