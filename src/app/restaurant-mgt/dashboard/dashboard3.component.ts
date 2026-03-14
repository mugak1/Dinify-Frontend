import { Component, OnInit } from '@angular/core';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexYAxis,
  ApexDataLabels,
  ApexTitleSubtitle,
  ApexStroke,
  ApexGrid,
  ApexFill,
  ApexMarkers,
  ApexPlotOptions,
  ApexLegend,
  ApexNonAxisChartSeries
} from 'ng-apexcharts';

interface OrderStatus {
  completed: number;
  pending: number;
  cancelled: number;
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
  customer: string;
  table: string;
  amount: string;
  status: 'Completed' | 'Pending' | 'Cancelled';
  time: string;
}

interface TopMenuItem {
  rank: number;
  name: string;
  category: string;
  sales: string;
  revenue: string;
}

interface LiveActivity {
  id: number;
  type: 'order' | 'payment' | 'table';
  title: string;
  description: string;
  time: string;
}

interface LowStockItem {
  name: string;
  category: string;
  remaining: number;
  unit: string;
  threshold: number;
}

interface SalesCategory {
  name: string;
  sales: string;
  percentage: number;
  color: string;
}

@Component({
  selector: 'app-dashboard3',
  templateUrl: './dashboard3.component.html',
  styleUrls: ['./dashboard3.component.css']
})
export class Dashboard3Component implements OnInit {

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

