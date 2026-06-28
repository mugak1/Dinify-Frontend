import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiService } from 'src/app/_services/api.service';
import { OrderCompleteComponent } from './order-complete.component';

describe('OrderCompleteComponent', () => {
  let component: OrderCompleteComponent;
  let fixture: ComponentFixture<OrderCompleteComponent>;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch']);
    api.postPatch.and.returnValue(of({}) as any); // inert default; tests override

    await TestBed.configureTestingModule({
      declarations: [OrderCompleteComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ApiService, useValue: api },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();

    fixture = TestBed.createComponent(OrderCompleteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not submit without an overall rating', () => {
    component.orderId.set('order-1');

    component.submitReview();

    expect(api.postPatch).not.toHaveBeenCalled();
  });

  it('submits only the rated fields (omitting unrated dimensions + empty comment) and shows a thank-you on success', () => {
    component.orderId.set('order-1');
    component.overall.set(4);
    component.setDimension('food_rating', 5);
    component.comment.set('  Lovely  ');
    api.postPatch.and.returnValue(of({}) as any);

    component.submitReview();

    expect(api.postPatch).toHaveBeenCalledWith(
      'reviews/submit/',
      { order: 'order-1', overall_rating: 4, food_rating: 5, comment: 'Lovely' },
      'post',
    );
    expect(component.submitted()).toBeTrue();
    expect(component.submitting()).toBeFalse();
  });

  it('sends selected quick chips as stable keys (never the labels)', () => {
    component.orderId.set('order-1');
    component.overall.set(5);
    component.toggleTag('great_flavour');
    component.toggleTag('spotless');
    api.postPatch.and.returnValue(of({}) as any);

    component.submitReview();

    expect(api.postPatch).toHaveBeenCalledWith(
      'reviews/submit/',
      { order: 'order-1', overall_rating: 5, tags: ['great_flavour', 'spotless'] },
      'post',
    );
  });

  it('omits tags entirely when no chip is selected', () => {
    component.orderId.set('order-1');
    component.overall.set(4);
    api.postPatch.and.returnValue(of({}) as any);

    component.submitReview();

    expect(api.postPatch).toHaveBeenCalledWith(
      'reviews/submit/',
      { order: 'order-1', overall_rating: 4 },
      'post',
    );
  });

  it('formats the order number identically to the kitchen (3-digit, leading #)', () => {
    component.orderNumber.set(7);
    expect(component.orderNumberLabel()).toBe('#007');
  });

  it('shows a working back-to-menu action on the thank-you screen', () => {
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.stub();
    component.orderId.set('order-1');
    component.overall.set(5);
    api.postPatch.and.returnValue(of({}) as any);

    component.submitReview();
    expect(component.submitted()).toBeTrue();
    fixture.detectChanges();

    const back = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find(b => (b.textContent ?? '').trim().toLowerCase() === 'back to menu');
    expect(back).toBeTruthy();

    back!.click();
    expect(navSpy).toHaveBeenCalled();
  });

  it('re-enables submit and keeps the form on error (the global toast owns the message)', () => {
    component.orderId.set('order-1');
    component.overall.set(3);
    api.postPatch.and.returnValue(throwError(() => 'already reviewed') as any);

    component.submitReview();

    expect(component.submitting()).toBeFalse();
    expect(component.submitted()).toBeFalse();
  });
});
