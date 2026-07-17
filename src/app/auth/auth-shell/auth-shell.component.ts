import { Component, Input } from '@angular/core';


/**
 * Presentational auth-screen chrome, extracted from the redesigned login screen so
 * the secondary auth screens (password change, forgot-password, welcome) share one
 * identity: a warm cream field, a floating white card, the wordmark, and a Gabarito
 * eyebrow / title / subtitle triad. Login itself keeps its own inline copy (it is
 * the proven critical path and can't be visually verified here); this shell is only
 * for the rebuilds. The body — each screen's own <form>, fields and CTA — is
 * projected in, so the card here is a plain <div> (not a <form>).
 */
@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [],
  template: `
    <!-- Environment: warm cream gradient, centered. Mirrors login.component.html. -->
    <div class="relative min-h-screen flex items-center justify-center px-6 py-10 overflow-hidden
                bg-[radial-gradient(60%_50%_at_88%_4%,rgba(255,160,120,0.13)_0%,rgba(255,160,120,0)_60%),radial-gradient(52%_44%_at_4%_100%,rgba(255,44,50,0.07)_0%,rgba(255,44,50,0)_60%),linear-gradient(158deg,#FCF6EE_0%,#F4E8D8_100%)]">
    
      <!-- Fine paper grain — keeps the large cream field from reading flat. -->
      <div aria-hidden="true"
           class="pointer-events-none absolute inset-0 z-0 mix-blend-multiply opacity-[0.04]
                  bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22180%22%20height%3D%22180%22%3E%3Cfilter%20id%3D%22n%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%220.9%22%20numOctaves%3D%222%22%20stitchTiles%3D%22stitch%22%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20filter%3D%22url(%23n)%22%20opacity%3D%220.55%22%2F%3E%3C%2Fsvg%3E')]"></div>
    
      <!-- Floating white card -->
      <div class="relative z-10 w-full max-w-[452px] bg-white border border-gray-200/80 rounded-[22px]
                  shadow-[0_1px_2px_rgba(60,40,20,0.05),0_34px_70px_-30px_rgba(60,40,20,0.34)]
                  px-8 py-10 sm:px-11 sm:py-12 text-center">
    
        <!-- Wordmark -->
        <img src="assets/images/dinify-logo-full.svg" alt="Dinify" class="h-9 mx-auto mb-7" />
    
        <!-- Eyebrow / title / subtitle triad -->
        @if (heading) {
          <div class="space-y-1.5 text-center mb-[18px]">
            @if (eyebrow) {
              <p class="font-gabarito text-xs font-bold tracking-[0.16em] uppercase text-[#C2151B]">{{ eyebrow }}</p>
            }
            <h1 class="font-gabarito font-bold text-[33px] leading-tight tracking-tight text-gray-900">{{ heading }}</h1>
            @if (subtitle) {
              <p class="text-[15px] text-gray-400">{{ subtitle }}</p>
            }
          </div>
        }
    
        <ng-content></ng-content>
      </div>
    </div>
    `,
})
export class AuthShellComponent {
  @Input() eyebrow?: string;
  @Input() heading = '';
  @Input() subtitle?: string;
}
