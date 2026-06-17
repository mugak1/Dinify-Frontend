import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { ReviewsFeedComponent } from './reviews-feed.component';
import { ReviewsService } from '../services/reviews.service';
import { ReviewListItem } from '../models/reviews.models';

function makeReview(overrides: Partial<ReviewListItem> = {}): ReviewListItem {
  return {
    id: 7,
    overallRating: 2,
    comment: 'Cold food',
    createdAt: new Date().toISOString(),
    orderNumber: 42,
    tableLabel: 'Table 5',
    spend: '30000',
    isCritical: true,
    resolutionStatus: 'open',
    foodRating: 2,
    speedRating: null,
    serviceRating: null,
    valueRating: null,
    cleanlinessRating: null,
    ...overrides,
  };
}

describe('ReviewsFeedComponent', () => {
  let component: ReviewsFeedComponent;
  let fixture: ComponentFixture<ReviewsFeedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Standalone component → imports, NOT declarations
      imports: [ReviewsFeedComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewsFeedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to the all-reviews view with no filters', () => {
    expect(component.view).toBe('all');
    expect(component.rating).toBeNull();
    expect(component.resolution).toBeNull();
    expect(component.buildFilters()).toEqual({});
  });

  it('builds the critical + open queue for the needs-attention view', () => {
    component.view = 'attention';
    expect(component.buildFilters()).toEqual({ critical: true, resolutionStatus: 'open' });
  });

  it('layers the rating filter on top of the active view', () => {
    component.rating = 5;
    expect(component.buildFilters()).toEqual({ rating: 5 });

    component.view = 'attention';
    expect(component.buildFilters()).toEqual({
      critical: true,
      resolutionStatus: 'open',
      rating: 5,
    });
  });

  it('applies the resolution filter in the all-reviews view', () => {
    component.resolution = 'resolved';
    expect(component.buildFilters()).toEqual({ resolutionStatus: 'resolved' });
  });

  it('setView switches the active view', () => {
    component.setView('attention');
    expect(component.view).toBe('attention');
  });

  it('derives a filter-aware empty message', () => {
    expect(component.emptyTitle).toBe('No reviews match');
    component.view = 'attention';
    expect(component.emptyTitle).toBe('Nothing needs attention');
  });

  it('resolves an open review and flips it to resolved in place in the all view', () => {
    const open = makeReview({ id: 7, resolutionStatus: 'open' });
    const resolved = makeReview({ id: 7, resolutionStatus: 'resolved' });
    const svc = TestBed.inject(ReviewsService);
    const spy = spyOn(svc, 'resolveReview').and.returnValue(of(resolved));

    component.view = 'all';
    component.reviews = [open];

    component.resolve(open);

    expect(spy).toHaveBeenCalledWith('7', 'resolved');
    expect(component.reviews.length).toBe(1);
    expect(component.reviews[0].resolutionStatus).toBe('resolved');
  });

  it('drops a now-resolved review out of the needs-attention view', () => {
    const open = makeReview({ id: 7, resolutionStatus: 'open', isCritical: true });
    const resolved = makeReview({ id: 7, resolutionStatus: 'resolved', isCritical: true });
    const svc = TestBed.inject(ReviewsService);
    spyOn(svc, 'resolveReview').and.returnValue(of(resolved));

    component.view = 'attention';
    component.reviews = [open];

    component.resolve(open);

    expect(component.reviews.length).toBe(0);
  });
});

describe('ReviewsFeedComponent — ?view=attention deep-link', () => {
  it('starts in the needs-attention view when the view query param is "attention"', async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewsFeedComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            parent: null,
            snapshot: { queryParamMap: convertToParamMap({ view: 'attention' }) },
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReviewsFeedComponent);
    fixture.detectChanges(); // runs ngOnInit → reads the deep-link param

    expect(fixture.componentInstance.view).toBe('attention');
    expect(fixture.componentInstance.buildFilters()).toEqual({
      critical: true,
      resolutionStatus: 'open',
    });
  });
});
