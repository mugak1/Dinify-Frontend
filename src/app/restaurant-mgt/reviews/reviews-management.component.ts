import { Component, OnInit } from '@angular/core';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ApiResponse } from 'src/app/_models/app.models';

interface Review {
  id: string;
  name: string;
  initials: string;
  rating: number;
  timestamp: string;
  comment: string;
  status: 'new' | 'in progress' | 'responded' | 'resolved';
  avatar: string;
  isFlagged?: boolean;
}

interface ReviewDetail extends Review {
  location: string;
  amount: string;
  table: string;
  summary: string;
  tags: string[];
  isRegular: boolean;
  orderItems?: string[];
}

@Component({
    selector: 'app-reviews-management',
    templateUrl: './reviews-management.component.html',
    styleUrls: ['./reviews-management.component.css'],
    standalone: false
})
export class ReviewsManagementComponent implements OnInit {
  reviews: Review[] = [];
  selectedReview: ReviewDetail | null = null;
  searchQuery: string = '';
  selectedStatus: string = 'All Status';
  selectedRating: string = 'All Ratings';
  sortBy: string = 'Newest';
  showReplyBox: boolean = false;
  replyText: string = '';
  isLoadingReviews: boolean = false;
  restaurantId: string = '';
  expandedOrderSummary: boolean = false;
  isPublicReply: boolean = true;

  statusOptions = [
    { label: 'All Status', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'In Progress', value: 'in progress' },
    { label: 'Responded', value: 'responded' },
    { label: 'Resolved', value: 'resolved' }
  ];

  ratingOptions = [
    { label: 'All Ratings', value: 'all' },
    { label: '5 Stars', value: '5' },
    { label: '4 Stars', value: '4' },
    { label: '3 Stars', value: '3' },
    { label: '1-2 Stars', value: '1-2' }
  ];

  sortOptions = [
    { label: 'Newest', value: 'newest' },
    { label: 'Oldest', value: 'oldest' },
    { label: 'Highest Rating', value: 'highest' },
    { label: 'Lowest Rating', value: 'lowest' }
  ];

  constructor(
    private api: ApiService,
    private auth: AuthenticationService
  ) {
    this.restaurantId = this.auth.currentRestaurant?.id || '';
  }

  ngOnInit(): void {
    this.loadReviews();
  }

  loadReviews(): void {
    this.isLoadingReviews = true;
    const params: any = {
      search: this.searchQuery,
      status: this.selectedStatus !== 'All Status' ? this.selectedStatus : undefined,
      rating: this.selectedRating !== 'All Ratings' ? this.selectedRating : undefined,
      sortBy: this.sortBy
    };

    this.api.get<Review[]>(
      this.restaurantId,
      'reviews',
      params
    ).subscribe({
      next: (response: ApiResponse<Review[]>) => {
        this.reviews = Array.isArray(response.data) ? response.data : [];
        this.isLoadingReviews = false;
      },
      error: (_error: any) => {
        this.isLoadingReviews = false;
        this.loadMockReviews();
      }
    });
  }

