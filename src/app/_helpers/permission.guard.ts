import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthenticationService } from '../_services/authentication.service';
import { ModuleKey } from '../_models/app.models';

/**
 * Per-module UX guard. Reads route.data['module']; allows when the membership
 * can access that module, otherwise REDIRECTS to its first accessible route as
 * a UrlTree.
 *
 * It returns a UrlTree, NEVER router.navigate(['/']) — that is the AuthGuard
 * deny-to-login behaviour this guard deliberately does NOT replicate. The
 * redirect target comes from the same canAccess logic, so it is itself an
 * accessible route and cannot bounce into another denied guard (no loop).
 *
 * This is UX hygiene, not the security boundary: the backend enforces module
 * access server-side on every gate. The guard coexists with the class-based
 * AuthGuard on the same route chain — it does NOT extend or replace it.
 */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthenticationService);
  const router = inject(Router);

  const key = route.data['module'] as ModuleKey | undefined;
  if (!key || auth.canAccess(key)) {
    return true;
  }
  return router.parseUrl(auth.firstAccessibleRoute());
};
