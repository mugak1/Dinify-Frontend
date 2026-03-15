import { Component } from '@angular/core';
import { AuthenticationService } from '../../_services/authentication.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-welcome',
  template: `
    <div class="welcome-container">
      <div class="welcome-card">
        <img src="assets/images/dinify-logo.png" alt="Dinify" class="logo" />
        <h2>Welcome to Dinify</h2>
        <p>Your account is being set up.</p>
        <p class="sub">Please contact your administrator to assign your role.</p>
        <button (click)="logout()" class="logout-btn">Sign Out</button>
      </div>
    </div>
  `,
  styles: [`
    .welcome-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #f5f5f5;
    }
    .welcome-card {
      text-align: center;
      background: white;
      padding: 3rem 2rem;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
      max-width: 420px;
      width: 100%;
    }
    .logo {
      width: 160px;
      margin-bottom: 1.5rem;
    }
    h2 {
      margin: 0 0 0.5rem;
      color: #333;
    }
    p {
      color: #666;
      margin: 0.25rem 0;
    }
    .sub {
      font-size: 0.875rem;
      color: #999;
      margin-top: 0.5rem;
    }
    .logout-btn {
      margin-top: 1.5rem;
      padding: 0.6rem 2rem;
      background: #e74c3c;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .logout-btn:hover {
      background: #c0392b;
    }
  `]
})
export class WelcomeComponent {
  constructor(
    private authenticationService: AuthenticationService,
    private router: Router
  ) {}

  logout() {
    this.authenticationService.logout();
  }
}
