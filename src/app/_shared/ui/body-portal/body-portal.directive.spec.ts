import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BodyPortalDirective } from './body-portal.directive';

/**
 * The ancestor here is the shape WebKit gets wrong: sticky, overflow-clipped
 * and z-indexed, so a stacking context that clips. Karma runs Chromium, which
 * paints fixed overlays correctly anyway, so these pin where the overlay is
 * PUT. That is what decides the outcome in Safari (WebKit bug 160953).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [BodyPortalDirective],
  template: `
    <section data-testid="clipping-ancestor" style="position: sticky; top: 0; overflow-y: auto; z-index: 1">
      <div class="contents" data-testid="portal" [appBodyPortal]="portal">
        @if (open) {
          <button type="button" data-testid="inside" (click)="clicks = clicks + 1">{{ label }}</button>
        }
      </div>
    </section>
  `,
})
class HostComponent {
  portal = true;
  open = true;
  label = 'Order';
  clicks = 0;
}

describe('BodyPortalDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const portal = () => document.querySelector<HTMLElement>('[data-testid="portal"]');
  const ancestor = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="clipping-ancestor"]')!;
  const inside = () => document.querySelector<HTMLButtonElement>('[data-testid="inside"]');

  function render(patch: Partial<HostComponent> = {}): void {
    Object.assign(host, patch);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  // A destroyed TEST fixture keeps its own nodes until TestBed removes its root
  // element, so a host that stayed in place is still in the document here. What
  // must not survive is anything outside that root.
  afterEach(() => {
    const root = fixture.nativeElement as HTMLElement;
    fixture.destroy();
    const strays = Array.from(document.querySelectorAll('[data-testid="portal"]')).filter((el) => !root.contains(el));
    expect(strays.length).withContext('nothing is left behind in <body>').toBe(0);
  });

  it('REGRESSION: when enabled, the host renders as a child of <body>, outside its clipping ancestor', () => {
    render();
    expect(portal()!.parentElement).toBe(document.body);
    expect(ancestor().contains(portal())).toBe(false);
    expect(inside()!.closest('[data-testid="clipping-ancestor"]')).toBeNull();
  });

  it('CONTROL: when disabled, the host stays where the template put it', () => {
    render({ portal: false });
    expect(portal()!.parentElement).toBe(ancestor());
    expect(ancestor().contains(inside())).toBe(true);
  });

  it('an @if block inside it still comes and goes where the host now is', () => {
    render();
    render({ open: false });
    expect(inside()).toBeNull();
    render({ open: true });
    expect(inside()!.parentElement).withContext('re-inserted under the moved host').toBe(portal());
    expect(ancestor().contains(inside())).toBe(false);
  });

  it('bindings and listeners follow the node', () => {
    render();
    render({ label: 'Cancel' });
    expect(inside()!.textContent!.trim()).toBe('Cancel');
    inside()!.click();
    expect(host.clicks).toBe(1);
  });

  it('destroying the view removes the moved host from <body>', () => {
    render();
    const moved = portal()!;
    fixture.destroy();
    expect(moved.isConnected).toBe(false);
  });

  it('is decided once: turning the input off later does not move the host back', () => {
    render();
    render({ portal: false });
    expect(portal()!.parentElement).toBe(document.body);
  });
});
