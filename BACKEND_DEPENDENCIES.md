# Backend Dependencies

This document lists the backend API contracts that this frontend repo assumes but
**cannot verify independently**. Each entry notes the frontend evidence (files,
endpoints, payload shapes) and what the backend team needs to confirm or expose.

---

## 1. Token Refresh Endpoint

**Status:** Blocked — frontend infrastructure is wired but disabled.

**Frontend evidence:**
- `LoginResponse` and `OTPResponse` models include a `refresh: string` field
  (`src/app/_models/app.models.ts:25,33`).
- `AuthenticationService.attemptTokenRefresh()` is stubbed, returning `of(null)`
  (`src/app/_services/authentication.service.ts:106-131`).
- `ErrorInterceptor.handle401()` calls `attemptTokenRefresh()` on 401 and retries
  the request if a new token is returned
  (`src/app/_helpers/error.interceptor.ts:65-95`).

**Expected backend contract:**
```
POST /api/{version}/users/auth/token/refresh/
Request:  { "refresh": "<refresh-token-string>" }
Response: {
  "data": {
    "token": "<new-access-token>",
    "refresh": "<new-refresh-token>"
  }
}
```

**Action needed:** Backend team confirms endpoint URL, request/response shape, and
HTTP status codes (200 on success, 401 if refresh token is expired/invalid).

**To activate:** Uncomment the HTTP call in
`AuthenticationService.attemptTokenRefresh()` and remove the `of(null)` fallback.

---

## 2. Authentication Endpoints

**Status:** In use, assumed working.

**Frontend evidence:**
- `AuthenticationService.login()` → `POST /api/{version}/users/auth/login/`
  (`src/app/_services/authentication.service.ts:35-42`)
- `AuthenticationService.setOtp()` → `POST /api/{version}/users/auth/verify-otp/`
  (`src/app/_services/authentication.service.ts:59-66`)
- `AuthenticationService.resendOtp()` → `POST /api/{version}/users/auth/resend-otp/`
  (`src/app/_services/authentication.service.ts:69-77`)

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

## 4. Password Change Endpoint

**Status:** In use via the lock-screen flow.

**Frontend evidence:**
- `ApiService.UserChangePasswordOnLogin()` →
  `POST /api/{version}/users/auth/change-password/`
  (`src/app/_services/api.service.ts:66-78`).
- Called from `LockScreenComponent.Send()`
  (`src/app/auth/lock-screen/lock-screen.component.ts:60-73`).

**Expected request:**
```json
{
  "username": "string",
  "old_password": "string",
  "new_password": "string",
  "confirmPassword": "string"
}
```

**Action needed:** Confirm the field names match what the backend expects.
Particularly whether the backend expects `confirmPassword` or
`confirm_password` (snake_case).

---

## 5. Diner Journey / Table Scan

**Status:** In use, assumed working.

**Frontend evidence:**
- Table scan: `GET /api/{version}/orders/journey/table-scan/?table={tableId}`
  (`src/app/diner-app/home/home.component.ts:35`,
   `src/app/diner-app/diner-app.component.ts:55`)
- Show menu: `GET /api/{version}/orders/journey/show-menu/?restaurant={restaurantId}`
  (`src/app/diner-app/menu/menu.component.ts:127`)
- Initiate order: `POST /api/v2/orders/initiate/`
  (`src/app/diner-app/basket/basket.component.ts:121`)
- Submit order: `PUT /api/{version}/orders/submit/`
  (`src/app/diner-app/basket/basket.component.ts:165`)
- Order details: `GET /api/{version}/orders/journey/order-details/?order={orderId}`
  (`src/app/diner-app/orders/orders.component.ts:33`)
- Payment details: `GET /api/{version}/orders/journey/payment-details/?transaction={id}`
  (`src/app/diner-app/payment-details/payment-details.component.ts:28`)

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
  (`src/app/diner-app/orders/orders.component.ts:85,100,114`)
- MSISDN lookup: `GET /api/{version}/users/msisdn-lookup/?msisdn={number}`
  (`src/app/diner-app/orders/orders.component.ts:94`)
- Transaction listing:
  `GET /api/{version}/reports/restaurant/transactions-listing/?restaurant={id}&from={date}&to={date}`
  (`src/app/restaurant-mgt/payments/payments.component.ts:76`)

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
| Token refresh endpoint | Stubbed, needs confirmation | Yes — for silent refresh |
| Login response shape | In use, needs confirmation | No — working in practice |
| Role payload shape | In use, needs confirmation | No — working in practice |
| Password change fields | In use, needs confirmation | No — working in practice |
| Diner journey endpoints | In use, assumed working | No |
| Payment endpoints | In use, assumed working | No |
| httpOnly cookies | Not started | No — enhancement |