  loadMockReviews(): void {
    this.reviews = [
      {
        id: '1',
        name: 'Lisa Anderson',
        initials: 'LA',
        rating: 1,
        timestamp: '1h ago',
        comment: 'Terrible experience. Found a hair in my soup and when I complained, the manager was dismissive. Never coming back.',
        status: 'new',
        avatar: '#FF6B6B'
      },
      {
        id: '2',
        name: 'David Okonkwo',
        initials: 'DO',
        rating: 3,
        timestamp: '2h ago',
        comment: 'Food quality was good but prices seem high for takeaway portions. The value isn\'t quite there compared to dining in.',
        status: 'new',
        avatar: '#4ECDC4'
      },
      {
        id: '3',
        name: 'Sarah Johnson',
        initials: 'SJ',
        rating: 5,
        timestamp: '3h ago',
        comment: 'Absolutely wonderful experience! The food was exquisite and the service was impeccable. Our waiter John was particularly attentive. Will definitely be back!',
        status: 'new',
        avatar: '#95E1D3'
      },
      {
        id: '4',
        name: 'Michael Chen',
        initials: 'MC',
        rating: 2,
        timestamp: '5h ago',
        comment: 'Very disappointed. Waited over 45 minutes for our main course. When it finally arrived, the steak was overcooked. Staff seemed overwhelmed and unapologetic.',
        status: 'in progress',
        avatar: '#A8D8EA'
      },
      {
        id: '5',
        name: 'Guest User',
        initials: 'GU',
        rating: 4,
        timestamp: '8h ago',
        comment: 'Food was great, delivery was quick. Only minor issue was the packaging - some sauce leaked. Otherwise excellent!',
        status: 'responded',
        avatar: '#FFB4A2'
      },
      {
        id: '6',
        name: 'Emma Williams',
        initials: 'EW',
        rating: 5,
        timestamp: '1d ago',
        comment: 'Perfect anniversary dinner! The ambience was romantic, food was delicious, and the staff made us feel special. The complimentary dessert was a lovely touch!',
        status: 'resolved',
        avatar: '#FFDDC1'
      },
      {
        id: '7',
        name: 'James Mutabazi',
        initials: 'JM',
        rating: 4,
        timestamp: '2d ago',
        comment: 'Great lunch spot! Quick service and tasty food. The new chicken dish is amazing. Only wish they had more vegetarian options.',
        status: 'responded',
        avatar: '#E0B9D4'
      }
    ];
  }

  selectReview(review: Review): void {
    this.selectedReview = {
      ...review,
      location: 'Downtown Branch',
      amount: 'USh 125,000',
      table: 'Table T12',
      summary: review.rating >= 4 
        ? 'Positive about food quality and service.' 
        : review.rating === 3 
        ? 'Mixed feedback with value concerns.'
        : 'Negative experience with service issues.',
      tags: review.rating >= 4 
        ? ['food', 'service'] 
        : review.rating === 3 
        ? ['price', 'portions']
        : ['service', 'wait time'],
      isRegular: Math.random() > 0.5,
      orderItems: ['Grilled Chicken Burger (x2)', 'Caesar Salad', 'Fried Potatoes', 'Iced Tea (x2)', 'Cheesecake']
    };
    this.showReplyBox = false;
    this.replyText = '';
    this.expandedOrderSummary = false;
    this.isPublicReply = true;
  }

  getRatingColor(rating: number): string {
    if (rating >= 4) return 'text-warning fill-warning';
    if (rating === 3) return 'text-warning fill-warning';
    return 'text-warning fill-warning';
  }

  getStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'new': 'bg-primary/10 text-primary border-primary/20',
      'in progress': 'bg-warning/10 text-warning border-warning/20',
      'responded': 'bg-success/10 text-success border-success/20',
      'resolved': 'bg-muted text-muted-foreground border-muted'
    };
    return colors[status] || 'bg-secondary/10 text-secondary border-secondary/20';
  }

  getReplyStatus(status: string): string {
    // Map old status values to replied/not replied
    if (status === 'responded' || status === 'resolved') {
      return 'Replied';
    }
    return 'Not Replied';
  }

  getReplyStatusColor(status: string): string {
    const replyStatus = this.getReplyStatus(status);
    if (replyStatus === 'Replied') {
      return 'bg-success/10 text-success border-success/20';
    }
    return 'bg-muted text-muted-foreground border-muted';
  }

  sendReply(): void {
    if (!this.selectedReview || !this.replyText.trim()) return;

    const replyData = {
      reviewId: this.selectedReview.id,
      reply: this.replyText,
      isPublic: true
    };

    this.api.postPatch(`reviews/reply`, replyData, 'post', this.restaurantId).subscribe({
      next: () => {
        this.replyText = '';
        this.showReplyBox = false;
        if (this.selectedReview) {
          this.selectedReview.status = 'responded';
        }
      },
      error: (_error: any) => {
      }
    });
  }

  applyFilters(): void {
    this.loadReviews();
  }

  getStarArray(rating: number): number[] {
    return Array(5).fill(0).map((_, i) => i < rating ? 1 : 0);
  }
}
