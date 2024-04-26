import { Component, ViewChild } from '@angular/core';

import {
  ChartComponent,
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexDataLabels,
  ApexStroke,
  ApexMarkers,
  ApexYAxis,
  ApexGrid,
  ApexTitleSubtitle,
  ApexLegend
} from "ng-apexcharts";

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


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent {
  @ViewChild("chart") chart?: ChartComponent;
  public chartOptions: Partial<ChartOptions>|any;

  constructor() {
    this.chartOptions = {
      series: [
        {
          name: "Total Order Number",
          data: [45, 52, 38, 24, 33, 26, 21, 20, 6, 8, 15, 10]
        },
        {
          name: "Total Order Revenues",
          data: [350000, 410000, 620000, 420000, 130000, 180000, 290000, 370000, 360000, 510000, 320000, 350000]
        },
        {
          name: "Total Payments",
          data: [870000, 570000, 740000, 990000, 750000, 380000, 620000, 470000, 820000, 560000, 450000, 470000]
        }
      ],
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
        text: "Total Revenues",
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
        categories: [
          "01 Jan",
          "02 Jan",
          "03 Jan",
          "04 Jan",
          "05 Jan",
          "06 Jan",
          "07 Jan",
          "08 Jan",
          "09 Jan",
          "10 Jan",
          "11 Jan",
          "12 Jan"
        ]
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