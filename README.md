# Dinify Frontend

A comprehensive restaurant management and customer dining application built with Angular 17 and Tailwind CSS. This project includes three main sub-applications: Restaurant Management, Dinify Management (Admin), and Diner App (Customer).

**Version**: 0.0.0  
**Angular CLI**: 17.3.6  
**Node**: Required (see `package.json`)

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

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher (comes with Node.js)
- **Angular CLI**: v17.3.6 (will be installed via npm)
- **Firebase CLI**: For deployment (optional, included in dependencies)
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
   npm install
   ```

3. **Verify installation**
   ```bash
   npm run ng -- version
   ```

---

## Available Commands

All commands are defined in `package.json` and can be executed via npm:

### Development Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start development server (alias: `ng serve`) |
| `npm run watch` | Build in watch mode with live reloading (`ng build --watch --configuration development`) |
| `npm run build` | Build for production (alias: `ng build`) |
| `npm test` | Run unit tests via Karma (`ng test`) |
| `npm run ng -- <command>` | Execute Angular CLI commands directly |

### Examples

```bash
# Start development server
npm start

# Build production bundle
npm run build

# Run tests with watch mode
npm test

# Generate a new component
npm run ng -- generate component component-name

# Generate a service
npm run ng -- generate service _services/my-service

# Generate a module
npm run ng -- generate module modules/my-module
```

---

## Development

### Starting the Development Server

```bash
npm start
```

The application will be available at `http://localhost:4200/`

**Features:**
- Hot module reloading (automatic reload on file changes)
- Development source maps for easier debugging
- No optimization (faster compilation)
- Unminified scripts and styles

### Code Scaffolding

Generate Angular components and services using the Angular CLI:

```bash
# Generate component
npm run ng -- generate component components/my-component

# Generate service
npm run ng -- generate service _services/my-service

# Generate directive
npm run ng -- generate directive _helpers/my-directive

# Generate pipe
npm run ng -- generate pipe _common/my-pipe

# Generate module
npm run ng -- generate module modules/my-module

# Generate interface/model
npm run ng -- generate interface _models/my-model
```

### Watch Mode

For development with automatic rebuilds:

```bash
npm run watch
```

This continuously watches for changes and rebuilds the project without starting the dev server.

---

## Building

### Production Build

```bash
npm run build
```

The optimized build artifacts will be stored in the `dist/` directory:

**Build Optimizations:**
- Ahead-of-Time (AoT) compilation
- Tree-shaking and minification
- Hash-based output filenames for caching
- License extraction
- Vendor chunk optimization
- Source maps excluded (production security)

**Bundle Size Limits:**
- Initial bundle: Max 500KB warning, 4MB error
- Component styles: Max 2KB warning, 4KB error

### Build for Specific Environment