  // Additional metrics
  averageOrderValue: string = 'UGX 53,200';
  averageOrderGrowth: string = '7.2%';
  staffOnline: number = 12;
  kitchenLoad: number = 78;
  pendingKitchenOrders: number = 23;
  customerSatisfactionRating: number = 4.3;
  serviceSpeed: number = 12;
  orderAccuracy: number = 94;
  customerWaitTime: number = 6;

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
    { name: 'Beef Steak', revenue: 1650000, quantity: 76, image: '/assets/placeholder.png' },
    { name: 'Fish & Chips', revenue: 1420000, quantity: 89, image: '/assets/placeholder.png' },
    { name: 'Caesar Salad', revenue: 980000, quantity: 124, image: '/assets/placeholder.png' }
  ];

  // Payment Methods
  paymentMethods = [
    { name: 'Card', amount: 22600000, percentage: 50, color: 'hsl(210, 100%, 56%)' },
    { name: 'Mobile Money', amount: 15800000, percentage: 35, color: 'hsl(142, 76%, 36%)' },
    { name: 'Cash', amount: 6800000, percentage: 15, color: 'hsl(45, 93%, 47%)' }
  ];

  // Reviews Data
  avgRating: number = 4.3;
  lowRatingShare: number = 8;
  recentReviews = [
    { 
      rating: 5, 
      text: 'Amazing food and excellent service! The chicken was perfectly cooked.', 
      timeAgo: '2 hours ago', 
      resolved: true, 
      orderId: 'ORD-2341' 
    },
    { 
      rating: 2, 
      text: 'Food took too long to arrive and was cold when it got here.', 
      timeAgo: '4 hours ago', 
      resolved: false, 
      orderId: 'ORD-2298' 
    },
    { 
      rating: 4, 
      text: 'Good atmosphere, friendly staff. Will come back again.', 
      timeAgo: '1 day ago', 
      resolved: true, 
      orderId: null 
    }
  ];

  // KDS Data
  kdsAlerts = [
    { message: '2 tickets over SLA', status: 'error', timeAgo: '5 min ago' },
    { message: '4 tickets at risk', status: 'warning', timeAgo: '8 min ago' },
    { message: 'Oldest ticket: 18 min', status: 'info', timeAgo: 'now' }
  ];

  kdsTickets = [
    { order: 'T-001', items: 3, time: '18m', table: 'A-3', status: 'over' },
    { order: 'T-002', items: 5, time: '12m', table: 'B-7', status: 'warning' },
    { order: 'T-003', items: 2, time: '8m', table: 'C-2', status: 'normal' }
  ];

  // ApexCharts Configuration
  revenueChartOptions: any = {
    series: [{
      name: 'Revenue',
      data: [28000, 31000, 35000, 29000, 41000, 45000, 42000]
    }],
    chart: {
      type: 'area',
      height: 200,
      toolbar: { show: false }
    },
    xaxis: {
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      show: false
    },
    colors: ['#3B82F6'],
    stroke: {
      curve: 'smooth',
      width: 2
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0.1,
        stops: [0, 90, 100]
      }
    },
    grid: { show: false },
    dataLabels: { enabled: false }
  };

  paymentMethodsChartOptions: any = {
    series: [65, 25, 10],
    chart: {
      type: 'donut',
      height: 200,
    },
    labels: ['Cash', 'Card', 'Mobile Money'],
    colors: ['#10B981', '#3B82F6', '#F59E0B'],
    legend: { show: false },
    plotOptions: {
      pie: {
        donut: {
          size: '60%'
        }
      }
    }
  };

  ordersChartOptions: any = {
    series: [{
      data: [44, 55, 41, 64, 22, 43, 21]
    }],
    chart: {
      type: 'bar',
      height: 150,
      toolbar: { show: false }
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
        borderRadius: 4
      }
    },
    xaxis: {
      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: { show: false },
    colors: ['#8B5CF6'],
    grid: { show: false },
    dataLabels: { enabled: false }
  };

  dashboardStats: DashboardStats = {
    totalOrders: 847,
    popularMeal: 'Vegetarian Pork Wraps',
    activeDiners: 73,
    totalRevenue: 'UGX 45.2M',
    ordersGrowth: '+18.2%',
    dinersGrowth: '+8.5%'
  };

  orderStatus: OrderStatus = {
    completed: 652,
    pending: 143,
    cancelled: 52
  };

  recentOrders: RecentOrder[] = [
    {
      id: '#ORD-2341',
      customer: 'John Doe',
      table: 'Table A-3',
      amount: 'UGX 45,000',
      status: 'Completed',
      time: '2 mins ago'
    },
    {
      id: '#ORD-2340',
      customer: 'Sarah Smith',
      table: 'Table B-7',
      amount: 'UGX 67,500',
      status: 'Pending',
      time: '5 mins ago'
    },
    {
      id: '#ORD-2339',
      customer: 'Mike Johnson',
      table: 'Table C-1',
      amount: 'UGX 32,000',
      status: 'Completed',
      time: '8 mins ago'
    },
    {
      id: '#ORD-2338',
      customer: 'Emily Davis',
      table: 'Table A-5',
      amount: 'UGX 58,750',
      status: 'Cancelled',
      time: '12 mins ago'
    },
    {
      id: '#ORD-2337',
      customer: 'David Wilson',
      table: 'Table D-2',
      amount: 'UGX 41,200',
      status: 'Completed',
      time: '15 mins ago'
    },
    {
      id: '#ORD-2336',
      customer: 'Lisa Brown',
      table: 'Table B-4',
      amount: 'UGX 73,850',
      status: 'Pending',
      time: '18 mins ago'
    }
  ];

  topMenuItems: TopMenuItem[] = [
    {
      rank: 1,
      name: 'Vegetarian Pork Wraps',
      category: 'Main Course',
      sales: '142 sold',
      revenue: 'UGX 8.5M'
    },
    {
      rank: 2,
      name: 'Single Caramel Cappuccino',
      category: 'Beverages',
      sales: '128 sold',
      revenue: 'UGX 3.2M'
    },
    {
      rank: 3,
      name: 'Caesar Salad Premium',
      category: 'Starters',
      sales: '96 sold',
      revenue: 'UGX 4.8M'
    },
    {
      rank: 4,
      name: 'Grilled Salmon Fillet',
      category: 'Main Course',
      sales: '84 sold',
      revenue: 'UGX 6.7M'
    },
    {
      rank: 5,
      name: 'Chocolate Lava Cake',
      category: 'Desserts',
      sales: '76 sold',
      revenue: 'UGX 2.3M'
    }
  ];

  liveActivities: LiveActivity[] = [
    {
      id: 1,
      type: 'order',
      title: 'New Order #2342',
      description: 'Table A-5 ordered 2x Cappuccino, 1x Caesar Salad',
      time: 'now'
    },
    {
      id: 2,
      type: 'payment',
      title: 'Payment Received',
      description: 'Order #2340 - UGX 67,500 paid via Mobile Money',
      time: '1m ago'
    },
    {
      id: 3,
      type: 'table',
      title: 'Table Available',
      description: 'Table B-3 has been cleaned and ready for seating',
      time: '2m ago'
    },
    {
      id: 4,
      type: 'order',
      title: 'Order Completed',
      description: 'Kitchen completed Order #2338 - ready for serving',
      time: '3m ago'
    }
  ];

  lowStockItems: LowStockItem[] = [
    {
      name: 'Coffee Beans (Arabica)',
      category: 'Beverages',
      remaining: 2,
      unit: 'kg',
      threshold: 5
    },
    {
      name: 'Fresh Mozzarella',
      category: 'Dairy',
      remaining: 1,
      unit: 'kg',
      threshold: 3
    },
    {
      name: 'Olive Oil (Extra Virgin)',
      category: 'Cooking',
      remaining: 3,
      unit: 'L',
      threshold: 5
    },
    {
      name: 'Salmon Fillets',
      category: 'Protein',
      remaining: 4,
      unit: 'portions',
      threshold: 10
    }
  ];

  salesByCategory: SalesCategory[] = [
    {
      name: 'Main Course',
      sales: 'UGX 18.5M',
      percentage: 45,
      color: '#ef4444'
    },
    {
      name: 'Beverages',
      sales: 'UGX 12.3M',
      percentage: 30,
      color: '#3b82f6'
    },
    {
      name: 'Starters',
      sales: 'UGX 6.8M',
      percentage: 17,
      color: '#10b981'
    },
    {
      name: 'Desserts',
      sales: 'UGX 3.4M',
      percentage: 8,
      color: '#f59e0b'
    }
  ];

  constructor() { }

  ngOnInit(): void {
    this.loadDashboardData();
  }

  loadDashboardData(): void {
    // Simulate API call
  }

  // Date Range Methods
  setDateRange(range: string): void {
    this.selectedDateRange = range;
    this.loadDashboardData();
  }

  getTimeframeLabel(): string {
    switch (this.selectedDateRange) {
      case 'day': return 'Today';
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'ytd': return 'Year to Date';
      default: return 'Today';
    }
  }

  // Table Methods
  getOccupancyColor(): string {
    if (this.occupancyPct >= 85) return 'text-red-600';
    if (this.occupancyPct >= 70) return 'text-yellow-600';
    return 'text-green-600';
  }

  getOccupancyBg(): string {
    if (this.occupancyPct >= 85) return 'bg-gradient-to-br from-red-100 to-red-50';
    if (this.occupancyPct >= 70) return 'bg-gradient-to-br from-yellow-100 to-yellow-50';
    return 'bg-gradient-to-br from-green-100 to-green-50';
  }

  // Popular Items Methods
  setSortBy(type: 'income' | 'quantity'): void {
    this.sortBy = type;
    // Re-sort the popular items based on the new criteria
    this.popularItems.sort((a, b) => {
      if (type === 'income') {
        return b.revenue - a.revenue;
      } else {
        return b.quantity - a.quantity;
      }
    });
  }

  // Review Methods
  getStars(rating: number): number[] {
    return Array(5).fill(0).map((_, i) => i < rating ? 1 : 0);
  }

  // KDS Methods
  getKdsStatusColor(status: string): string {
    switch (status.toLowerCase()) {
      case 'new': return 'bg-blue-500';
      case 'in prep': return 'bg-orange-500';
      case 'ready': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  }

  onTimeRangeChange(timeRange: string): void {
    this.selectedTimeRange = timeRange;
    this.loadDashboardData();
    
    // Update stats based on time range
    this.updateStatsForTimeRange(timeRange);
  }

  private updateStatsForTimeRange(timeRange: string): void {
    // Simulate different data for different time ranges
    switch(timeRange) {
      case 'today':
        this.dashboardStats.totalOrders = 847;
        this.dashboardStats.totalRevenue = 'UGX 45.2M';
        break;
      case 'week':
        this.dashboardStats.totalOrders = 3240;
        this.dashboardStats.totalRevenue = 'UGX 187.5M';
        break;
      case 'month':
        this.dashboardStats.totalOrders = 12480;
        this.dashboardStats.totalRevenue = 'UGX 672.8M';
        break;
      case 'quarter':
        this.dashboardStats.totalOrders = 35760;
        this.dashboardStats.totalRevenue = 'UGX 1.8B';
        break;
    }
  }

  getTotalOrders(): number {
    return this.orderStatus.completed + this.orderStatus.pending + this.orderStatus.cancelled;
  }

  getOrderCompletionPercentage(): number {
    const total = this.getTotalOrders();
    return Math.round((this.orderStatus.completed / total) * 100);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 text-green-800';
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'Cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  // Navigation methods
  navigateToOrders(): void {
  }

  navigateToMenu(): void {
  }

  exportData(): void {
    // Implement export functionality
  }

  createNewOrder(): void {
    // Implement new order creation
  }

  // Chart helper methods
  getRevenueChartData(): any {
    return {
      series: [{
        name: 'Revenue',
        data: this.getRevenueDataForTimeRange()
      }, {
        name: 'Target',
        data: this.getTargetDataForTimeRange()
      }],
      chart: {
        type: 'line',
        height: 300,
        toolbar: { show: false },
        background: 'transparent'
      },
      colors: ['#ef4444', '#3b82f6'],
      stroke: {
        curve: 'smooth',
        width: [3, 2],
        dashArray: [0, 5]
      },
      markers: {
        size: [5, 0],
        strokeColors: ['#ffffff'],
        strokeWidth: 2
      },
      xaxis: {
        categories: this.getTimeLabels(),
        labels: {
          style: {
            colors: '#6b7280',
            fontSize: '12px'
          }
        }
      },
      yaxis: {
        labels: {
          style: {
            colors: '#6b7280',
            fontSize: '12px'
          },
          formatter: (value: number) => `${(value / 1000).toFixed(0)}K`
        }
      },
      grid: {
        borderColor: '#f1f5f9'
      },
      tooltip: {
        shared: true,
        intersect: false
      }
    };
  }

  private getRevenueDataForTimeRange(): number[] {
    switch(this.selectedTimeRange) {
      case 'today':
        return [25000, 35000, 28000, 42000, 38000, 45000, 52000];
      case 'week':
        return [180000, 220000, 195000, 275000, 240000, 285000, 310000];
      case 'month':
        return [1200000, 1450000, 1380000, 1620000, 1580000, 1720000, 1850000];
      default:
        return [25000, 35000, 28000, 42000, 38000, 45000, 52000];
    }
  }

  private getTargetDataForTimeRange(): number[] {
    switch(this.selectedTimeRange) {
      case 'today':
        return [30000, 32000, 34000, 36000, 38000, 40000, 42000];
      case 'week':
        return [200000, 210000, 220000, 230000, 240000, 250000, 260000];
      case 'month':
        return [1300000, 1350000, 1400000, 1450000, 1500000, 1550000, 1600000];
      default:
        return [30000, 32000, 34000, 36000, 38000, 40000, 42000];
    }
  }

  private getTimeLabels(): string[] {
    switch(this.selectedTimeRange) {
      case 'today':
        return ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM', '12AM'];
      case 'week':
        return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      case 'month':
        return ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'];
      default:
        return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    }
  }

  getKitchenLoadClass(): string {
    if (this.kitchenLoad >= 80) return 'text-red-600 bg-red-50';
    if (this.kitchenLoad >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  }

  getActivityIconClass(type: string): string {
    switch(type) {
      case 'order': return 'text-blue-600';
      case 'payment': return 'text-green-600';
      case 'table': return 'text-purple-600';
      case 'review': return 'text-yellow-600';
      default: return 'text-gray-600';
    }
  }

  getPerformanceChange(current: number, previous: number): string {
    const change = ((current - previous) / previous * 100);
    return change >= 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`;
  }

  getPerformanceChangeClass(current: number, previous: number): string {
    const change = current - previous;
    return change >= 0 ? 'text-green-600' : 'text-red-600';
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-UG', {
      style: 'currency',
      currency: 'UGX',
      minimumFractionDigits: 0
    }).format(amount);
  }

  formatTime(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  getKitchenLoadBarClass(): string {
    if (this.kitchenLoad >= 80) return 'bg-red-600';
    if (this.kitchenLoad >= 60) return 'bg-yellow-600';
    return 'bg-green-600';
  }

  getServiceSpeedClass(): string {
    if (this.serviceSpeed <= 10) return 'text-green-600';
    if (this.serviceSpeed <= 20) return 'text-yellow-600';
    return 'text-red-600';
  }
  getServiceSpeedPercentage(): number {
    return Math.min(100, (30 - this.serviceSpeed) / 30 * 100);
  }
  getWaitTimePercentage(): number {
    return Math.min(100, (20 - this.customerWaitTime) / 20 * 100);
  }
}