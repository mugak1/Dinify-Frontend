import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { RestaurantTagService } from './restaurant-tag.service';
import { RestaurantTag } from '../_models/app.models';

describe('RestaurantTagService', () => {
  let service: RestaurantTagService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    const apiSpy = jasmine.createSpyObj('ApiService', ['get', 'postPatch', 'Delete']);
    TestBed.configureTestingModule({
      providers: [
        RestaurantTagService,
        { provide: ApiService, useValue: apiSpy },
      ],
    });
    service = TestBed.inject(RestaurantTagService);
    api = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
  });

  describe('update', () => {
    // Pins the contract that broke: the tag detail route is a PATCH to
    // restaurant-setup/restaurant-tags/<id>/, NOT a PUT to the list route
    // (which the backend serves GET/POST only and 405s on).
    it('PATCHes the detail route with the id in the URL and no id in the body', (done) => {
      const updatedTag = { id: 'tag-1', name: 'Vegan', filterable: true } as unknown as RestaurantTag;
      api.postPatch.and.returnValue(of({ status: 200, message: 'ok', data: updatedTag } as any));

      service.update('tag-1', { filterable: true }).subscribe((tag) => {
        expect(api.postPatch).toHaveBeenCalledWith(
          'restaurant-setup/restaurant-tags/tag-1/',
          { filterable: true },
          'patch',
        );
        // The id is carried by the URL, never smuggled into the request body.
        const [, body] = api.postPatch.calls.mostRecent().args;
        expect((body as { id?: string }).id).toBeUndefined();
        // The response's `data` envelope is unwrapped into the emitted tag.
        expect(tag).toBe(updatedTag);
        done();
      });
    });

    it('falls back to the raw response when there is no data envelope', (done) => {
      const rawTag = { id: 'tag-2', name: 'Halal' } as unknown as RestaurantTag;
      api.postPatch.and.returnValue(of(rawTag as any));

      service.update('tag-2', { name: 'Halal' }).subscribe((tag) => {
        expect(tag).toBe(rawTag);
        done();
      });
    });
  });
});
