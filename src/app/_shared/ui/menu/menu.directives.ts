import { Directive, ElementRef, inject } from '@angular/core';
import { CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';

/**
 * THE SHARED MENU PRIMITIVE (SHELL-FINISH-00, PR 2): a styled CDK menu.
 *
 *   <button [appDnMenuTriggerFor]="m" aria-label="…">…</button>
 *   <ng-template #m>
 *     <div appDnMenu aria-label="…">
 *       <a appDnMenuItem routerLink="/account">My account</a>
 *       <button appDnMenuItem (cdkMenuItemTriggered)="signOut()">Sign out</button>
 *     </div>
 *   </ng-template>
 *
 * WHY THE CDK MENU AND NOT A HAND-ROLLED OVERLAY. `@angular/cdk/menu` already does
 * what a menu must: arrow keys / Home / End / type-ahead between items, Esc and an
 * outside click close it, focus moves into the menu on open and back to the trigger
 * on close, and the trigger carries `aria-haspopup="menu"` + `aria-expanded`. It
 * renders through the CDK Overlay into the overlay container under `<body>`
 * (z-index 1000, from the prebuilt CSS styles.css imports), so nothing in the shell
 * — the sidebar at z-50, the backdrop at z-40, the sticky top bar — can cover it.
 *
 * WHY DIRECTIVES AND NOT A WRAPPER COMPONENT. A `cdkMenuItem` finds its menu through
 * the element-injector tree of the template that DECLARES it. Items projected into a
 * wrapper component's `<ng-template>` would resolve against the page's template, not
 * the wrapper's `cdkMenu`, and the keyboard model would silently break. So the house
 * styling rides on the CDK directives themselves, as host directives.
 *
 * Colour roles (COLOUR-ROLES-00): rows hover and focus on the grey `--accent`, text
 * is ink, and nothing here is brand red — opening a menu is not the view's action.
 */

/**
 * End-aligned first, so a trigger at the right edge of the top bar opens its menu
 * inward; start-aligned as the real fallback for a trigger at the left (the venue
 * switcher). Below first, above as the fallback near the bottom of the viewport.
 */
export const DN_MENU_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];

@Directive({
  selector: '[appDnMenuTriggerFor]',
  standalone: true,
  exportAs: 'appDnMenuTrigger',
  hostDirectives: [
    {
      directive: CdkMenuTrigger,
      inputs: ['cdkMenuTriggerFor: appDnMenuTriggerFor', 'cdkMenuPosition: appDnMenuPosition'],
      outputs: ['cdkMenuOpened: appDnMenuOpened', 'cdkMenuClosed: appDnMenuClosed'],
    },
  ],
})
export class DnMenuTriggerDirective {
  readonly trigger = inject(CdkMenuTrigger, { self: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    this.trigger.menuPosition = DN_MENU_POSITIONS;
    // Focus returns to the trigger whenever the menu closes and focus would
    // otherwise be lost. The CDK already restores focus after a keyboard close;
    // an outside click on something that is not focusable (the page background)
    // leaves focus on <body>, which is what this catches. A click that lands on
    // another control keeps focus there — moving it back would fight the user.
    this.trigger.closed.subscribe(() => {
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!active || active === document.body) {
          this.host.nativeElement.focus();
        }
      });
    });
  }

  open(): void { this.trigger.open(); }
  close(): void { this.trigger.close(); }
  isOpen(): boolean { return this.trigger.isOpen(); }
}

@Directive({
  selector: '[appDnMenu]',
  standalone: true,
  hostDirectives: [CdkMenu],
  host: {
    class: 'block min-w-[220px] max-w-[320px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1 outline-none',
  },
})
export class DnMenuDirective {}

@Directive({
  selector: '[appDnMenuItem]',
  standalone: true,
  hostDirectives: [
    {
      directive: CdkMenuItem,
      inputs: ['cdkMenuItemDisabled: appDnMenuItemDisabled'],
      outputs: ['cdkMenuItemTriggered: appDnMenuItemTriggered'],
    },
  ],
  host: {
    // 44px rows: the touch-target minimum the audit asks of every tappable control.
    class: 'flex w-full items-center gap-3 min-h-[44px] px-3 text-left text-sm text-foreground no-underline cursor-pointer outline-none hover:bg-accent focus:bg-accent focus-visible:bg-accent disabled:opacity-50 disabled:cursor-not-allowed',
  },
})
export class DnMenuItemDirective {}

/**
 * A single-choice row (`role="menuitemradio"` + `aria-checked`), for a menu that
 * picks one of several — the venue switcher. Same styling as `appDnMenuItem`.
 * The checked row is marked by the CALLER's check glyph and by `aria-checked`,
 * never by a brand-red fill: chosen is ink, not act (COLOUR-ROLES-00).
 */
@Directive({
  selector: '[appDnMenuItemRadio]',
  standalone: true,
  hostDirectives: [
    {
      directive: CdkMenuItemRadio,
      inputs: ['cdkMenuItemChecked: appDnMenuItemChecked', 'cdkMenuItemDisabled: appDnMenuItemDisabled'],
      outputs: ['cdkMenuItemTriggered: appDnMenuItemTriggered'],
    },
  ],
  host: {
    class: 'flex w-full items-center gap-3 min-h-[44px] px-3 text-left text-sm text-foreground no-underline cursor-pointer outline-none hover:bg-accent focus:bg-accent focus-visible:bg-accent disabled:opacity-50 disabled:cursor-not-allowed',
  },
})
export class DnMenuItemRadioDirective {}

/** Import this in a standalone component's `imports` to use the menu. */
export const DN_MENU = [DnMenuTriggerDirective, DnMenuDirective, DnMenuItemDirective, DnMenuItemRadioDirective] as const;
