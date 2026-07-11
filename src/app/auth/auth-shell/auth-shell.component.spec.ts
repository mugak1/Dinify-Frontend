import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthShellComponent } from './auth-shell.component';

describe('AuthShellComponent', () => {
  @Component({
    standalone: true,
    imports: [AuthShellComponent],
    template: `<app-auth-shell [eyebrow]="eyebrow" [heading]="heading" [subtitle]="subtitle">
      <p class="projected">Body here</p>
    </app-auth-shell>`,
  })
  class HostComponent {
    eyebrow?: string;
    heading = '';
    subtitle?: string;
  }

  function render(setup: (h: HostComponent) => void): HTMLElement {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture: ComponentFixture<HostComponent> = TestBed.createComponent(HostComponent);
    setup(fixture.componentInstance);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the heading as a single <h1> plus the eyebrow and subtitle', () => {
    const el = render((h) => {
      h.eyebrow = 'Welcome back';
      h.heading = 'Sign in to Dinify';
      h.subtitle = 'Pick up where you left off.';
    });
    const h1 = el.querySelector('h1');
    expect(h1?.textContent).toContain('Sign in to Dinify');
    expect(el.textContent).toContain('Welcome back');
    expect(el.textContent).toContain('Pick up where you left off.');
  });

  it('projects body content into the card', () => {
    const el = render((h) => (h.heading = 'Title'));
    expect(el.querySelector('.projected')?.textContent).toContain('Body here');
  });

  it('omits the eyebrow and subtitle when they are not provided', () => {
    const el = render((h) => (h.heading = 'Only heading'));
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.textContent).toContain('Only heading');
    expect(el.textContent).not.toContain('undefined');
  });
});
