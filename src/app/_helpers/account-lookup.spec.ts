import { HttpErrorResponse, HttpRequest } from '@angular/common/http';

import { environment } from 'src/environments/environment';
import { isAccountLookup, isNoAccountAnswer, lookupRefusalMessage } from './account-lookup';

const API = `${environment.apiUrl}/api/${environment.version}`;

function error404(body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status: 404, statusText: 'Not Found', error: body });
}

describe('account-lookup', () => {
  describe('isAccountLookup', () => {
    it('matches both lookups as the callers send them', () => {
      expect(isAccountLookup(new HttpRequest('GET', `${API}/users/msisdn-lookup/?msisdn=256700111222`))).toBeTrue();
      expect(isAccountLookup(new HttpRequest('GET', `${API}/users/user-lookup/?contact=256700111222`))).toBeTrue();
    });

    it('tolerates a missing trailing slash', () => {
      expect(isAccountLookup(new HttpRequest('GET', `${API}/users/user-lookup?contact=x`))).toBeTrue();
    });

    it('does not match another users route, another method, or a mention in the query', () => {
      expect(isAccountLookup(new HttpRequest('GET', `${API}/users/user-profile/`))).toBeFalse();
      expect(isAccountLookup(new HttpRequest('POST', `${API}/users/user-lookup/`, {}))).toBeFalse();
      expect(isAccountLookup(new HttpRequest('GET', `${API}/users/user-profile/?next=/users/user-lookup/`))).toBeFalse();
      expect(isAccountLookup(new HttpRequest('GET', `${API}/users/user-lookup/extra/`))).toBeFalse();
    });
  });

  describe('isNoAccountAnswer', () => {
    it('accepts the endpoints\' own 404 envelope, with or without data', () => {
      expect(isNoAccountAnswer(error404({ status: 404, message: 'User not found' }))).toBeTrue();
      expect(isNoAccountAnswer(error404({
        status: 404, message: 'User not found', data: { found: false },
      }))).toBeTrue();
    });

    it('refuses a 404 that is not the lookup\'s own answer', () => {
      expect(isNoAccountAnswer(error404({ detail: 'Not found.' }))).toBeFalse();
      expect(isNoAccountAnswer(error404('<h1>Not Found</h1>'))).toBeFalse();
      expect(isNoAccountAnswer(error404(null))).toBeFalse();
      expect(isNoAccountAnswer(error404({ status: '404', message: 'User not found' }))).toBeFalse();
    });

    it('refuses any other HTTP status, whatever the body says', () => {
      for (const status of [0, 400, 403, 429, 500]) {
        const err = new HttpErrorResponse({ status, error: { status: 404, message: 'User not found' } });
        expect(isNoAccountAnswer(err)).withContext(`HTTP ${status}`).toBeFalse();
      }
    });

    it('refuses anything that is not an HttpErrorResponse', () => {
      // The flattened string ErrorInterceptor produces on its generic path, and
      // the pre-`a2f7f8c` 2xx body shape, are not this answer.
      expect(isNoAccountAnswer('User not found')).toBeFalse();
      expect(isNoAccountAnswer({ status: 404, error: { status: 404 } })).toBeFalse();
      expect(isNoAccountAnswer(undefined)).toBeFalse();
    });
  });

  describe('lookupRefusalMessage', () => {
    function error400(body: unknown): HttpErrorResponse {
      return new HttpErrorResponse({ status: 400, statusText: 'Bad Request', error: body });
    }

    it('returns the message of the endpoints\' own 400 envelope, as written', () => {
      expect(lookupRefusalMessage(error400({
        status: 400, message: 'Please provide a valid Ugandan phone number.',
      }))).toBe('Please provide a valid Ugandan phone number.');
      expect(lookupRefusalMessage(error400({
        status: 400, message: 'A contact query parameter is required.',
      }))).toBe('A contact query parameter is required.');
    });

    it('refuses a 400 that is not the lookup\'s own refusal, or has nothing to show', () => {
      expect(lookupRefusalMessage(error400({ detail: 'Bad request.' }))).toBeNull();
      expect(lookupRefusalMessage(error400({ status: '400', message: 'x' }))).toBeNull();
      expect(lookupRefusalMessage(error400({ status: 400 }))).toBeNull();
      expect(lookupRefusalMessage(error400({ status: 400, message: '  ' }))).toBeNull();
      expect(lookupRefusalMessage(error400({ status: 400, message: 7 }))).toBeNull();
      expect(lookupRefusalMessage(error400('<h1>Bad Request</h1>'))).toBeNull();
      expect(lookupRefusalMessage(error400(null))).toBeNull();
    });

    it('refuses any other HTTP status, whatever the body says', () => {
      for (const status of [0, 403, 404, 429, 500]) {
        const err = new HttpErrorResponse({ status, error: { status: 400, message: 'x' } });
        expect(lookupRefusalMessage(err)).withContext(`HTTP ${status}`).toBeNull();
      }
    });

    it('refuses anything that is not an HttpErrorResponse', () => {
      expect(lookupRefusalMessage('Please provide a valid Ugandan phone number.')).toBeNull();
      expect(lookupRefusalMessage({ status: 400, error: { status: 400, message: 'x' } })).toBeNull();
      expect(lookupRefusalMessage(undefined)).toBeNull();
    });
  });
});
