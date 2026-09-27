import { TestBed } from '@angular/core/testing';
import { reflectComponentType } from '@angular/core';
import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { MenuNavBarComponent } from './menu-nav-bar.component';

/**
 * The nav bar is row 2 inside the diner menu's single `.menu-banner`, which owns
 * the background, shadow and sticky position for the whole banner. The component
 * used to carry a second, opaque and independently-sticky mode (a `stickyTop`
 * offset, white with a hairline) for the portal's embedded diner mount, switched
 * off by a `frosted` input. That mount is retired and the mode was removed. These
 * specs pin that it stays removed: bringing it back would put a second sticky
 * surface inside the banner.
 */
describe('MenuNavBarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuNavBarComponent],
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
      ],
    }).compileComponents();
  });

  it('declares no inputs (the frosted / stickyTop mode is gone)', () => {
    const mirror = reflectComponentType(MenuNavBarComponent)!;
    expect(mirror.inputs.map((i) => i.propName)).toEqual([]);
  });

  it('renders as a plain block with no sticky position, background, border or shadow of its own', () => {
    const fixture = TestBed.createComponent(MenuNavBarComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;

    expect(Array.from(host.classList)).toEqual(['block']);
    expect(host.style.top).toBe('');

    const style = getComputedStyle(host);
    expect(style.display).toBe('block');
    expect(style.position).toBe('static');
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.borderBottomWidth).toBe('0px');
    expect(style.boxShadow).toBe('none');
  });
});
