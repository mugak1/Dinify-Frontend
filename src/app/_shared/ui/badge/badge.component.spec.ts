import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BadgeComponent, BadgeVariant } from './badge.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [BadgeComponent],
  template: `<app-dn-badge [variant]="variant">Label</app-dn-badge>`,
})
class HostComponent {
  variant: BadgeVariant = 'default';
}

// Badges are labels and statuses, never actions — so none of them is brand red.
describe('BadgeComponent (colour roles)', () => {
  let fixture: ComponentFixture<HostComponent>;

  function badge(variant: BadgeVariant): HTMLElement {
    fixture.componentInstance.variant = variant;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('app-dn-badge');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
  });

  it('default is the ink "selected" label, not brand red', () => {
    const el = badge('default');
    expect(el.className).toContain('bg-selected');
    expect(el.className).toContain('text-selected-foreground');
    expect(el.className).not.toContain('bg-primary');
  });

  it('success is a green tint with dark text (open / done)', () => {
    const el = badge('success');
    expect(el.className).toContain('bg-green-100');
    expect(el.className).toContain('text-green-800');
  });

  it('warning is an amber tint with dark text (waiting)', () => {
    const el = badge('warning');
    expect(el.className).toContain('bg-amber-100');
    expect(el.className).toContain('text-amber-900');
  });

  it('CONTROL: secondary, outline and destructive keep their meaning', () => {
    expect(badge('secondary').className).toContain('bg-secondary');
    expect(badge('outline').className).toContain('border-input');
    expect(badge('destructive').className).toContain('bg-destructive');
  });

  it('no variant renders in brand red', () => {
    for (const v of ['default', 'secondary', 'destructive', 'outline', 'success', 'warning'] as BadgeVariant[]) {
      expect(badge(v).className).withContext(v).not.toMatch(/(^|\s)(bg|text)-(primary|d-red)(\s|$)/);
    }
  });
});
