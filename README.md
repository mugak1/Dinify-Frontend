# Dinify Frontend

A comprehensive restaurant management and customer dining application built with Angular 20 and Tailwind CSS. This project includes three main sub-applications: Restaurant Management, Dinify Management (Admin), and Diner App (Customer).

**Status**: Active development — stabilisation and feature work in progress.
**Angular**: ^20.3.18
**Angular CLI**: ~20.3.21
**Node**: v20.x (used in CI)

---

## Table of Contents

- [Project Overview](#project-overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Available Commands](#available-commands)
- [Development](#development)
- [Building](#building)
- [Environments](#environments)
- [Deployment](#deployment)
- [CI / Automated Workflows](#ci--automated-workflows)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Key Technologies](#key-technologies)

---

## Project Overview

Dinify is a multi-tenant restaurant management platform with three distinct applications:

1. **Restaurant Management App** (`/rest-app`) - For restaurant staff and owners to manage menus, orders, and operations
2. **Dinify Management App** (`/mgt-app`) - For platform administrators to manage restaurants, payments, and reports
3. **Diner App** (`/diner`) - For customers to scan QR codes, view menus, place orders, and pay

### Key Features
- Multi-tenant role-based access control
- JWT authentication with OTP verification
- Real-time order management
- Menu management with item variants
- Payment processing integration
- Analytics and reporting dashboard
- QR code generation for restaurant tables
- Responsive design optimized for all devices

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: v20.x (matches CI)
- **npm**: v9.x or higher (comes with Node.js)
- **Angular CLI**: ~20.3.21 (installed as a dev dependency via npm)
- **Firebase CLI**: For deployment (included as a dev dependency)
- **Git**: For version control

Verify installation:
```bash
node --version
npm --version
```

---

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dinify_frontend
   ```

2. **Install dependencies**
   ```bash
   npm ci --legacy-peer-deps
   ```

   > **Note:** `--legacy-peer-deps` is currently required due to peer-dependency conflicts between several packages. This is a known item for future cleanup.

3. **Verify installation**
   ```bash
   npm run ng -- version
   ```

---

## Available Commands

All commands are defined in `package.json`:

| Command | Description |
|---------|-------------|
| `npm start` | Start development server (`ng serve`) |
| `npm run watch` | Build in watch mode (`ng build --watch --configuration development`) |
| `npm run build` | Default build (`ng build`) |
| `npm run build:prod` | Production build (`ng build --configuration=production`) |
| `npm run build:uat` | UAT build (`ng build --configuration=uat`) |
| `npm run build:staging` | Staging build (`ng build --configuration=staging`) |
| `npm test` | Run unit tests via Karma (`ng test`) |
| `npm run test:ci` | Run tests headless, no watch (`ng test --watch=false --browsers=ChromeHeadlessNoSandbox`) |
| `npm run lint` | Lint the project (`ng lint`) |
| `npm run type-check` | TypeScript type-check without emit (`tsc --noEmit -p tsconfig.app.json`) |

---

## Development

### Starting the Development Server

```bash
npm start
```

The application will be available at `http://localhost:4200/`.

### Watch Mode

For development with automatic rebuilds (without the dev server):

```bash
npm run watch
```

---

## Building

### Production Build

```bash
npm run build:prod
```

The optimized build artifacts will be stored in the `dist/` directory.

### Build for Specific Environment

```bash
npm run build:prod       # production
npm run build:uat        # UAT
npm run build:staging    # staging
```

---

## Environments

The application supports multiple environments. Environment files are located in `src/environments/`.

| File | Purpose | API URL |
|------|---------|---------|
| `environment.ts` | Default (development) | `https://api-dev.dinifyapp.com` |
| `environment.dev.ts` | Development | `https://api-dev.dinifyapp.com` |
| `environment.uat.ts` | User Acceptance Testing | `https://api-test.dinifyapp.com/uat` |
| `environment.staging.ts` | Staging | `https://api-test.dinifyapp.com/staging` |
| `environment.prod.ts` | Production | `https://api.dinifyapp.com` |

Each environment file exports:

```typescript
export const environment = {
    production: boolean,
    apiUrl: string,
    version: string,    // e.g. 'v1'
    version2: string    // e.g. 'v2'
};
```

---

## Deployment

The application is deployed using Firebase Hosting. Configuration lives in `firebase.json` and `.firebaserc`.

### Firebase Projects and Hosting Sites

All configured hosting targets belong to the **`dinify-dev`** Firebase project.

| Site | Defined in | Notes |
|------|-----------|-------|
| `dinify-dev` | `firebase.json` | Development site |
| `dinify-stage` | `firebase.json` | Staging site |
| `dinify-uat` | `firebase.json` + `.firebaserc` target mapping | UAT site; also mapped as a deploy target in `.firebaserc` |

> **Note:** There is no `dinify-prod` hosting site configured in `firebase.json` or `.firebaserc`. Production deployment configuration does not currently exist in this repository.

### Manual Deployment

```bash
# Build for the target environment
npm run build:uat

# Deploy to a specific site
firebase deploy --only hosting:dinify-uat
firebase deploy --only hosting:dinify-dev
firebase deploy --only hosting:dinify-stage
```

### Automated UAT Deployment

The `deploy-uat.yml` workflow automatically deploys to the `dinify-uat` Firebase hosting target on every push to `main` (or via manual `workflow_dispatch`). See [CI / Automated Workflows](#ci--automated-workflows) below.

---

## CI / Automated Workflows

Two GitHub Actions workflows exist in `.github/workflows/`:

### 1. `ci.yml` — PR Validation

**Trigger:** Pull requests targeting `main`.

Steps (on `ubuntu-latest`, Node 20):

1. `npm ci --legacy-peer-deps` — install dependencies
2. `npm run type-check` — TypeScript type-checking
3. `npm run lint` — ESLint
4. `npm run test:ci` — unit tests (runs only the following spec files):
   - `src/app/_helpers/auth.guard.spec.ts`
   - `src/app/_helpers/error.interceptor.spec.ts`
   - `src/app/_services/authentication.service.spec.ts`
   - `src/app/_services/api.service.spec.ts`
5. `npm run build:prod` — production build

> **Note on test coverage:** The CI pipeline runs only 4 spec files. The repository contains ~40 spec files total, but most are not included in the CI test run. Test coverage should not be considered comprehensive.

### 2. `deploy-uat.yml` — UAT Deployment

**Trigger:** Push to `main`, or manual `workflow_dispatch`.

Steps (on `ubuntu-latest`, Node 20):

1. `npm ci --legacy-peer-deps` — install dependencies
2. `npm run type-check` — TypeScript type-checking
3. `npm run lint` — ESLint
4. `npx ng build --configuration=uat` — UAT build
5. Deploy to Firebase Hosting (`dinify-uat` target on `dinify-dev` project) via `FirebaseExtended/action-hosting-deploy@v0`

---

## Testing

### Unit Tests

Run unit tests locally using Karma:

```bash
# Run tests in watch mode
npm test

# Run tests once (headless, CI-style)
npm run test:ci

# Run tests with code coverage
npm test -- --code-coverage

# Run a specific spec file
npm test -- --include='**/my-component.spec.ts'
```

### Test Configuration

- **Test Runner**: Karma ~6.4.0
- **Test Framework**: Jasmine ~4.5.0
- **Browser**: Chrome (ChromeHeadlessNoSandbox in CI)
- **Coverage**: Istanbul via karma-coverage

### Existing Spec Files

The repository contains ~40 spec files across the codebase. See the full list with:

```bash
find src -name '*.spec.ts'
```

---

## Project Structure

```
dinify_frontend/
├── src/
│   ├── index.html
│   ├── main.ts
│   ├── styles.css
│   ├── app/
│   │   ├── app.module.ts
│   │   ├── app-routing.module.ts
│   │   ├── app.component.*
│   │   ├── _common/              # Shared components and services
│   │   ├── _helpers/             # Guards and interceptors
│   │   ├── _models/              # Interfaces and data models
│   │   ├── _services/            # Core services
│   │   ├── auth/                 # Authentication module
│   │   ├── diner-app/            # Customer app module
│   │   ├── restaurant-mgt/       # Restaurant staff app module
│   │   └── dinify-mgt/           # Admin app module
│   ├── assets/
│   └── environments/
├── .github/workflows/            # CI and deployment automation
├── angular.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.spec.json
├── tailwind.config.js
├── package.json
├── firebase.json
├── .firebaserc
└── README.md
```

---

## Architecture

### Module Structure

The application uses lazy-loaded modules for each sub-application:

```typescript
const routes: Routes = [
  { path: '', redirectTo: '/auth/login', pathMatch: 'full' },
  { path: 'auth', loadChildren: () => import('./auth/auth.module') },
  { path: 'rest-app', canActivate: [AuthGuard], loadChildren: () => import('./restaurant-mgt/restaurant-mgt.module') },
  { path: 'mgt-app', canActivate: [AuthGuard], loadChildren: () => import('./dinify-mgt/dinify-mgt.module') },
  { path: 'diner', loadChildren: () => import('./diner-app/diner-app.module') }
];
```

### Service Layer

- **ApiService**: Centralized HTTP client with environment-based URLs
- **AuthenticationService**: JWT token management and role-based routing
- **AuthGuard**: Route protection for authenticated routes
- **AuthInterceptor**: Automatic Bearer token injection
- **ErrorInterceptor**: Centralized error handling

### Authentication Flow

1. User logs in via `/auth/login`
2. OTP verification (if enabled)
3. Token stored in localStorage
4. AuthGuard checks token validity on route navigation
5. AuthInterceptor adds Bearer token to API requests
6. Role-based routing: admins → `/mgt-app`, staff → `/rest-app`

---

## Key Technologies

### Frontend Framework
- **Angular**: ^20.3.18
- **TypeScript**: ~5.8.3
- **RxJS**: ~7.5.0

### UI & Styling
- **Tailwind CSS**: ^3.4.1
- **ApexCharts**: ^5.3.2 (via ng-apexcharts ^2.0.4)
- **Chart.js**: ^4.4.9 (via ng2-charts ^9.0.0)

### Component Libraries
- **Angular CDK**: ^20.2.14
- **ngx-currency**: ^19.0.0 (currency input formatting)
- **angularx-qrcode**: ^20.0.0 (QR code generation)
- **ngx-intl-telephone-input**: ^1.0.1 (phone number input)
- **ngx-color-picker**: ^20.0.0 (color selection)
- **@ryware/ngx-drag-and-drop-lists**: ^3.0.0 (drag-and-drop)

### Utilities
- **date-fns**: ^4.1.0 (date/time handling)
- **lz-string**: ^1.5.0 (string compression)
- **awesome-phonenumber**: ^3.3.0 (phone validation)
- **Firebase Tools**: ^14.1.0 (hosting and deployment, dev dependency)

### Testing
- **Karma**: ~6.4.0
- **Jasmine**: ~4.5.0
- **@types/jasmine**: ~4.3.0

---

## License

All rights reserved.
