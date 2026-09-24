import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuItemTagRef } from 'src/app/_models/app.models';
import { AllergenInfoSheetComponent } from './allergen-info-sheet.component';
import { AllergenInfoLinkComponent } from './allergen-info-link.component';

const tag = (id: string, name: string, category: MenuItemTagRef['category']): MenuItemTagRef =>
  ({ id, name, category, icon: null, colour: 'gray' });

const GLUTEN = tag('g', 'Contains Gluten', 'allergen');
const DAIRY = tag('d', 'Contains Dairy', 'allergen');
const VEGAN = tag('v', 'Vegan', 'dietary');
const SPICY = tag('s', 'Spicy', 'descriptor');

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [AllergenInfoSheetComponent],
  template: `
    <app-allergen-info-sheet [open]="open" [tags]="tags" [hasChoices]="hasChoices" [context]="context"
      (closed)="closedCount = closedCount + 1; open = false"></app-allergen-info-sheet>
  `,
})
class HostComponent {
  open = true;
  tags: MenuItemTagRef[] = [];
  hasChoices = false;
  context: 'dish' | 'basket' = 'dish';
  closedCount = 0;
}

describe('AllergenInfoSheetComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  function render(patch: Partial<HostComponent> = {}): HTMLElement {
    Object.assign(host, patch);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const dialog = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="dialog"]');
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const pillNames = (root: HTMLElement, testid: string) =>
    Array.from(root.querySelectorAll(`[data-testid="${testid}"] app-tag-pill`)).map((p) => text(p));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('renders nothing while closed', () => {
    expect(dialog(render({ open: false }))).toBeNull();
  });

  it('is a modal dialog named by its title', () => {
    const d = dialog(render())!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    const title = d.querySelector(`#${d.getAttribute('aria-labelledby')}`);
    expect(text(title)).toBe('Allergens & dietary info');
  });

  it('KEEPS BOTH SAFETY SENTENCES the banner carried: ask staff, and tags are not a guarantee', () => {
    const info = text(render().querySelector('[data-testid="allergen-important-info"]'));
    expect(info).toContain('Food allergies? Please ask restaurant staff to confirm before ordering.');
    expect(info).toContain('They may be incomplete and do not guarantee allergen safety.');
  });

  it('lists the allergen tags under Allergens and the dietary ones under Dietary', () => {
    const root = render({ tags: [GLUTEN, VEGAN, DAIRY] });
    expect(pillNames(root, 'allergen-tags')).toEqual(['Contains Gluten', 'Contains Dairy']);
    expect(pillNames(root, 'dietary-tags')).toEqual(['Vegan']);
  });

  it('leaves out descriptor tags, which say nothing about allergens or diet', () => {
    const root = render({ tags: [SPICY, GLUTEN] });
    expect(text(dialog(root))).not.toContain('Spicy');
    expect(pillNames(root, 'allergen-tags')).toEqual(['Contains Gluten']);
  });

  it('AN UNTAGGED DISH IS NOT DECLARED ALLERGEN-FREE: it says nobody flagged any, and what that does not mean', () => {
    const root = render({ tags: [VEGAN, SPICY] });
    expect(text(root.querySelector('[data-testid="allergen-none-flagged"]'))).toBe(
      "The restaurant hasn't flagged any allergens for this dish. That doesn't mean it's free of them.");
    expect(root.querySelectorAll('[data-testid="allergen-tags"] app-tag-pill').length).toBe(0);
  });

  it('CONTROL: a dish WITH allergen tags does not carry the none-flagged sentence', () => {
    const root = render({ tags: [GLUTEN] });
    expect(root.querySelector('[data-testid="allergen-none-flagged"]')).toBeNull();
  });

  it('omits the Dietary section when the dish has no dietary tags', () => {
    expect(render({ tags: [GLUTEN] }).querySelector('[data-testid="dietary-tags"]')).toBeNull();
  });

  it('says the guidance covers the dish on its own only when it has options or extras', () => {
    expect(render({ hasChoices: false }).querySelector('[data-testid="allergen-choices-note"]')).toBeNull();
    expect(text(render({ hasChoices: true }).querySelector('[data-testid="allergen-choices-note"]')))
      .toBe('This covers the dish on its own. The options and extras you choose may contain other allergens.');
  });

  // ── the basket context: the link under the total, where the amber box was ──
  it('BASKET: leads with the no-special-requests sentence the amber box carried, and keeps both safety sentences', () => {
    const items = Array.from(render({ context: 'basket' })
      .querySelectorAll('[data-testid="allergen-important-info"] li')).map((li) => text(li));
    expect(items[0]).toBe("We're unable to take custom dietary or special-prep requests.");
    expect(items).toContain('Food allergies? Please ask restaurant staff to confirm before ordering.');
    expect(items).toContain(
      'Menu tags are added by the restaurant. They may be incomplete and do not guarantee allergen safety.');
  });

  it('BASKET: points to each dish and the filters instead of listing tags, and makes no per-dish claim', () => {
    // Tags are ignored here: the basket has no single dish to describe.
    const root = render({ context: 'basket', tags: [GLUTEN, VEGAN] });
    expect(text(root.querySelector('[data-testid="allergen-basket-guidance"]'))).toContain(
      'Each dish\'s allergen and dietary tags are under "Allergens & dietary info" on its page.');
    expect(root.querySelectorAll('app-tag-pill').length).toBe(0);
    expect(root.querySelector('[data-testid="allergen-none-flagged"]')).toBeNull();
  });

  it('BASKET: the filter pointer is conditional, because the filters only exist when something is tagged', () => {
    expect(text(render({ context: 'basket' }).querySelector('[data-testid="allergen-basket-guidance"]')))
      .toContain("If the restaurant has tagged allergens, the menu's filters can hide dishes that carry them.");
  });

  it('CONTROL: the dish context carries no special-requests sentence and no basket guidance', () => {
    const root = render({ tags: [GLUTEN] });
    expect(root.querySelector('[data-testid="allergen-no-requests"]')).toBeNull();
    expect(root.querySelector('[data-testid="allergen-basket-guidance"]')).toBeNull();
    expect(pillNames(root, 'allergen-tags')).toEqual(['Contains Gluten']);
  });

  it('the close button closes it', () => {
    const root = render();
    root.querySelector<HTMLButtonElement>('button[aria-label="Close allergen information"]')!.click();
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(dialog(root)).toBeNull();
  });

  it('Escape closes it', () => {
    const root = render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(dialog(root)).toBeNull();
  });

  it('a tap on the backdrop closes it', () => {
    const root = render();
    const backdrop = dialog(root)!.previousElementSibling as HTMLElement;
    backdrop.click();
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(dialog(root)).toBeNull();
  });
});

describe('AllergenInfoLinkComponent', () => {
  it('is a button announcing a dialog, and a press asks for the information', async () => {
    await TestBed.configureTestingModule({ imports: [AllergenInfoLinkComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AllergenInfoLinkComponent);
    let asked = 0;
    fixture.componentInstance.openInfo.subscribe(() => asked++);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(button.textContent!.replace(/\s+/g, ' ').trim()).toBe('Allergens & dietary info');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.type).toBe('button');
    button.click();
    expect(asked).toBe(1);
  });
});
