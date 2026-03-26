import { Component, ViewChild, OnInit } from '@angular/core';

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
import { DinifyDashboardData, Stats } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

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
    styleUrls: ['./dashboard.component.css'],
    standalone: false
})
export class DashboardComponent implements OnInit {
  @ViewChild("chart") chart?: ChartComponent;
  public chartOptions: Partial<ChartOptions>|any;
  public chartOptions2: Partial<ChartOptions>|any;
  topRestaurants = [
    { name: "Cafe Javas Lugogo", revenue: 1200000, diners: 150 },
    { name: "Java House Lugogo", revenue: 950000, diners: 120 },
    { name: "Cafe Javas Kira Road", revenue: 870000, diners: 110 },
    { name: "Nawab Bugolobi", revenue: 200000, diners: 100 }
  ];
  restaurantStatuses = {
    active: 180,
    pending: 30,
    inactive: 20,
    rejected: 10,
    blocked: 10
  };

  totalUsers= 1000;
  restaurantStaff= 80;
  dinifyManagementStaff =18;

  orderStatuses = {
    closed: 48000,
    notClosed: 2000
  };
  subscriptionRevenue: number = 3000000;
  surchargeRevenue: number = 1500000;
  outstandingRevenue: number = 500000;

data:any= {
  num_sales: 2,
  paid_orders: {
    number: 0,
    percentage: 0,
  },
  cancelled_orders: {
    number: 0,
    percentage: 0,
  },
  refunded_orders: {
    number: 0,
    percentage: 0,
  },
  sales_amount: null,
  new_diners: 1,
  repeat_diners: 1,
  most_ordered_item: "Katogo Reloaded",
  least_ordered_item: "Katogo Reloaded",
  most_liked_item: "",
  least_liked_item: "",
  most_active_diner: null,
  peak_hour: 14,
};
  stats?:Stats;
  constructor(private api:ApiService) {
    this.getList();
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
    this.chartOptions2={
      series: [
        {
          name: "Number of Sales",
          type:'bar',
          data: [10, 12, 8, 15, 17]
        },
        {
          name: "Sales Amount",
          type: "line",
          data: [120000, 150000, 210000, 180000, 306000] // Example data
        }
      ],
      chart: {
        type: "line",
        height: 240
      },
      xaxis: {
        categories: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
      }, 
      yaxis: [
        {
          title: {
            text: "Number of Sales"
          },
        },
        {
          opposite: true,
          title: {
            text: "Sales Amount (UGX)"
          },
          labels:{
            formatter: (value:any)=> {
              let val:any = Math.abs(value)
              if (val >= 1000) {
              val = (val / 1000).toFixed(0) + 'K'
              }
              return val
              }
          },
          min:0
        }
      ]
    };
    
  }
  totalRestaurants: number = 250;
  newRestaurantsChange: number = 12;

  totalOrders: number = 50000;
  ordersChange: number = 2000;

  dinifyRevenue: number = 4500000;
  revenueChange: number = 250000;

  totalDiners: number = 35000;
  activeDinersChange: number = 1800;

  // eslint-disable-next-line @angular-eslint/no-empty-lifecycle-method
  ngOnInit() {
    // dashboard data is loaded in constructor via getList()
  }

  fetchDashboardData() {
    // Simulating API call - replace this with actual backend call
    setTimeout(() => {
      this.totalRestaurants = 250;
      this.newRestaurantsChange = Math.floor(Math.random() * 20 - 10); // Simulate positive/negative change

      this.totalOrders = 5000;
      this.ordersChange = Math.floor(Math.random() * 5000 - 2500);

      this.dinifyRevenue = 450000;
      this.revenueChange = Math.floor(Math.random() * 500000 - 250000);

      this.totalDiners = 3500;
      this.activeDinersChange = Math.floor(Math.random() * 2000 - 1000);
    }, 1000);
    
  }
  getList(){
    this.api.get<any>(null,`reports/dinify/dashboard/`,{}).subscribe((x:any)=>{
      const d =x?.data as DinifyDashboardData;
      this.stats = d.stats;
      /* this.list=x?.data?.records as any[];  */    
    //  this.acc= this.rest?.account
 // this.list=x?.data as any;
  })
  }
}