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
    tags: [],
    createdAt: new Date().toISOString(),
    orderNumber: 42,
    tableLabel: 'Table 5',
    spend: '30000',
    isCritical: true,
    resolutionStatus: 'open',
    resolutionNote: null,
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

  it('reveals the note panel when marking an open review resolved — without resolving yet', () => {
    const open = makeReview({ id: 7, resolutionStatus: 'open' });
    const svc = TestBed.inject(ReviewsService);
    const spy = spyOn(svc, 'resolveReview');

    component.view = 'all';
    component.reviews = [open];

    component.toggleResolve(open);

    expect(component.isPanelOpen(open)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('confirms an open review with a note, flips it in place, sends the note, and closes the panel', () => {
    const open = makeReview({ id: 7, resolutionStatus: 'open' });
    const resolved = makeReview({
      id: 7,
      resolutionStatus: 'resolved',
      resolutionNote: 'Comped the meal',
    });
    const svc = TestBed.inject(ReviewsService);
    const spy = spyOn(svc, 'resolveReview').and.returnValue(of(resolved));

    component.view = 'all';
    component.reviews = [open];

    component.startResolve(open);
    component.noteDraft = '  Comped the meal  ';
    component.confirmResolve(open);

    // Note is trimmed before sending.
    expect(spy).toHaveBeenCalledWith('7', 'resolved', 'Comped the meal');
    expect(component.reviews.length).toBe(1);
    expect(component.reviews[0].resolutionStatus).toBe('resolved');
    expect(component.reviews[0].resolutionNote).toBe('Comped the meal');
    expect(component.isPanelOpen(open)).toBe(false);
    expect(component.noteDraft).toBe('');
  });

  it('confirms with a blank draft by sending no note', () => {
    const open = makeReview({ id: 7, resolutionStatus: 'open' });
    const resolved = makeReview({ id: 7, resolutionStatus: 'resolved' });
    const svc = TestBed.inject(ReviewsService);
    const spy = spyOn(svc, 'resolveReview').and.returnValue(of(resolved));

    component.reviews = [open];
    component.startResolve(open);
    component.noteDraft = '   ';
    component.confirmResolve(open);

    expect(spy).toHaveBeenCalledWith('7', 'resolved', undefined);
  });

  it('cancels the note panel without resolving', () => {
    const open = makeReview({ id: 7, resolutionStatus: 'open' });
    const svc = TestBed.inject(ReviewsService);
    const spy = spyOn(svc, 'resolveReview');

    component.reviews = [open];
    component.startResolve(open);
    component.noteDraft = 'half-typed';
    component.cancelResolve();

    expect(component.isPanelOpen(open)).toBe(false);
    expect(component.noteDraft).toBe('');
    expect(spy).not.toHaveBeenCalled();
  });

  it('reopens a resolved review in one click, with no note and no panel', () => {
    const resolved = makeReview({ id: 7, resolutionStatus: 'resolved' });
    const reopened = makeReview({ id: 7, resolutionStatus: 'open' });
    const svc = TestBed.inject(ReviewsService);
    const spy = spyOn(svc, 'resolveReview').and.returnValue(of(reopened));

    component.view = 'all';
    component.reviews = [resolved];

    component.toggleResolve(resolved);

    expect(spy).toHaveBeenCalledWith('7', 'open', undefined);
    expect(component.isPanelOpen(resolved)).toBe(false);
    expect(component.reviews[0].resolutionStatus).toBe('open');
  });

  it('drops a now-resolved review out of the needs-attention view', () => {
    const open = makeReview({ id: 7, resolutionStatus: 'open', isCritical: true });
    const resolved = makeReview({ id: 7, resolutionStatus: 'resolved', isCritical: true });
    const svc = TestBed.inject(ReviewsService);
    spyOn(svc, 'resolveReview').and.returnValue(of(resolved));

    component.view = 'attention';
    component.reviews = [open];

    component.startResolve(open);
    component.confirmResolve(open);

    expect(component.reviews.length).toBe(0);
  });

  // --- Tapped quick-feedback chips (read-only badges) -----------------------

  /** Trimmed text of every app-dn-badge currently rendered. */
  function badgeTexts(): (string | undefined)[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('app-dn-badge') as NodeListOf<Element>,
    ).map((el) => el.textContent?.trim());
  }

  it('renders a badge per tapped tag with mapped labels', () => {
    component.loading = false;
    component.error = null;
    component.reviews = [makeReview({ tags: ['great_flavour', 'friendly_staff'] })];
    fixture.detectChanges();

    const texts = badgeTexts();
    expect(texts).toContain('Great flavour');
    expect(texts).toContain('Friendly staff');
  });

  it('renders no tag labels when the review has no tags', () => {
    component.loading = false;
    component.error = null;
    component.reviews = [makeReview({ tags: [] })];
    fixture.detectChanges();

    // The Critical/Open status badges still render; none of the tag labels do.
    expect(badgeTexts()).not.toContain('Great flavour');
  });

  it('humanizes an unknown tag key into a clean label', () => {
    component.loading = false;
    component.error = null;
    component.reviews = [makeReview({ tags: ['mystery_thing'] })];
    fixture.detectChanges();

    expect(badgeTexts()).toContain('Mystery thing');
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
