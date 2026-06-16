import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ReviewsFeedComponent } from './reviews-feed.component';

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
});
