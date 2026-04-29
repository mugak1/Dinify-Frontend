# Dinify Frontend — Security & Code Quality Audit Report

**Date:** 2026-03-14
**Scope:** Full codebase audit of `dinify_frontend_handover` repository
**Application:** Angular 17 frontend with three sub-applications
**Auditor:** Automated code audit

---

## 1. EXECUTIVE SUMMARY

### Total Findings by Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| HIGH     | 8     |
| MEDIUM   | 12    |
| LOW      | 9     |
| **Total**| **32**|

### Top 5 Most Urgent Issues

1. **Password exposed in URL via base64 encoding** — The login component encodes the user's plaintext password with `btoa()` and passes it as a URL route parameter (`/lock-otp-exp/:username/:otp/:fullname`). Base64 is trivially reversible. The password is visible in browser history, server logs, and analytics tools.

2. **RBAC route guard is completely disabled** — The `AuthGuard.canActivate()` method has role-checking code commented out (lines 17-21 of `auth.guard.ts`). Any authenticated user can access any route regardless of their role — restaurant staff can access the Dinify admin panel and vice versa.

3. **SafePipe bypasses all Angular sanitisation** — The `SafePipe` in `common.pipe.ts` provides `bypassSecurityTrustScript()` and `bypassSecurityTrustResourceUrl()` methods. If any user-controlled content flows through this pipe with type `'script'` or `'resourceUrl'`, it enables XSS.

4. **JWT tokens stored in localStorage** — Authentication tokens and user profile data are stored in `localStorage`, which is accessible to any JavaScript running on the page (including XSS payloads). Combined with the SafePipe issue, this creates a high-risk chain.

5. ~~**No token refresh mechanism**~~ — Resolved: `ErrorInterceptor` performs reactive 401 → refresh → retry against SimpleJWT's `TokenRefreshView`, with single-flight queueing.

### Overall Assessment

**This codebase requires remediation before production launch.** While no intentional backdoors or data exfiltration were found, there are critical security vulnerabilities (password in URL, disabled RBAC, XSS-enabling pipe), significant code quality issues (180+ console.log statements, hardcoded test data, massive commented-out code blocks), and architectural problems (no token refresh, localStorage for secrets, 188 subscriptions with inconsistent cleanup). The codebase is safe to continue building on only after the CRITICAL and HIGH findings are addressed.

---

## 2. FINDINGS TABLE