Build command for different environments (see [Environments](#environments) section):

```bash
npm run ng -- build --configuration=dev
npm run ng -- build --configuration=uat
npm run ng -- build --configuration=staging
npm run ng -- build --configuration=production
```

---

## Environments

The application supports multiple environments with different API endpoints and configurations. Environment files are located in `src/environments/`.

### Environment Files

| File | Purpose | API URL | Use Case |
|------|---------|---------|----------|
| `environment.ts` | Default (development) | `https://api-dev.dinifyapp.com` | Local development fallback |
| `environment.dev.ts` | Development | `https://api-dev.dinifyapp.com` | Developer environment |
| `environment.uat.ts` | User Acceptance Testing | `https://api-test.dinifyapp.com/uat` | Pre-production testing |
| `environment.staging.ts` | Staging | `https://api-test.dinifyapp.com/staging` | Final staging before production |
| `environment.prod.ts` | Production | `https://api.dinifyapp.com` | Live environment |

### Environment Configuration

Each environment file exports the following configuration:

```typescript
export const environment = {
    production: boolean,           // Production flag
    apiUrl: string,               // Backend API base URL
    version: string,              // API version (v1)
    version2: string              // Alternative API version (v2)
};
```

### Example Environment File

```typescript
// src/environments/environment.dev.ts
export const environment = {
    production: false,
    apiUrl: 'https://api-dev.dinifyapp.com',
    version: 'v1',
    version2: 'v2'
};
```

### Using Environment Variables in Code

```typescript
import { environment } from '../environments/environment';

export class ApiService {
  private apiUrl = environment.apiUrl;
  private version = environment.version;

  constructor(private http: HttpClient) {}

  getData() {
    const endpoint = `${this.apiUrl}/${this.version}/endpoint`;
    return this.http.get(endpoint);
  }
}
```

### Modifying Environment Configuration

1. Edit the appropriate environment file in `src/environments/`
2. Update the `apiUrl`, `version`, or other settings
3. Rebuild the application to apply changes

---

## Deployment

The application is deployed using Firebase Hosting. Firebase configuration is in `firebase.json`.

### Deployment Prerequisites

1. **Firebase CLI** installed globally:
   ```bash
   npm install -g firebase-tools
   ```

2. **Firebase project** configured:
   ```bash
   firebase login
   ```

3. **Built dist folder** (see [Building](#building) section)

### Firebase Hosting Sites

The project is configured with multiple Firebase hosting sites:

| Site | Configuration | Purpose |
|------|---------------|---------|
| `dinify-dev` | Dev environment | Development deployment |
| `dinify-stage` | Staging environment | Pre-production deployment |
| `dinify-uat` | UAT environment | User acceptance testing |
| `dinify-prod` | Production environment | Live deployment |

### Deployment Steps

#### 1. Build for the Target Environment

```bash
# For Development
npm run ng -- build --configuration=dev

# For UAT
npm run ng -- build --configuration=uat

# For Staging
npm run ng -- build --configuration=staging

# For Production
npm run ng -- build --configuration=production
```

#### 2. Deploy to Firebase

```bash
# Deploy to all sites
firebase deploy

# Deploy to a specific site
firebase deploy --only hosting:dinify-dev
firebase deploy --only hosting:dinify-stage
firebase deploy --only hosting:dinify-uat
firebase deploy --only hosting:dinify-prod

# Deploy with a message/version
firebase deploy --message "Release v1.0.0"
```

#### 3. Verify Deployment

```bash
# View deployment history
firebase hosting:channel:list

# View current deployment status
firebase projects:list
```

### Full Deployment Workflow Example

```bash
# Step 1: Build for UAT
npm run ng -- build --configuration=uat

# Step 2: Verify build output
ls -la dist/

# Step 3: Deploy to Firebase
firebase deploy --only hosting:dinify-uat

# Step 4: Verify deployment
# Visit https://dinify-uat.web.app
```

### Rollback Deployment

To rollback to a previous deployment:

```bash
# View deployment history
firebase hosting:channel:list

# Rollback to a specific version
firebase hosting:channel:deploy <channel-id>
```

### Environment-Specific Deployment Considerations

- **Development**: Deploy frequently, can include uncommitted code for testing
- **UAT**: Use stable branch, coordinate with QA team before deployment
- **Staging**: Mirror production environment, final testing before production
- **Production**: Merge to main branch, thorough testing, create release tag in Git

---

## Testing

### Unit Tests

Run unit tests using Karma test runner:

```bash
# Run tests once
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with code coverage
npm test -- --code-coverage

# Run tests for a specific component
npm test -- --include='**/my-component.spec.ts'
```

### Test Configuration

- **Test Runner**: Karma v6.4.0
- **Test Framework**: Jasmine v4.5.0
- **Browser**: Chrome
- **Coverage**: Istanbul via karma-coverage

### Test Files

Test files should be placed alongside the component/service with `.spec.ts` extension:

```
src/app/
├── components/
│   ├── my-component.component.ts
│   └── my-component.component.spec.ts
└── _services/
    ├── my-service.service.ts
    └── my-service.service.spec.ts
```

### Example Unit Test

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyComponent } from './my-component.component';

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MyComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
```

---

## Project Structure

```
dinify_frontend/
├── src/
│   ├── index.html                 # Main HTML file
│   ├── main.ts                    # Application entry point
│   ├── styles.css                 # Global styles
│   ├── app/
│   │   ├── app.module.ts          # Root module
│   │   ├── app-routing.module.ts  # Main routing configuration
│   │   ├── app.component.*        # Root component
│   │   ├── _common/               # Shared components and services
│   │   │   ├── dinify-common.module.ts
│   │   │   ├── common.pipe.ts
│   │   │   ├── confirm-dialog.service.ts
│   │   │   ├── auto-complete/
│   │   │   ├── common-chart/
│   │   │   ├── common-image/
│   │   │   ├── common-notifications/
│   │   │   ├── common-user-profile/
│   │   │   ├── confirm-dialog/
│   │   │   ├── currency-input/
│   │   │   ├── date-picker/
│   │   │   ├── menu-common/
│   │   │   └── otp-input/
│   │   ├── _helpers/              # Guards and interceptors
│   │   │   ├── auth.guard.ts
│   │   │   ├── auth.interceptor.ts
│   │   │   ├── error.interceptor.ts
│   │   │   └── utilities.ts
│   │   ├── _models/               # Interfaces and data models
│   │   │   └── app.models.ts
│   │   ├── _services/             # Core services
│   │   │   ├── api.service.ts
│   │   │   ├── authentication.service.ts
│   │   │   ├── basket.service.ts
│   │   │   ├── message.service.ts
│   │   │   └── storage/
│   │   ├── auth/                  # Authentication module
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   ├── change-password/
│   │   │   ├── forgot-password/
│   │   │   └── lock-screen/
│   │   ├── diner-app/             # Customer app module
│   │   │   ├── diner-app.module.ts
│   │   │   ├── diner-app.component.*
│   │   │   ├── home/
│   │   │   ├── menu/
│   │   │   ├── menu-item-detail/
│   │   │   ├── basket/
│   │   │   ├── orders/
│   │   │   ├── payment-details/
│   │   │   ├── order-complete/
│   │   │   └── error-page/
│   │   ├── restaurant-mgt/        # Restaurant staff app module
│   │   │   ├── restaurant-mgt.module.ts
│   │   │   ├── restaurant-mgt.component.*
│   │   │   ├── dashboard/
│   │   │   ├── menu/
│   │   │   ├── menu-diners/
│   │   │   ├── orders/
│   │   │   ├── reports/
│   │   │   ├── payments/
│   │   │   ├── settings/
│   │   │   ├── reviews/
│   │   │   └── rest-notifications/
│   │   └── dinify-mgt/            # Admin app module
│   │       ├── dinify-mgt.module.ts
│   │       ├── dinify-mgt.component.*
│   │       ├── dashboard/
│   │       ├── restaurants/
│   │       ├── payments/
│   │       ├── reports/
│   │       ├── mgt-support/
│   │       └── mgt-notifications/
│   ├── assets/                    # Static assets
│   │   ├── fonts/
│   │   └── images/
│   └── environments/              # Environment configurations
│       ├── environment.ts
│       ├── environment.dev.ts
│       ├── environment.uat.ts
│       ├── environment.staging.ts
│       └── environment.prod.ts
├── dist/                          # Build output (generated)
├── angular.json                   # Angular CLI configuration
├── tsconfig.json                  # TypeScript configuration
├── tsconfig.app.json              # App TypeScript configuration
├── tsconfig.spec.json             # Spec TypeScript configuration
├── tailwind.config.js             # Tailwind CSS configuration
├── package.json                   # Dependencies and scripts
├── firebase.json                  # Firebase hosting configuration
├── README.md                      # This file
└── .gitignore                     # Git ignore rules
```

---

## Architecture

### Module Structure

The application uses lazy-loaded modules for each sub-application:

```typescript
// app-routing.module.ts
const routes: Routes = [
  { path: '', redirectTo: '/auth/login', pathMatch: 'full' },
  { path: 'auth', loadChildren: () => import('./auth/auth.module').then(m => m.AuthModule) },
  { path: 'rest-app', canActivate: [AuthGuard], loadChildren: () => import('./restaurant-mgt/restaurant-mgt.module').then(m => m.RestaurantMgtModule) },
  { path: 'mgt-app', canActivate: [AuthGuard], loadChildren: () => import('./dinify-mgt/dinify-mgt.module').then(m => m.DinifyMgtModule) },
  { path: 'diner', loadChildren: () => import('./diner-app/diner-app.module').then(m => m.DinerAppModule) }
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
- **Angular**: v17.3.6
- **TypeScript**: Latest stable
- **RxJS**: v7.5.0 (Reactive programming)

### UI & Styling
- **Tailwind CSS**: v3.x (Utility-first CSS framework)
- **ApexCharts**: v3.48.0 (Data visualization)
- **Chart.js**: v4.4.9 (Alternative charting library)

### Component Libraries
- **Angular CDK**: v17.3.6 (Component Development Kit)
- **ngx-currency**: v18.0.0 (Currency input formatting)
- **angularx-qrcode**: v15.0.0 (QR code generation)
- **ngx-intl-telephone-input**: v1.0.1 (Phone number input)
- **ngx-color-picker**: v14.0.0 (Color selection)

### Utilities
- **Firebase Tools**: v14.1.0 (Hosting and deployment)
- **Moment.js**: v2.30.1 (Date/time handling)
- **LZ String**: v1.5.0 (String compression)
- **Awesome PhoneNumber**: v3.3.0 (Phone validation)

### Testing
- **Karma**: v6.4.0 (Test runner)
- **Jasmine**: v4.5.0 (Testing framework)
- **@types/jasmine**: v4.3.0 (TypeScript definitions)

---

## Common Development Tasks

### Add a New Component to Restaurant App

```bash
npm run ng -- generate component restaurant-mgt/components/my-component
```

### Add a Shared Service

```bash
npm run ng -- generate service _services/my-shared-service
```

### Modify Environment API URL

Edit the environment file:
```typescript
// src/environments/environment.dev.ts
export const environment = {
    production: false,
    apiUrl: 'https://new-api-url.com',
    version: 'v1',
    version2: 'v2'
};
```

### Debug Authentication Issues

Check authentication-related files:
- `_helpers/auth.guard.ts` - Route protection
- `_helpers/auth.interceptor.ts` - Token injection
- `_services/authentication.service.ts` - Auth logic
- Browser localStorage for tokens

### Check Build Bundle Size

```bash
npm run ng -- build --configuration=production --stats-json
```

---

## Troubleshooting

### Port 4200 Already in Use

```bash
# Kill process on port 4200
npx kill-port 4200

# Start on different port
npm start -- --port 4300
```

### Node Modules Issues

```bash
# Clear node modules and reinstall
rm -r node_modules package-lock.json
npm install
```

### Build Errors

```bash
# Clear build cache
npm run ng -- build --configuration=production --verbose

# Check for TypeScript errors
npm run ng -- build
```

### Firebase Deployment Issues

```bash
# Verify Firebase configuration
firebase projects:list

# Check Firebase status
firebase projects:addfirebase

# Verbose deployment logs
firebase deploy --debug
```

---

## Contributing

When adding new features or making changes:

1. Create a feature branch from main
2. Follow Angular style guide conventions
3. Write unit tests for new code
4. Update this README if adding new commands or environments
5. Commit with clear, descriptive messages
6. Create a pull request for review

### Code Style

- Follow Angular style guide: https://angular.io/guide/styleguide
- Use kebab-case for file names: `my-component.component.ts`
- Use PascalCase for class names: `export class MyComponent`
- Use UPPER_SNAKE_CASE for constants

---

## Support

For issues, questions, or contributions, please:

1. Check existing documentation in this README
2. Review error logs in the browser console
3. Check Firebase deployment logs
4. Contact the development team

---

## License

© 2024 Dinify. All rights reserved.

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024 | Initial comprehensive documentation |
