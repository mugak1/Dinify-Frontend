import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { DN_MENU } from './menu.directives';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [...DN_MENU],
  template: `
    <div style="position: relative; z-index: 50">
      <button type="button" data-testid="trigger" [appDnMenuTriggerFor]="m">Open</button>
    </div>
    <button type="button" data-testid="elsewhere">Elsewhere</button>
    <ng-template #m>
      <div appDnMenu aria-label="Test menu">
        <button appDnMenuItem type="button" (appDnMenuItemTriggered)="picked = 'one'">One</button>
        <button appDnMenuItem type="button" (appDnMenuItemTriggered)="picked = 'two'">Two</button>
        <button appDnMenuItem type="button" (appDnMenuItemTriggered)="picked = 'three'">Three</button>
      </div>
    </ng-template>
  `,
})
class HostComponent {
  picked = '';
}

describe('DN menu primitive (CDK menu, house styling)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let overlay: HTMLElement;

  const trigger = () => fixture.nativeElement.querySelector('[data-testid="trigger"]') as HTMLButtonElement;
  const menu = () => overlay.querySelector('[role="menu"]') as HTMLElement | null;
  const items = () => Array.from(overlay.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  // The CDK reads `keyCode` (as @angular/cdk/testing's createKeyboardEvent sets it),
  // which a plain KeyboardEvent leaves at 0.
  const KEY_CODES: Record<string, number> = {
    Enter: 13, Escape: 27, End: 35, Home: 36, ArrowUp: 38, ArrowDown: 40,
  };
  const key = (el: Element, k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => KEY_CODES[k] });
    el.dispatchEvent(e);
    fixture.detectChanges();
  };
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('the trigger announces a menu and its state (aria-haspopup, aria-expanded)', async () => {
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    trigger().click();
    await settle();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(menu()).not.toBeNull();
    expect(menu()!.getAttribute('aria-label')).toBe('Test menu');
    expect(items().length).toBe(3);
  });

  it('renders under <body> in the overlay container, outside the trigger’s stacking context', async () => {
    trigger().click();
    await settle();
    expect(fixture.nativeElement.contains(menu())).toBeFalse();
    expect(overlay.contains(menu())).toBeTrue();
    expect(overlay.parentElement).toBe(document.body);
    // Above the shell's sidebar (z-50) and backdrop (z-40).
    expect(Number(getComputedStyle(overlay).zIndex)).toBeGreaterThan(50);
  });

  it('rows are 44px touch targets', async () => {
    trigger().click();
    await settle();
    for (const item of items()) {
      expect(item.getBoundingClientRect().height).withContext(item.textContent!).toBeGreaterThanOrEqual(44);
    }
  });

  it('arrow keys, Home and End move focus between items', async () => {
    trigger().focus();
    key(trigger(), 'Enter'); // a keyboard open focuses the first item
    await settle();
    expect(document.activeElement).toBe(items()[0]);
    key(menu()!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(menu()!, 'End');
    expect(document.activeElement).toBe(items()[2]);
    key(menu()!, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(menu()!, 'ArrowUp');
    expect(document.activeElement).withContext('wraps').toBe(items()[2]);
  });

  it('Esc closes it and returns focus to the trigger', async () => {
    trigger().focus();
    key(trigger(), 'Enter');
    await settle();
    expect(menu()).not.toBeNull();
    key(menu()!, 'Escape');
    await settle();
    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('an outside click closes it, and focus returns to the trigger when the click landed on nothing focusable', async () => {
    trigger().click();
    await settle();
    expect(menu()).not.toBeNull();
    // A click on the page background: the CDK listens for outside pointer events.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (document.activeElement as HTMLElement | null)?.blur();
    await settle();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('an outside click on another control leaves focus there', async () => {
    trigger().click();
    await settle();
    const elsewhere = fixture.nativeElement.querySelector('[data-testid="elsewhere"]') as HTMLButtonElement;
    elsewhere.focus();
    elsewhere.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('choosing an item runs it and closes the menu', async () => {
    trigger().click();
    await settle();
    items()[1].click();
    await settle();
    expect(fixture.componentInstance.picked).toBe('two');
    expect(menu()).toBeNull();
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [...DN_MENU],
  template: `
    <button type="button" data-testid="trigger" [appDnMenuTriggerFor]="m">Open</button>
    <ng-template #m>
      <div appDnMenu aria-label="Pick one">
        @for (o of options; track o) {
          <button appDnMenuItemRadio type="button" [appDnMenuItemChecked]="o === chosen"
            (appDnMenuItemTriggered)="picked = o">{{ o }}</button>
        }
      </div>
    </ng-template>
  `,
})
class RadioHostComponent {
  options = ['A', 'B'];
  chosen = 'A';
  picked = '';
}

describe('DN menu primitive — single-choice rows (appDnMenuItemRadio)', () => {
  it('render as menuitemradio with aria-checked, 44px tall, and run on choose', async () => {
    await TestBed.configureTestingModule({ imports: [RadioHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(RadioHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="trigger"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const rows = Array.from(overlay.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    for (const r of rows) expect(r.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    rows[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toBe('B');
    fixture.destroy();
    fixture.nativeElement.remove();
  });
});
