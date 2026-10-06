import { Directive, ElementRef, Input, OnDestroy, OnInit, booleanAttribute } from '@angular/core';

/**
 * Renders its host as a child of `<body>` while `appBodyPortal` is true, and in
 * place otherwise.
 *
 * FOR VIEWPORT OVERLAYS WHOSE ANCESTOR WOULD CLIP THEM. A `position: fixed`
 * overlay is meant to escape its ancestors, and in Chromium it does. WebKit
 * (Safari) does not when an ancestor is BOTH a stacking context and an overflow
 * clip, such as a `sticky` element with `overflow-y: auto`. That is the diner's
 * desktop basket sidebar. WebKit still lays the overlay out over the whole
 * viewport and hit-tests it there, but paints it only inside that ancestor's
 * padding box. So a dialog centred on the page is invisible while its buttons
 * still take clicks (WebKit bug 160953, reproduced in WebKitGTK 2.52.6). Under
 * `<body>` there is no such ancestor.
 *
 * NOTHING ELSE ABOUT THE OVERLAY CHANGES. Bindings, listeners and change
 * detection follow the node, not its position: Angular keeps its own reference,
 * and an `@if` block inside the host inserts relative to its anchor, which moves
 * with the host. z-index works as before, now against the root stacking context.
 *
 * DECIDED ONCE, ON INIT. Changing the input later does not move the host back.
 * The host is removed from `<body>` on destroy, because destroying the view that
 * owns it removes that view's host element, which no longer contains this node.
 */
@Directive({
  selector: '[appBodyPortal]',
  standalone: true,
})
export class BodyPortalDirective implements OnInit, OnDestroy {
  @Input({ alias: 'appBodyPortal', transform: booleanAttribute }) enabled = false;

  private moved = false;

  constructor(private el: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    if (!this.enabled) return;
    const host = this.el.nativeElement;
    host.ownerDocument.body.appendChild(host);
    this.moved = true;
  }

  ngOnDestroy(): void {
    if (this.moved) this.el.nativeElement.remove();
  }
}
