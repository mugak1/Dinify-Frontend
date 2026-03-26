import { Component, OnInit } from '@angular/core';

@Component({
    selector: 'app-dashboard5',
    templateUrl: './dashboard5.component.html',
    styleUrls: ['./dashboard5.component.css'],
    standalone: false
})
export class Dashboard5Component implements OnInit {

  // Date Range Management
  selectedDateRange: string = 'day';
  selectedTimeRange: string = 'today';
  
  dateRanges = [
    { label: 'Today', value: 'day' },
    { label: 'Week', value: 'week' },
    { label: 'Month', value: 'month' },
    { label: 'YTD', value: 'ytd' }
  ];

  // Main Metrics
  totalOrders: number = 847;
  totalRevenue: number = 45200000; // 45.2M UGX
  occupiedTables: number = 18;
  totalTables: number = 24;
  occupancyPct: number = 75;
  alertCount: number = 3;

  // Additional metrics for 4-column layout
  averageOrderValue: string = 'UGX 53,200';
  averageOrderGrowth: string = '7.2%';
  staffOnline: number = 12;
  kitchenLoad: number = 78;
  pendingKitchenOrders: number = 23;
  customerSatisfactionRating: number = 4.3;
  serviceSpeed: number = 12;
  orderAccuracy: number = 94;
  customerWaitTime: number = 6;
  averageServiceTime: string = '8.5 min';
  orderSuccessRate: number = 96.8;
  currentKitchenLoad: number = 73;
  activeStaffCount: number = 8;
  totalStaffCount: number = 12;
  dailyGrowthPercentage: number = 12.4;
  todaysCustomerCount: number = 156;

  // Order Status Data
  orderStatuses = [
    { label: 'Paid', count: 652, percentage: 77, bgColor: 'bg-green-500', textColor: 'text-green-600' },
    { label: 'Open/Unpaid', count: 143, percentage: 17, bgColor: 'bg-yellow-500', textColor: 'text-yellow-600' },
    { label: 'Cancelled', count: 35, percentage: 4, bgColor: 'bg-gray-400', textColor: 'text-gray-600' },
    { label: 'Refunded', count: 17, percentage: 2, bgColor: 'bg-red-500', textColor: 'text-red-600' }
  ];

  // Revenue Breakdown
  revenuePills = [
    { label: 'Gross', value: 48200000, color: 'text-gray-900' },
    { label: 'Discounts', value: 2100000, color: 'text-yellow-600' },
    { label: 'Refunds', value: 900000, color: 'text-red-600' },
    { label: 'Net', value: 45200000, color: 'text-green-600' }
  ];

  // Popular Items
  sortBy: 'income' | 'quantity' = 'income';
  popularItems = [
    { name: 'Vegetarian Pork Wraps', revenue: 2450000, quantity: 142, image: '/assets/placeholder.png' },
    { name: 'Grilled Chicken', revenue: 1890000, quantity: 98, image: '/assets/placeholder.png' },
    { name: 'Beef Steak Combo', revenue: 1650000, quantity: 76, image: '/assets/placeholder.png' },
    { name: 'Fish & Chips', revenue: 1120000, quantity: 89, image: '/assets/placeholder.png' },
    { name: 'Pasta Carbonara', revenue: 980000, quantity: 67, image: '/assets/placeholder.png' }
  ];

  // Payment Methods
  paymentMethods = [
    { name: 'Cash', amount: 19500000, percentage: 43, color: 'text-green-600' },
    { name: 'Card', amount: 16800000, percentage: 37, color: 'text-blue-600' },
    { name: 'Mobile Money', amount: 9000000, percentage: 20, color: 'text-purple-600' }
  ];

  // Recent Reviews
  avgRating: number = 4.2;
  lowRatingShare: number = 8;
  recentReviews = [
    { customer: 'John Doe', rating: 5, comment: 'Amazing food and service!', time: '2 hours ago' },
    { customer: 'Jane Smith', rating: 4, comment: 'Great atmosphere, will come back.', time: '4 hours ago' },
    { customer: 'Mike Johnson', rating: 2, comment: 'Food was cold, service slow.', time: '6 hours ago' },
    { customer: 'Sarah Wilson', rating: 5, comment: 'Perfect dinner experience!', time: '8 hours ago' }
  ];

