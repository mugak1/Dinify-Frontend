import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ReviewsService } from './reviews.service';
import { ApiService } from '../../../_services/api.service';

/**
 * Focused coverage for resolveReview's PATCH body: resolution_note must only be
 * sent when a note is actually provided, so resolving/reopening without one
 * never clears an existing note on the backend.
 */
describe('ReviewsService.resolveReview', () => {
  let service: ReviewsService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    const apiSpy = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch']);
    TestBed.configureTestingModule({
      providers: [ReviewsService, { provide: ApiService, useValue: apiSpy }],
    });
    service = TestBed.inject(ReviewsService);
    api = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    api.postPatch.and.returnValue(of({ data: { id: 7, resolution_status: 'resolved' } }));
  });

  it('sends status only when no note is given', () => {
    service.resolveReview('7', 'resolved').subscribe();
    expect(api.postPatch).toHaveBeenCalledWith(
      'reviews/7/resolution/',
      { resolution_status: 'resolved' },
      'patch',
    );
  });

  it('includes resolution_note in the body when a note is given', () => {
    service.resolveReview('7', 'resolved', 'Comped the meal').subscribe();
    expect(api.postPatch).toHaveBeenCalledWith(
      'reviews/7/resolution/',
      { resolution_status: 'resolved', resolution_note: 'Comped the meal' },
      'patch',
    );
  });

  it('omits resolution_note when reopening with no note', () => {
    service.resolveReview('7', 'open').subscribe();
    expect(api.postPatch).toHaveBeenCalledWith(
      'reviews/7/resolution/',
      { resolution_status: 'open' },
      'patch',
    );
  });
});
