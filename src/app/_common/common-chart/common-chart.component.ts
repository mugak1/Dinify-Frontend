import { Component, Input, ViewChild } from '@angular/core';
import { ApexAxisChartSeries, ApexChart, ApexDataLabels, ApexGrid, ApexLegend, ApexMarkers, ApexStroke, ApexTitleSubtitle, ApexXAxis, ApexYAxis, ChartComponent } from 'ng-apexcharts';
import { ChartData } from 'src/app/_models/app.models';

@Component({
    selector: 'app-common-chart',
    templateUrl: './common-chart.component.html',
    styleUrl: './common-chart.component.css',
    standalone: false
})
export class CommonChartComponent {
  @ViewChild("chart") chart?: ChartComponent;
  public chartOptions: Partial<ChartOptions>|any;
  @Input() data: ChartData|undefined;
  @Input() title: string|undefined;
  constructor() {
    if(this.data){
    this.chartOptions = {
      series: this.data.series,
      chart: {
        height: 350,
        type: "line"
        
      },
    
      dataLabels: {
        enabled: false
      },
      stroke: {
        width: 5,
        curve: "straight",
        dashArray: [0, 8, 5],
       /*  colors:['#ff0000','red','red'] */
      },
      title: {
        text: this.title,
        align: "left"
      },
      legend: {
        tooltipHoverFormatter: (val:any, opts:any)=> {
          return (
            val +
            " - <strong>" +
            opts.w.globals.series[opts.seriesIndex][opts.dataPointIndex] +
            "</strong>"
          );
        }
      },
      markers: {
        size: 0,
        hover: {
          sizeOffset: 6
        }
      },
      yaxis:{
      labels:{
        
        formatter:(val:any)=>{
          return Number(val).toLocaleString();
        }       
      }  
      
      },
      xaxis: {
        labels: {
          trim: false
        },
        categories: this.data.xaxis.categories
      },
      tooltip: {
        y: [
          {
            title: {
              formatter: (val:any)=>{
                return val + " No. ";
              }
            }
          },
          {
            title: {
              formatter: (val:any)=>{
                return val + " per day";
              }
            }
          },
          {
            title: {
              formatter: (val:any)=> {
                return val;
              }
            }
          }
        ]
      },
      grid: {
        borderColor: "#f1f1f1"
      }
    };
    }
  }
}
export type ChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  stroke: ApexStroke;
  dataLabels: ApexDataLabels;
  markers: ApexMarkers;
  tooltip: any; // ApexTooltip;
  yaxis: ApexYAxis;
  grid: ApexGrid;
  legend: ApexLegend;
  title: ApexTitleSubtitle;
};
