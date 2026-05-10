# Backend Dependencies

> **Last verified against codebase:** 2026-03-26

This document lists the backend API contracts that this frontend repo assumes but
**cannot verify independently**. Each entry notes the frontend evidence (files,
endpoints, payload shapes) and what the backend team needs to confirm or expose.

---

## 1. Token Refresh Endpoint

**Status:** Active — wired against SimpleJWT's `TokenRefreshView`.

**Frontend evidence:**
- `LoginResponse` and `OTPResponse` models include a `refresh: string` field
  (`src/app/_models/app.models.ts:25,33`).
- `AuthenticationService.attemptTokenRefresh()` POSTs the refresh token and
  updates the stored access token on success
  (`src/app/_services/authentication.service.ts`).
- `ErrorInterceptor.handle401()` calls `attemptTokenRefresh()` on 401 and retries
  the request with the new token, with single-flight queueing for concurrent 401s
  (`src/app/_helpers/error.interceptor.ts`).

**Backend contract (SimpleJWT native shape — NOT the wrapped `{data: ...}` envelope):**
```
POST /api/{version}/users/auth/token/refresh/
Request:  { "refresh": "<refresh-token-string>" }
Response: { "access": "<new-access-token>" }
```

**Assumption:** `ROTATE_REFRESH_TOKENS = False` on the backend, so the response
contains only `access` and the stored refresh token is reused. If rotation is
later enabled, `attemptTokenRefresh()` must also persist `response.refresh`.

**Loop avoidance:** The refresh request is sent via `HttpBackend` to bypass the
auth and error interceptors. A 401 from the refresh endpoint must not re-enter
`ErrorInterceptor.handle401`, since that would deadlock the single-flight queue.

---

## 2. Authentication Endpoints

**Status:** In use, assumed working.

**Frontend evidence:**
- `AuthenticationService.login()` → `POST /api/{version}/users/auth/login/`
  (`src/app/_services/authentication.service.ts:35-46`)
- `AuthenticationService.setOtp()` → `POST /api/{version}/users/auth/verify-otp/`
  (`src/app/_services/authentication.service.ts:66-73`)
- `AuthenticationService.resendOtp()` → `POST /api/{version}/users/auth/resend-otp/`
  (`src/app/_services/authentication.service.ts:76-85`)

**Expected response shape for login:**
```typescript
{
  "message": string,
  "status": number,
  "data": {
    "token": string,        // JWT access token
    "refresh": string,      // JWT refresh token
    "profile": {
      "id": string,
      "first_name": string,
      "last_name": string,
      "email": string,
      "roles": string[],              // e.g. ["dinify_admin"]
      "other_names": any,
      "phone_number": string,
      "restaurant_roles": RestaurantRole[]
    },
    "require_otp": boolean,
    "prompt_password_change": boolean
  }
}
```

**Action needed:** Backend team confirms this response shape is stable. In
particular, confirm:
- `profile.roles` is always a `string[]` (not a single string).
- `profile.restaurant_roles` is always an array, even when empty.

---

## 3. Role / Permission Payload

**Status:** In use, assumed working.

**Frontend evidence:**
- `AuthGuard` checks `user.profile.roles` (top-level roles like `"dinify_admin"`)
  and `user.profile.restaurant_roles` (array of `RestaurantRole` objects)
  (`src/app/_helpers/auth.guard.ts:17-29`).
- Login component routes users based on these roles
  (`src/app/auth/login/login.component.ts`).
- Routes use `data: { roles: ['restaurant_staff'] }` and
  `data: { roles: ['dinify_admin'] }`.

**Expected `RestaurantRole` shape:**
```typescript
{
  "restaurant_id": string,
  "restaurant": string,   // restaurant name
  "roles": string[]       // e.g. ["manager", "cashier"]
}
```

**Action needed:** Confirm:
- A user with `restaurant_roles.length > 0` should be allowed to access
  `restaurant_staff`-gated routes even if `"restaurant_staff"` is not in
  `profile.roles`.
- The set of valid values for `profile.roles` (currently the frontend only checks
  for `"dinify_admin"` and `"restaurant_staff"`).

---

## 4. Password Reset Flow (Multi-Step)

**Status:** Updated to match new backend contract.

**Frontend evidence:**
- Step 1: `POST /api/{version}/users/auth/initiate-reset-password/`
  (`src/app/auth/forgot-password/forgot-password.component.ts`)
  Request: `{ identifier, identification }`
- Step 2: OTP entry (frontend-only UI)
- Step 3: `POST /api/{version}/users/auth/reset-password/`
  (`src/app/auth/forgot-password/forgot-password.component.ts`)
  Request: `{ identifier, otp }`
