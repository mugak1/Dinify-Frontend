import { Component, OnInit } from '@angular/core';

interface OrderStatus {
  paid: number;
  served: number;
  pending: number;
}

interface DashboardStats {
  totalOrders: number;
  popularMeal: string;
  activeDiners: number;
  totalRevenue: string;
  ordersGrowth: string;
  dinersGrowth: string;
}

interface RecentOrder {
  id: string;
  section: string;
  table: string;
  served: string;
  time: string;
  status: 'Paid' | 'UnPaid' | 'In Progress';
}

@Component({
    selector: 'app-dashboard2',
    templateUrl: './dashboard2.component.html',
    styleUrls: ['./dashboard2.component.css'],
    standalone: false
})
export class Dashboard2Component implements OnInit {

  dashboardStats: DashboardStats = {
    totalOrders: 584,
    popularMeal: 'Vegetarian Pork Wraps',
    activeDiners: 55,
    totalRevenue: 'UGX 32.5M',
    ordersGrowth: '12%',
    dinersGrowth: '2%'
  };

  orderStatus: OrderStatus = {
    paid: 12,
    served: 15,
    pending: 3
  };

  recentOrders: RecentOrder[] = [
    {
      id: '#135',
      section: 'Private Section',
      table: 'Table #3',
      served: '1/1 Served',
      time: 'Today 19:54',
      status: 'Paid'
    },
    {
      id: '#131',
      section: 'Main Section',
      table: 'Table #2',
      served: '2/2 Served',
      time: 'Today 20:36',
      status: 'UnPaid'
    },
    {
      id: '#130',
      section: 'Main Section',
      table: 'Table #6',
      served: '0/2 Served',
      time: 'Today 20:36',
      status: 'In Progress'
    },
    {
      id: '#133',
      section: 'Private Section',
      table: 'Table #3',
      served: '1/1 Served',
      time: 'Today 19:54',
      status: 'Paid'
    },
    {
      id: '#133',
      section: 'Table #3',
      table: '',
      served: '1/1 Served',
      time: 'Today 19:54',
      status: 'Paid'
    }
  ];

  selectedTimeFrame: string = 'Today';
  notifications: number = 3;

  constructor() { }

  ngOnInit(): void {
    // Initialize component
    this.loadDashboardData();
  }

  loadDashboardData(): void {
    // In a real app, this would fetch data from the API service
  }

  onTimeFrameChange(timeFrame: string): void {
    this.selectedTimeFrame = timeFrame;
    this.loadDashboardData();
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Paid':
        return 'bg-green-100 text-green-800';
      case 'UnPaid':
        return 'bg-orange-100 text-orange-800';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  // Navigation methods
  navigateToOrders(): void {
  }

  navigateToMenu(): void {
  }

  navigateToTables(): void {
  }

  navigateToReviews(): void {
  }

  navigateToReports(): void {
  }

  navigateToSettings(): void {
  }

  // Chart data for revenue (placeholder - integrate with actual charting library)
  getRevenueChartData(): any {
    return {
      series: [{
        name: 'Revenue',
        data: [3200000, 3400000, 3100000, 3600000, 3800000, 3500000, 3250000]
      }],
      chart: {
        type: 'line',
        height: 200,
        sparkline: {
          enabled: true
        }
      },
      stroke: {
        curve: 'smooth',
        width: 3,
        colors: ['#ef4444']
      },
      markers: {
        size: 4,
        colors: ['#ef4444'],
        strokeColors: '#ef4444',
        strokeWidth: 2
      }
    };
  }
}