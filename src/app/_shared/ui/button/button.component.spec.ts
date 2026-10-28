import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent, ButtonVariant } from './button.component';

// Host mounts the attribute form (`button[app-dn-button]`) — the form every
// consumer uses — so the disabled/aria-busy host bindings are exercised on a
// real <button>.
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [ButtonComponent],
  template: `<button
    app-dn-button
    [variant]="variant"
    [size]="size"
    [disabled]="disabled"
    [loading]="loading"
  >Label</button>`,
})
class HostComponent {
  variant: ButtonVariant = 'default';
  size: 'default' | 'sm' | 'lg' | 'icon' = 'default';
  disabled = false;
  loading = false;
}

describe('ButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  function btn(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button');
  }
  function render(): HTMLButtonElement {
    fixture.detectChanges();
    return btn();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('applies the default variant with a token background and rounded-md shape', () => {
    const el = render();
    expect(el.className).toContain('bg-primary');
    expect(el.className).toContain('rounded-md');
    expect(el.className).toContain('font-medium');
    // Every button carries the offset focus ring.
    expect(el.className).toContain('focus-visible:ring-offset-2');
  });

  it('renders the destructive variant on its own token (distinct from primary)', () => {
    host.variant = 'destructive';
    const el = render();
    expect(el.className).toContain('bg-destructive');
    expect(el.className).not.toContain('bg-primary');
  });

  it('reproduces the diner CTA shape for variant="cta" and drops the rounded-md/default padding', () => {
    host.variant = 'cta';
    const el = render();
    expect(el.className).toContain('bg-primary');
    expect(el.className).toContain('rounded-xl');
    expect(el.className).toContain('shadow-glow');
    expect(el.className).toContain('font-semibold');
    expect(el.className).toContain('px-4');
    expect(el.className).toContain('py-3.5');
    // cta uses its own shape/size, never the non-cta radius or the size scale.
    expect(el.className).not.toContain('rounded-md');
    expect(el.className).not.toContain('py-2 ');
  });

  it('sets aria-busy, disables and shows a spinner while loading', () => {
    host.loading = true;
    const el = render();
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.hasAttribute('disabled')).toBeTrue();
    expect(el.className).toContain('pointer-events-none');
    expect(el.querySelector('svg.animate-spin')).toBeTruthy();
  });

  it('has no spinner and no aria-busy when idle', () => {
    const el = render();
    expect(el.getAttribute('aria-busy')).toBeNull();
    expect(el.querySelector('svg.animate-spin')).toBeNull();
  });

  it('applies the single standardized disabled treatment', () => {
    host.disabled = true;
    const el = render();
    expect(el.hasAttribute('disabled')).toBeTrue();
    expect(el.className).toContain('opacity-60');
    expect(el.className).toContain('pointer-events-none');
    expect(el.className).toContain('cursor-not-allowed');
  });

  // ── Colour roles: brand red means act; links are ink; danger has two quiet forms ──
  it('renders the link variant in ink, never brand red — a link is information', () => {
    host.variant = 'link';
    const el = render();
    expect(el.className).toContain('text-foreground');
    expect(el.className).toContain('font-medium');
    expect(el.className).toContain('hover:underline');
    expect(el.className).not.toContain('text-primary');
  });

  it('ghost-destructive is grey at rest and takes the danger tint only on hover', () => {
    host.variant = 'ghost-destructive';
    const el = render();
    expect(el.className).toContain('text-muted-foreground');
    expect(el.className).toContain('hover:bg-destructive/10');
    expect(el.className).toContain('hover:text-destructive');
    expect(el.className).not.toContain('bg-destructive ');
    expect(el.className).not.toContain('primary');
  });

  it('outline-destructive is a destructive outline, never a solid fill', () => {
    host.variant = 'outline-destructive';
    const el = render();
    expect(el.className).toContain('border-destructive/30');
    expect(el.className).toContain('text-destructive');
    expect(el.className).toContain('hover:bg-destructive/10');
    expect(el.className).not.toContain('bg-destructive ');
    expect(el.className).not.toContain('primary');
  });

  it('the neutral variants hover to the grey accent and focus with the ink ring', () => {
    for (const variant of ['ghost', 'outline'] as ButtonVariant[]) {
      host.variant = variant;
      const el = render();
      expect(el.className).withContext(variant).toContain('hover:bg-accent');
      expect(el.className).withContext(variant).toContain('focus-visible:ring-ring');
      expect(el.className).withContext(variant).not.toContain('primary');
    }
  });
});
