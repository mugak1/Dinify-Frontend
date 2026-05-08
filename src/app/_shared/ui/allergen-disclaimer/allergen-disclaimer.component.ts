import { Component } from '@angular/core';

@Component({
  selector: 'app-allergen-disclaimer',
  standalone: true,
  template: `
    <div class="flex items-start gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round"
           class="flex-shrink-0 mt-0.5"
           aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      <p class="leading-relaxed">
        <span class="font-medium">Food allergies?</span>
        Please ask restaurant staff to confirm before ordering. Menu
        tags may be incomplete and do not guarantee allergen safety.
      </p>
    </div>
  `,
})
export class AllergenDisclaimerComponent {}
