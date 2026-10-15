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
 *
 * THE LOOKUP ALSO REFUSES, AND SAYS WHY. A 400 with the endpoint's own
 * `{status: 400, message}` envelope means it would not look the contact up: no
 * contact was sent, or (since the backend canonicalises it) the value is not a
 * valid Ugandan number. `ErrorInterceptor` forwards that answer too, and each
 * caller shows its message. The staff form used to replace it with "Could not
 * look up that number. Please try again.", which is wrong for a number that
 * will never be valid. The same envelope rule applies: a 400 without it is not
 * the lookup explaining itself.
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

/**
 * The lookup's own refusal (see the file header): its message when the error is
 * an HTTP 400 carrying the endpoint's `{status: 400, message}` envelope with a
 * message to show, otherwise `null`.
 */
export function lookupRefusalMessage(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse) || err.status !== 400) return null;
  const body: unknown = err.error;
  if (typeof body !== 'object' || body === null) return null;
  const { status, message } = body as Record<string, unknown>;
  return status === 400 && typeof message === 'string' && message.trim() !== ''
    ? message
    : null;
}