- Step 4: `POST /api/{version}/users/auth/change-password/`
  (`src/app/_services/api.service.ts`)
  Request: `{ username, old_password, new_password, confirmPassword }`
  With `Authorization: Bearer <reset-token>` header

**Expected `reset-password` response:**
```json
{
  "data": {
    "token": "temporary-auth-token",
    "temp_password": "system-generated-temporary-password"
  }
}
```

**Action needed:**
- Confirm `initiate-reset-password` endpoint URL and request shape
- Confirm `reset-password` returns `{ data: { token, temp_password } }`
- Confirm `change-password` accepts the temporary token as Bearer auth
- Confirm field names: `confirmPassword` vs `confirm_password` (snake_case)

---

## 5. Diner Journey / Table Scan

**Status:** In use, assumed working.

**Frontend evidence:**
- Table scan: `GET /api/{version}/orders/journey/table-scan/?table={tableId}`
  (`src/app/diner-app/home/home.component.ts:36`,
   `src/app/diner-app/diner-app.component.ts:56`)
- Show menu: `GET /api/{version}/orders/journey/show-menu/?restaurant={restaurantId}`
  (`src/app/diner-app/menu/menu.component.ts:128`)
- Initiate order: `POST /api/v2/orders/initiate/`
  (`src/app/diner-app/basket/basket.component.ts:122`)
- Submit order: `PUT /api/{version}/orders/submit/`
  (`src/app/diner-app/basket/basket.component.ts:166`)
- Order details: `GET /api/{version}/orders/journey/order-details/?order={orderId}`
  (`src/app/diner-app/orders/orders.component.ts:34`)
- Payment details: `GET /api/{version}/orders/journey/payment-details/?transaction={id}`
  (`src/app/diner-app/payment-details/payment-details.component.ts:29`)

**Expected `TableScan` response:**
```typescript
{
  "id": string,
  "number": number,
  "room_name": any,
  "prepayment_required": boolean,
  "available": boolean,
  "current_order": { "ongoing": boolean, "order_id": any },
  "restaurant": {
    "id": string,
    "name": string,
    "logo": string,
    "cover_photo": any,
    "menu_approval_status": any,
    "branding_configuration": { ... }
  }
}
```

**Action needed:** Confirm the table scan and order initiation endpoints exist and
return the shapes described above. Note that order initiation uses API version `v2`
while other endpoints use `v1`.

---

## 6. Payment / Finance Endpoints

**Status:** In use, assumed working.

**Frontend evidence:**
- Initiate payment: `POST /api/{version}/finances/initiate-order-payment/`
  (`src/app/diner-app/orders/orders.component.ts:86,101,115`)
- MSISDN lookup: `GET /api/{version}/users/msisdn-lookup/?msisdn={number}`
  (`src/app/diner-app/orders/orders.component.ts:95`)
- Transaction listing:
  `GET /api/{version}/reports/restaurant/transactions-listing/?restaurant={id}&from={date}&to={date}`
  (`src/app/restaurant-mgt/payments/payments.component.ts:77`)

**Action needed:** Confirm these endpoints exist and document their expected
request/response shapes. The frontend currently treats responses generically
(`any` types), so there is no strict contract to validate against.

---

## 7. Restaurant Setup / Management

**Status:** In use, assumed working.

**Frontend evidence:**
- Restaurant details: `GET /api/{version}/restaurant-setup/details/?id={id}&record=restaurants`
  (multiple components)
- Restaurant list: `GET /api/{version}/restaurant-setup/restaurants/`
  (multiple components)

**Action needed:** No immediate action unless API changes are planned. The
`RestaurantDetail` interface in `app.models.ts:167-199` documents the expected
shape.

---

## 8. httpOnly Cookie-Based Token Storage

**Status:** Not implemented. Would require backend changes.

**Current state:** JWT tokens are stored in `localStorage`, which is accessible to
any JavaScript on the page. Moving to `httpOnly` cookies would require:
- Backend sets `httpOnly`, `Secure`, `SameSite=Strict` cookies on login response.
- Backend reads tokens from cookies instead of `Authorization` header.
- Frontend removes `localStorage` token storage and `AuthInterceptor` header
  injection.

**Action needed:** This is a coordinated frontend + backend change. Not required
for current stabilization but recommended before production launch.

---

## Summary

| Dependency | Status | Blocking? |
|------------|--------|-----------|
| Token refresh endpoint | Active (SimpleJWT TokenRefreshView) | No |
| Login response shape | In use, needs confirmation | No — working in practice |
| Role payload shape | In use, needs confirmation | No — working in practice |
| Password change fields | In use, needs confirmation | No — working in practice |
| Diner journey endpoints | In use, assumed working | No |
| Payment endpoints | In use, assumed working | No |
| httpOnly cookies | Not started | No — enhancement |