| ID | Severity | Section | File Path | Line(s) | Description | Recommended Fix |
|----|----------|---------|-----------|---------|-------------|-----------------|
| F01 | CRITICAL | 4 | `src/app/auth/login/login.component.ts` | 94 | Password base64-encoded and placed in URL route parameter | Pass data via a service or encrypted state, never in URL |
| F02 | CRITICAL | 4 | `src/app/_helpers/auth.guard.ts` | 17-21 | RBAC role-checking code is entirely commented out | Uncomment and implement role validation |
| F03 | CRITICAL | 6 | `src/app/_common/common.pipe.ts` | 23-38 | SafePipe bypasses all Angular DOM sanitisation including scripts | Remove `'script'` and `'resourceUrl'` cases; restrict to `'html'` and `'style'` only with input validation |
| F04 | HIGH | 4 | `src/app/_services/authentication.service.ts` | 19, 38, 46, 53 | JWT tokens and user data stored in `localStorage` | Use `httpOnly` secure cookies or in-memory storage with a refresh mechanism |
| F05 | HIGH | 4 | `src/app/_services/authentication.service.ts` | All | No token expiry check or refresh flow | Implement JWT expiry detection and automatic refresh using the `refresh` token |
| F06 | HIGH | 4 | `src/app/app-routing.module.ts` | 22 | Lock screen route exposes username, base64 password, and full name in URL | Redesign password change flow to use service-based state transfer |
| F07 | HIGH | 4 | `src/app/auth/lock-screen/lock-screen.component.ts` | 37 | `atob()` decodes password from URL parameter | Remove — see F06 |
| F08 | HIGH | 7 | `src/app/_services/api.service.ts` | 31 | `console.log('Payload sending:', payload)` logs all API payloads to browser console | Remove — leaks PII and sensitive data to anyone with DevTools open |
| F09 | HIGH | 5 | `src/app/diner-app/diner-app.component.ts` | 58 | Table scan API call passes table ID as query string instead of path parameter | Use path parameters or POST body for identifiers |
| F10 | HIGH | 6 | `src/app/restaurant-mgt/orders/orders.component.ts` | 443-482 | `document.write()` used for receipt printing — injects HTML from DOM into popup | Use Angular renderer or a print-specific component; sanitise content before injection |
| F11 | HIGH | 4 | `src/app/auth/login/login.component.ts` | 189 | `alert(error)` in OTP error handler exposes raw error to user | Use the MessageService for user-facing errors; log details only to a logging service |
| F12 | MEDIUM | 7 | 43 files | Various | 181 `console.log/warn/error` statements throughout codebase | Remove all console statements or replace with a configurable logging service |
| F13 | MEDIUM | 7 | 6 files | Various | 17 active `alert()` calls used for error display | Replace with Angular-based notification/toast system |
| F14 | MEDIUM | 6 | `src/app/_common/common-notifications/common-notifications.component.html` | 36 | `[innerHTML]` binding with SafePipe for notification content from API | Validate and sanitise notification content server-side; use `'html'` type only with strict allowlisting |
| F15 | MEDIUM | 1 | `src/app/restaurant-mgt/` | N/A | `restaurant-mgt.component copy.ts/html/css` — duplicate files with " copy" suffix | Delete the copy files; they are unused duplicates |
| F16 | MEDIUM | 1 | `src/app/sample/` | N/A | Empty sample component included in restaurant module routing | Remove from production routing and module declarations |
| F17 | MEDIUM | 7 | `src/app/restaurant-mgt/tables/tables.component.ts` | 166, 371, 383, 394 | Hardcoded test UUIDs in production code | Remove hardcoded UUIDs; load test data only in development mode |
| F18 | MEDIUM | 7 | `src/app/diner-app/diner-app.component.ts` | 16-17 | Hardcoded `restaurant_name='Java House'` and `restaurant_id='523445-89ooo'` | Remove hardcoded defaults; handle null state gracefully |
| F19 | MEDIUM | 10 | Multiple components | Various | 188 `.subscribe()` calls across 38 files with only 4 `ngOnDestroy` implementations | Implement `takeUntilDestroyed()` or manual cleanup in all components with subscriptions |
| F20 | MEDIUM | 8 | `angular.json` | 79-93 | `dev`, `uat`, and `staging` build configs lack `optimization`, `sourceMap`, and `aot` settings — inheriting defaults | Explicitly set `optimization: true`, `sourceMap: false`, `aot: true` for `uat` and `staging` |
| F21 | MEDIUM | 2 | `package.json` | 28 | `firebase-tools` (CLI tool) listed as production dependency | Move to `devDependencies` |
| F22 | MEDIUM | 7 | `src/app/restaurant-mgt/dashboard/dashboard.component.ts` | 45-130, 165-513 | ~500 lines of hardcoded mock data and commented-out code | Extract mock data to dev-only fixtures; remove commented code |
| F23 | MEDIUM | 3 | `.gitignore` | All | Environment files are NOT listed in `.gitignore` — all 5 environment files are committed to version control | Add `src/environments/environment.*.ts` to `.gitignore`; use CI/CD env injection instead |
| F24 | LOW | 1 | Root | N/A | `re.drawio` — empty diagram file at project root | Delete if unused |
| F25 | LOW | 2 | `package.json` | 23 | `angularx-qrcode: ^15.0.0` — version 15 is for Angular 15, not Angular 17 | Upgrade to v17-compatible version |
| F26 | LOW | 2 | `package.json` | 25 | `awesome-phonenumber: ^3.3.0` — v3 is deprecated; v6+ is current | Upgrade to latest major version |
| F27 | LOW | 2 | `package.json` | 29 | `moment: ^2.30.1` — deprecated library, large bundle size | Replace with `date-fns` or Angular's built-in `DatePipe` |
| F28 | LOW | 10 | `src/app/diner-app/diner-app.module.ts` | 36-55 | Commented-out duplicate `RestaurantMgtModule` class declaration | Remove commented code block |
| F29 | LOW | 10 | `src/app/diner-app/scroll-spy.directive.ts` and `src/app/_common/scroll-spy-common.directive.ts` | All | Two nearly identical scroll-spy directives exist | Consolidate into one shared directive |
| F30 | LOW | 10 | `src/app/_models/app.models.ts` | 99, 224 | Duplicate `MenuItem` interface declaration in same file | Remove duplicate; unify into single interface |
| F31 | LOW | 1 | `.github/copilot-instructions.md` | All | Copilot instructions file committed — reveals internal dev practices | Review for sensitive info; consider removing from production repo |
| F32 | LOW | 9 | `.firebaserc`, `firebase.json` | All | Firebase config references `dinify-dev`, `dinify-stage`, `dinify-uat` projects — no Firebase SDK is used in Angular code | Confirm Firebase is only used for hosting (no security rules needed) |

