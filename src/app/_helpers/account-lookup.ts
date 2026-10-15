import { HttpErrorResponse, HttpRequest } from '@angular/common/http';

/**
 * THE TWO ACCOUNT LOOKUPS, AND THE ONE READING OF THEIR "NO ACCOUNT" ANSWER.
 *
 *  - `GET users/msisdn-lookup/?msisdn=` — the public sign-up page
 *    (`RegisterComponent`). No account: send the OTP and start sign-up.
 *  - `GET users/user-lookup/?contact=` — the owner's add-staff form
 *    (`StaffFormDialogComponent`). No account: offer to create a new employee.
 *
 * Both endpoints (backend `users_app/endpoints/user_lookup.py`) have answered
 * "no account" with HTTP 404 and the body `{status: 404, message: 'User not
 * found'}` since backend `a2f7f8c` (2026-03-16). Before that the answer was
 * HTTP 200 with `status: 400` in the BODY, and both callers kept looking for it
 * in their `next` callbacks. The 404 went to `error` instead, `ErrorInterceptor`
 * turned it into a "User not found" toast, and neither "no account" path could
 * be reached. `ErrorInterceptor` and both callers read the answer through this
 * file, so the three cannot disagree about it.
 *
 * THE ENVELOPE IS PART OF THE ANSWER. The HTTP status alone does not say who
 * answered: a missing route, a proxy or a wrong API version is also a 404, and
 * none of them says the number has no account. Reading one as "no account"
 * would send an OTP, or offer to create a second account for a number that may
 * already have one, on the strength of something the lookup never said. The
 * endpoint's own `status: 404` in the body is what makes it the lookup's answer.
 * It is a machine field; the human message is deliberately not matched.
 */

/**
 * Is this one of the two account lookups? Matched on the method and the path
 * SHAPE, anchored at the end of the path, so a URL that merely mentions the
 * route (in a query parameter, say) cannot borrow the behaviour.
 */
export function isAccountLookup(request: HttpRequest<unknown>): boolean {
  if (request.method !== 'GET') return false;
  const path = request.url.split(/[?#]/)[0];
  return /\/users\/(?:msisdn|user)-lookup\/?$/.test(path);
}

/** Is this error the lookup's own "no account" answer (see the file header)? */
export function isNoAccountAnswer(err: unknown): err is HttpErrorResponse {
  if (!(err instanceof HttpErrorResponse) || err.status !== 404) return false;
  const body: unknown = err.error;
  return typeof body === 'object'
    && body !== null
    && (body as Record<string, unknown>)['status'] === 404;
}