  // KDS Tickets
  kdsTickets = [
    { table: 'Table 5', items: 'Burger, Fries', time: '12:30', status: 'preparing' },
    { table: 'Table 12', items: 'Pizza Margherita', time: '15:45', status: 'ready' },
    { table: 'Table 3', items: 'Steak, Salad', time: '18:20', status: 'urgent' }
  ];

  constructor() { }

  ngOnInit(): void {
    this.initializeCharts();
  }

  // Chart Options
  revenueChartOptions: any = {};
  ordersChartOptions: any = {};
  paymentMethodsChartOptions: any = {};

  initializeCharts(): void {
    // Revenue Chart
    this.revenueChartOptions = {
      series: [{
        name: 'Revenue',
        data: [3200000, 4100000, 3800000, 5100000, 4500000, 3900000, 4200000]
      }],
      chart: {
        type: 'area',
        height: 200,
        toolbar: { show: false },
        sparkline: { enabled: true }
      },
      stroke: {
        curve: 'smooth',
        width: 2
      },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.7,
          opacityTo: 0.2,
          stops: [0, 90, 100]
        }
      },
      colors: ['#3b82f6'],
      xaxis: {
        categories: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        labels: { show: true },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      tooltip: {
        enabled: true,
        followCursor: true,
        x: {
          formatter: (value: number, opts: any) => {
            return this.revenueChartOptions.xaxis.categories[opts.dataPointIndex];
          }
        },
        y: {
          formatter: (value: number)=>  {
            return value.toLocaleString();
          },
          title: {
            formatter: () => {
              return 'Revenue (UGX)';
            }
          }
        }
      }
    };

    // Orders Chart - Stacked Daily Breakdown
    this.ordersChartOptions = {
      series: [{
        name: 'Completed',
        data: [85, 92, 98, 105, 88, 82, 95]
      }, {
        name: 'Pending',
        data: [25, 28, 32, 35, 38, 35, 40]
      }, {
        name: 'Cancelled',
        data: [10, 15, 18, 22, 19, 21, 20]
      }],
      chart: {
        type: 'bar',
        height: 320,
        stacked: true,
        toolbar: { show: false }
      },
      plotOptions: {
        bar: {
          borderRadius: 4,
          columnWidth: '60%'
        }
      },
      colors: ['#10b981', '#f59e0b', '#ef4444'],
      xaxis: {
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right'
      }
    };

    // Payment Methods Chart
    this.paymentMethodsChartOptions = {
      series: [43, 37, 20],
      chart: {
        type: 'donut',
        height: 300
      },
      labels: ['Cash', 'Card', 'Mobile Money'],
      colors: ['#10b981', '#3b82f6', '#8b5cf6'],
      legend: {
        position: 'bottom'
      }
    };
  }

  // Helper Methods
  setDateRange(range: string): void {
    this.selectedDateRange = range;
  }

  getTimeframeLabel(): string {
    const labels: {[key: string]: string} = {
      'day': 'Today',
      'week': 'This Week',
      'month': 'This Month',
      'ytd': 'Year to Date'
    };
    return labels[this.selectedDateRange] || 'Today';
  }

  setSortBy(sort: 'income' | 'quantity'): void {
    this.sortBy = sort;
    // Re-sort popular items based on selection
    if (sort === 'income') {
      this.popularItems.sort((a, b) => b.revenue - a.revenue);
    } else {
      this.popularItems.sort((a, b) => b.quantity - a.quantity);
    }
  }

  getOccupancyColor(): string {
    if (this.occupancyPct >= 80) return 'text-red-600';
    if (this.occupancyPct >= 60) return 'text-yellow-600';
    return 'text-green-600';
  }

  getOccupancyBg(): string {
    if (this.occupancyPct >= 80) return 'bg-red-50 border-red-200';
    if (this.occupancyPct >= 60) return 'bg-yellow-50 border-yellow-200';
    return 'bg-green-50 border-green-200';
  }

  getKdsStatusColor(status: string): string {
    switch (status) {
      case 'ready': return 'text-green-600';
      case 'urgent': return 'text-red-600';
      default: return 'text-yellow-600';
    }
  }

  getStars(rating: number): number[] {
    return Array(Math.floor(rating)).fill(0);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-UG', {
      style: 'currency',
      currency: 'UGX',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }
}