import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PageHeaderComponent } from './page-header.component';

describe('PageHeaderComponent', () => {
  it('renders the title in an <h1>', async () => {
    await TestBed.configureTestingModule({ imports: [PageHeaderComponent] }).compileComponents();
    const fixture = TestBed.createComponent(PageHeaderComponent);
    fixture.componentInstance.title = 'Dashboard';
    fixture.detectChanges();

    const h1 = (fixture.nativeElement as HTMLElement).querySelector('h1');
    expect(h1).toBeTruthy();
    expect(h1?.textContent?.trim()).toBe('Dashboard');
    // The one shared page-title look.
    expect(h1?.className).toContain('text-2xl');
    expect(h1?.className).toContain('font-bold');
    expect(h1?.className).toContain('text-foreground');
  });

  it('renders the description only when provided', async () => {
    await TestBed.configureTestingModule({ imports: [PageHeaderComponent] }).compileComponents();
    const fixture = TestBed.createComponent(PageHeaderComponent);
    fixture.componentInstance.title = 'Support';
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('p')).toBeFalsy();

    fixture.componentInstance.description = 'Report an issue to the team.';
    fixture.detectChanges();
    const p = (fixture.nativeElement as HTMLElement).querySelector('p');
    expect(p?.textContent?.trim()).toBe('Report an issue to the team.');
  });

  it('projects an actions slot', async () => {
    @Component({
      standalone: true,
      imports: [PageHeaderComponent],
      template: `<app-page-header title="Menu"><button actions id="cta">New</button></app-page-header>`,
    })
    class HostComponent {}

    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    const fixture: ComponentFixture<HostComponent> = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const cta = (fixture.nativeElement as HTMLElement).querySelector('#cta');
    expect(cta).toBeTruthy();
    expect(cta?.textContent?.trim()).toBe('New');
  });
});
