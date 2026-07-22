import { Component, OnInit } from '@angular/core';
import { DinifyDashboardData, Stats } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';


@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css'],
    standalone: false
})
export class DashboardComponent implements OnInit {
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
