import { Component } from '@angular/core';
import { AuthenticationService } from '../../_services/authentication.service';

@Component({
    selector: 'app-welcome',
    template: `
    <app-auth-shell
      eyebrow="Almost there"
      heading="Welcome to Dinify"
      subtitle="Your account is being set up — please contact your administrator to assign your role, then sign back in.">
      <div class="w-full">
        <!-- DINIFY_WELCOME_V1 -->
        <div class="flex items-center justify-center w-14 h-14 mx-auto mb-6 rounded-full bg-d-red/10 text-d-red">
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>
        </div>
        <button (click)="logout()" type="button"
                class="w-full h-[54px] rounded-[11px] bg-d-red text-white font-gabarito font-bold text-base shadow-glow desktop-hover:bg-[#E61C22] active:scale-[0.985] transition-all duration-150">
          Sign out
        </button>
      </div>
    </app-auth-shell>
  `,
    standalone: false
})
export class WelcomeComponent {
  constructor(
    private authenticationService: AuthenticationService
  ) {}

  logout() {
    this.authenticationService.logout();
  }
}