---

## 3. DETAILED FINDINGS

### F01 — CRITICAL: Password in URL via btoa()

**File:** `src/app/auth/login/login.component.ts:94`
```typescript
this.router.navigate(["lock-otp-exp", this.f['username'].value, btoa(this.f['password'].value), `${this.log_in.profile.first_name} ${this.log_in.profile.last_name}`])
```

When a user is prompted to change their password, the current password is base64-encoded and placed directly in the URL as a route parameter. Base64 is encoding, not encryption — it can be decoded instantly by anyone. This password will appear in:
- Browser address bar and history
- Server access logs (if using a reverse proxy)
- Analytics tools that capture page URLs
- Browser extensions with URL access
- Shared screens or screenshots

The corresponding route definition at `app-routing.module.ts:22` makes the structure explicit:
```typescript
{ path: "lock-otp-exp/:username/:otp/:fullname", component: LockScreenComponent }
```

**Recommended Fix:** Use a service-based state transfer (e.g., store the required data in a service or use Angular's `state` property in `NavigationExtras`) and navigate to a clean URL.

---

### F02 — CRITICAL: RBAC Guard Disabled

**File:** `src/app/_helpers/auth.guard.ts:17-21`
```typescript
/*   if (roles && !roles.includes(user.profile.roles)) {
        this.router.navigate(['/']);
        return false;
    } */
```

The role-based access control check in the only `AuthGuard` is completely commented out. The guard only checks whether the user is logged in, not whether they have the appropriate role. The route definitions pass `data:{role:''}` (empty string), further confirming RBAC is not enforced. This means:
- A restaurant staff member can navigate to `/mgt-app` (Dinify admin panel)
- Any authenticated user can access any sub-application
- There is no client-side enforcement of role separation between the three apps

**Recommended Fix:** Uncomment the role check, populate the `data.roles` array on each protected route, and validate against `user.profile.roles` and `user.profile.restaurant_roles`.

---

### F03 — CRITICAL: SafePipe Bypasses All Sanitisation

**File:** `src/app/_common/common.pipe.ts:23-38`

The `SafePipe` provides a universal bypass for Angular's built-in DomSanitizer across ALL security contexts: `html`, `style`, `script`, `url`, and `resourceUrl`. The `'script'` and `'resourceUrl'` bypass types are particularly dangerous — if any user-controlled or API-returned content is piped through `| safe:'script'`, it enables arbitrary JavaScript execution (XSS).

The pipe is currently used in:
- `common-notifications.component.html:36` — `[innerHTML]="(n.email||n.sms)|safe:'html'"` — notification content from API
- `confirm-dialog.component.html:11,55` — `[innerHTML]="data?.message"` — dialog messages

While current usage appears to be `'html'` type only, the availability of `'script'` creates a latent XSS vulnerability.

**Recommended Fix:** Remove the `'script'` and `'resourceUrl'` cases entirely. For `'html'`, add input validation or use Angular's built-in sanitisation with specific allowlisted tags.

---

### F04 — HIGH: JWT Stored in localStorage

**File:** `src/app/_services/authentication.service.ts:19,38`

```typescript
this.userSubject = new BehaviorSubject(JSON.parse(localStorage.getItem('user')!));
localStorage.setItem('user', JSON.stringify((response.data)));
```

JWT tokens (both `token` and `refresh`) and the full user profile (name, email, phone number, roles) are serialised to `localStorage`. This storage is:
- Accessible to any JavaScript on the page (XSS can steal tokens)
- Persistent across browser sessions (tokens never expire client-side)
- Not encrypted

Additional sensitive data in localStorage:
- `rest_role` — current restaurant role object
- `current_resta` — current restaurant details

**Recommended Fix:** Store tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies (requires backend support) or use in-memory storage with a refresh mechanism for session persistence.

---

### F05 — HIGH: No Token Refresh Mechanism — RESOLVED

**Status:** Resolved. `ErrorInterceptor` now performs reactive 401 → refresh →
retry against SimpleJWT's `TokenRefreshView`
(`POST /api/{version}/users/auth/token/refresh/`), with single-flight queueing
for concurrent 401s. Refresh requests bypass interceptors via `HttpBackend` to
prevent recursion. See `BACKEND_DEPENDENCIES.md` §1 for the contract.

Token rotation is intentionally not enabled on the backend
(`ROTATE_REFRESH_TOKENS = False`), so the stored refresh token is reused
across access-token refreshes. Proactive expiry checking on the frontend is
not implemented and is not needed — the interceptor handles expiry reactively.

---

### F06/F07 — HIGH: Password in Route Parameters

**File:** `src/app/app-routing.module.ts:22`, `src/app/auth/lock-screen/lock-screen.component.ts:37`

The route `lock-otp-exp/:username/:otp/:fullname` carries the username, base64-encoded password (misleadingly named `:otp`), and the user's full name. The `LockScreenComponent` decodes it with `atob()`. This is the receiving end of F01.

---

### F08 — HIGH: API Payload Logging

**File:** `src/app/_services/api.service.ts:31`
```typescript
console.log('Payload sending:', payload);
```

Every `POST`, `PUT`, and `GET` payload sent through the central `ApiService` is logged to the browser console. This includes form submissions, user data, order details, payment information, and any other data sent to the API.

---

### F09 — HIGH: Table ID in Query String

**File:** `src/app/diner-app/diner-app.component.ts:58`
```typescript
this.api.get<TableScan>(null,'orders/journey/table-scan/?table='+id)
```

The table identifier is passed as a raw query parameter. While not secret, this pattern allows trivial parameter manipulation. Combined with the lack of diner authentication (the diner routes have no `AuthGuard`), any user can scan any table by guessing/enumerating table IDs.

---

### F10 — HIGH: document.write() for Receipt Printing

**File:** `src/app/restaurant-mgt/orders/orders.component.ts:443-482`

The receipt printing function reads `innerHTML` from the DOM and injects it into a popup window using `document.write()`. If any order data (customer names, item names, remarks) contains HTML/script content, it will be executed in the popup context.

---

### F12 — MEDIUM: 181 Console Statements

Console statements are scattered across 43 files. Notable concentrations:
- `restaurant-mgt/menu/menu.component.ts` — 30+ instances
- `restaurant-mgt/orders/orders.component.ts` — 16 instances
- `restaurant-mgt/tables/tables.component.ts` — 15 instances

These leak internal state, API responses, and debugging data to anyone who opens browser DevTools.

---

### F19 — MEDIUM: Subscription Memory Leaks

There are 188 `.subscribe()` calls across 38 files, but only 4 components implement `ngOnDestroy()`. Most subscriptions are never unsubscribed, leading to memory leaks when components are destroyed and recreated during navigation. Components with the most unmanaged subscriptions:
- `restaurant-mgt/menu/menu.component.ts` — 36 subscriptions
- `restaurant-mgt/tables/tables.component.ts` — 22 subscriptions
- `restaurant-mgt/orders/orders.component.ts` — 16 subscriptions
- `dinify-mgt/restaurants/restaurants.component.ts` — 13 subscriptions

---

### F20 — MEDIUM: Non-Production Build Configs Lack Security Settings

The `uat` and `staging` build configurations in `angular.json` only specify `fileReplacements`. They do not set `optimization`, `sourceMap`, or `aot` — meaning they inherit the `development` defaults (no optimization, source maps enabled, no AOT). If UAT or staging builds are deployed to accessible environments, source maps expose the entire source code.

---

### F23 — MEDIUM: Environment Files Committed to Git

All five environment files are committed to the repository:
- `environment.ts` (default/dev) — `https://api-dev.dinifyapp.com`
- `environment.dev.ts` — `https://api-dev.dinifyapp.com`
- `environment.prod.ts` — `https://api.dinifyapp.com`
- `environment.uat.ts` — `https://api-test.dinifyapp.com/uat`
- `environment.staging.ts` — `https://api-test.dinifyapp.com/staging`

While the current environment files do not contain secrets (only API base URLs), the pattern of committing them means that if secrets are later added (e.g., Firebase config, analytics keys), they will be exposed. The `.gitignore` does not exclude environment files.

**Positive note:** No hardcoded API keys, database credentials, or third-party service tokens were found in any environment file. The files contain only base URLs and version strings.

---

## 4. RECOMMENDED REMEDIATION ORDER

### Fix Immediately (Before Any Further Development)

1. **F01/F06/F07** — Remove password from URL. Redesign the password change flow to pass sensitive data through a service, not route parameters.
2. **F02** — Re-enable RBAC in `AuthGuard`. Define proper roles for each route (`rest-app`, `mgt-app`, `diner`).
3. **F03** — Remove `'script'` and `'resourceUrl'` cases from `SafePipe`.
4. **F08** — Remove `console.log('Payload sending:', payload)` from `ApiService`.

### Fix Before UAT

5. **F04** — Evaluate migration from `localStorage` to secure cookie-based token storage.
6. **F05** — Resolved: silent refresh wired against SimpleJWT `TokenRefreshView`.
7. **F10** — Replace `document.write()` receipt printing with a sanitised approach.
8. **F11/F13** — Replace all `alert()` calls with the existing `MessageService` or a toast component.
9. **F12** — Remove all 181 console statements (or gate behind `environment.production` check).
10. **F14** — Audit all `[innerHTML]` bindings to ensure no user-controlled content reaches them unsanitised.
11. **F17/F18** — Remove hardcoded test UUIDs and placeholder data.
12. **F20** — Add explicit production-like settings to `uat` and `staging` build configs.

### Fix Before Production Launch

13. **F19** — Implement systematic subscription cleanup (use `takeUntilDestroyed()` from Angular 16+ or a `DestroyRef`-based pattern).
14. **F15** — Delete the `restaurant-mgt.component copy.*` duplicate files.
15. **F16** — Remove the empty `sample` component from routing and module declarations.
16. **F21** — Move `firebase-tools` to `devDependencies`.
17. **F22** — Remove 500+ lines of commented-out code from dashboard component.
18. **F23** — Add environment files to `.gitignore` and use CI/CD environment injection.
19. **F25/F26/F27** — Update outdated dependencies (`angularx-qrcode`, `awesome-phonenumber`, consider replacing `moment`).
20. **F28/F29/F30** — Clean up duplicate code (scroll-spy directives, model interfaces, commented module declarations).

---

## APPENDIX A: Repository Structure

```
dinify_frontend_handover/
  .editorconfig
  .firebase/             # Firebase deployment cache
  .firebaserc            # Firebase project config (dinify-dev)
  .github/               # Copilot instructions
  .gitignore
  .vscode/               # VS Code config (extensions, launch, tasks)
  angular.json           # Angular CLI config
  firebase.json          # Firebase Hosting config (3 sites)
  package.json           # Dependencies
  package-lock.json
  re.drawio              # Empty diagram file
  tailwind.config.js     # Tailwind CSS config
  tsconfig*.json         # TypeScript configs (3 files)
  src/
    index.html
    main.ts
    styles.css
    environments/        # 5 environment files (dev, prod, uat, staging, default)
    assets/              # Fonts (Montserrat), images
    app/
      _common/           # Shared components, pipes, directives
      _helpers/          # Auth guard, interceptors, utilities
      _models/           # TypeScript interfaces/models
      _services/         # API, auth, basket, message, storage services
      auth/              # Login, register, forgot-password, change-password, lock-screen
      diner-app/         # Diner-facing app (menu, basket, orders, payments)
      restaurant-mgt/    # Restaurant management portal
      dinify-mgt/        # Platform admin portal
      sample/            # Empty sample component (unused)
```

### Three Sub-Applications Confirmed:
1. **Restaurant Management Portal** — `src/app/restaurant-mgt/` (route: `/rest-app`)
2. **Diner App** — `src/app/diner-app/` (route: `/diner`)
3. **Platform Admin (Dinify Mgt)** — `src/app/dinify-mgt/` (route: `/mgt-app`)

## APPENDIX B: External Domains Referenced

| Domain | Purpose | Risk |
|--------|---------|------|
| `api.dinifyapp.com` | Production API | Expected |
| `api-dev.dinifyapp.com` | Dev API | Expected |
| `api-test.dinifyapp.com` | UAT/Staging API | Expected |
| `fonts.googleapis.com` | Google Fonts (Montserrat, Poppins) | Low — standard CDN |
| `i.pravatar.cc` | Avatar placeholder images in dashboard | Low — test data, should be removed |
| `raw.githubusercontent.com` | Placeholder logo image | Low — test data, should be removed |
| `avatars.githubusercontent.com` | Placeholder avatar | Low — test data, should be removed |
| `flowbite.com` | Design reference links in HTML | Low — informational |
| `tailwindui.com` | Design reference links and placeholder image | Low — should be removed |

**No evidence of data exfiltration, phone-home behaviour, or communication with undisclosed external services was found.**

## APPENDIX C: Dependency Analysis

### Production Dependencies (17 packages)
All dependencies are standard Angular/UI libraries. No suspicious, tracking, or telemetry packages detected.

Notable concerns:
- `firebase-tools` (v14.1.0) — This is a CLI tool, not a library. Should be in `devDependencies`.
- `moment` (v2.30.1) — Deprecated, adds ~300KB to bundle. Replace with lighter alternative.
- `awesome-phonenumber` (v3.3.0) — v3 is deprecated; current is v6+.
- `angularx-qrcode` (v15.0.0) — Built for Angular 15, may have compatibility issues with Angular 17.
- `lz-string` (v1.5.0) — Compression library, used legitimately for storage optimization.

### DevDependencies (11 packages)
All standard Angular development tooling. No issues detected.
