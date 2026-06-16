import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ReviewsOverviewComponent } from './reviews-overview.component';

describe('ReviewsOverviewComponent', () => {
  let component: ReviewsOverviewComponent;
  let fixture: ComponentFixture<ReviewsOverviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Standalone component → goes in imports, not declarations.
      imports: [ReviewsOverviewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewsOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to the 90-day timeframe', () => {
    expect(component.timeframeDays).toBe(90);
  });
});
