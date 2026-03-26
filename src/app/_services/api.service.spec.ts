import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { environment } from 'src/environments/environment';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/api/${environment.version}`;

  beforeEach(() => {
    TestBed.configureTestingModule({
    imports: [],
    providers: [ApiService, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
});
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('postPatch payload filtering', () => {
    it('should preserve false values in payload', () => {
      const data = { available: false, name: 'Test' };
      service.postPatch('items/', data, 'post').subscribe();

      const req = httpMock.expectOne(`${base}/items/`);
      expect(req.request.body).toEqual({ available: false, name: 'Test' });
    });

    it('should preserve zero values in payload', () => {
      const data = { price: 0, name: 'Free Item' };
      service.postPatch('items/', data, 'post').subscribe();

      const req = httpMock.expectOne(`${base}/items/`);
      expect(req.request.body).toEqual({ price: 0, name: 'Free Item' });
    });

    it('should preserve empty string values in payload', () => {
      const data = { description: '', name: 'Item' };
      service.postPatch('items/', data, 'post').subscribe();

      const req = httpMock.expectOne(`${base}/items/`);
      expect(req.request.body).toEqual({ description: '', name: 'Item' });
    });

    it('should strip null values from payload', () => {
      const data = { name: 'Item', deleted: null };
      service.postPatch('items/', data, 'post').subscribe();

      const req = httpMock.expectOne(`${base}/items/`);
      expect(req.request.body).toEqual({ name: 'Item' });
    });

    it('should strip undefined values from payload', () => {
      const data = { name: 'Item', extra: undefined };
      service.postPatch('items/', data, 'post').subscribe();

      const req = httpMock.expectOne(`${base}/items/`);
      expect(req.request.body).toEqual({ name: 'Item' });
    });

    it('should preserve all values when has_false is true', () => {
      const data = { available: false, price: 0, name: 'Test' };
      service.postPatch('items/', data, 'post', undefined, undefined, false, undefined, true).subscribe();

      const req = httpMock.expectOne(`${base}/items/`);
      expect(req.request.body).toEqual({ available: false, price: 0, name: 'Test' });
    });
  });

  describe('URL construction', () => {
    it('should use base URL by default', () => {
      service.get(null, 'test/').subscribe();
      const req = httpMock.expectOne(`${base}/test/`);
      expect(req.request.method).toBe('GET');
    });

    it('should use version override when provided', () => {
      service.get(null, 'test/', {}, 'v2').subscribe();
      const req = httpMock.expectOne(`${environment.apiUrl}/api/v2/test/`);
      expect(req.request.method).toBe('GET');
    });

    it('should append id when provided', () => {
      service.get('123', 'items/').subscribe();
      const req = httpMock.expectOne(`${base}/items//123`);
      expect(req.request.method).toBe('GET');
    });
  });

  describe('correctFormatForQueryUrl', () => {
    it('should return empty string for falsy input', () => {
      expect(service.correctFormatForQueryUrl(null)).toBe('');
      expect(service.correctFormatForQueryUrl(undefined)).toBe('');
    });

    it('should format query params correctly', () => {
      const result = service.correctFormatForQueryUrl({ page: 1, search: 'test' });
      expect(result).toBe('?page=1&search=test');
    });

    it('should return empty string for empty object', () => {
      expect(service.correctFormatForQueryUrl({})).toBe('');
    });
  });
});
