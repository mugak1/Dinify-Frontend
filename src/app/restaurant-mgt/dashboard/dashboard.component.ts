import { Component } from '@angular/core';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexDataLabels,
  ApexStroke,
  ApexMarkers,
  ApexYAxis,
  ApexGrid,
  ApexTitleSubtitle,
  ApexTooltip
} from "ng-apexcharts";
import { ChartConfiguration, ChartType } from 'chart.js';


export type ChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  dataLabels: ApexDataLabels;
  stroke: ApexStroke;
  markers: ApexMarkers;
  yaxis?: ApexYAxis;
  grid?: ApexGrid;
  title?: ApexTitleSubtitle;
  tooltip?: ApexTooltip;
};

type TimeFrame = 'thisWeek' | 'lastWeek';

@Component({
    selector: 'app-rest-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css'],
    standalone: false
})
export class DashboardComponent {
  meals: { name: string; income: string; category: string }[] = [];
  chartType: ChartType = 'line';
  selectedTimeFrame: TimeFrame = 'thisWeek';
  comparisonPeriod = 'vsLastWeek';

  chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: '#1F2937',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        displayColors: false
      }
    },
    scales: {
      x: { display: false, grid: { display: false }, ticks: { display: false } },
      y: { display: false, grid: { display: false }, ticks: { display: false } }
    },
    elements: {
      line: { borderWidth: 2 },
      point: { radius: 0, hoverRadius: 5 }
    }
  };

  cards: { title: string; value: string; change: string; color: string; data: { thisWeek: number[]; lastWeek: number[] } }[] = [];

  getChartData(color: string, values: number[]) {
    return {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [{
        data: values,
        fill: true,
        tension: 0.4,
        borderColor: color,
        backgroundColor: this.createGradient(color)
      }]
    };
  }

  private createGradient(hex: string): (ctx: any) => CanvasGradient | string {
    return (ctx) => {
      const chart = ctx.chart;
      const { ctx: canvasCtx, chartArea } = chart;
      if (!chartArea) return 'rgba(0,0,0,0)';
      const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, this.hexToRgba(hex, 0.3));
      gradient.addColorStop(1, this.hexToRgba(hex, 0));
      return gradient;
    };
  }

  private hexToRgba(hex: string, alpha: number): string {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
