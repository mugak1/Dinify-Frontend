import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { DnSegmentedComponent, DnSegItem } from './segmented.component';

const VALUE_ITEMS: DnSegItem[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma', disabled: true },
  { value: 'd', label: 'Delta' },
];

const ROUTER_ITEMS: DnSegItem[] = [
  { value: 'a', label: 'Alpha', path: 'a' },
  { value: 'b', label: 'Beta', path: 'b' },
];

@Component({
  standalone: true,
  imports: [DnSegmentedComponent],
  template: `
    <app-dn-segmented
      [items]="items"
      [value]="value"
      [mode]="mode"
      [layout]="layout"
      [manualActivation]="manualActivation"
      (valueChange)="onChange($event)"
    ></app-dn-segmented>
  `,
})
class HostComponent {
  items: DnSegItem[] = VALUE_ITEMS;
  value = 'a';
  mode: 'value' | 'router' = 'value';
  layout: 'hug' | 'responsive' | 'fill' = 'hug';
  manualActivation = false;
  changed: string[] = [];
  onChange(v: string): void {
    this.changed.push(v);
  }
}

/** Host that projects an #icon template so we can assert the ngTemplateOutlet context. */
@Component({
  standalone: true,
  imports: [DnSegmentedComponent],
  template: `
    <app-dn-segmented [items]="items" [value]="value">
      <ng-template #icon let-item let-active="active">
        <i class="ic" [attr.data-icon]="item.icon" [attr.data-active]="active"></i>
      </ng-template>
    </app-dn-segmented>
  `,
})
class IconHostComponent {
  items: DnSegItem[] = [
    { value: 'a', label: 'Alpha', icon: 'star' },
    { value: 'b', label: 'Beta', icon: 'heart' },
  ];
  value = 'a';
}

function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

describe('DnSegmentedComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  function child(): DnSegmentedComponent {
    return fixture.debugElement.query(By.directive(DnSegmentedComponent))
      .componentInstance as DnSegmentedComponent;
  }
  function buttons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button[role="tab"]'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, IconHostComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => fixture?.destroy());

  it('value mode: renders a role="tab" button per item, active one aria-selected', () => {
    fixture.detectChanges();
    const b = buttons();
    expect(b.length).toBe(4);
    expect(b[0].getAttribute('aria-selected')).toBe('true');
    expect(b[1].getAttribute('aria-selected')).toBe('false');
    // No router anchors in value mode.
    expect(fixture.nativeElement.querySelectorAll('a').length).toBe(0);
  });

  it('applies roving tabindex (active 0, rest -1)', () => {
    fixture.detectChanges();
    const b = buttons();
    expect(b[0].tabIndex).toBe(0);
    expect(b[1].tabIndex).toBe(-1);
    expect(b[3].tabIndex).toBe(-1);
  });

  it('click selects optimistically: emits valueChange and flips active before [value] echoes', () => {
    fixture.detectChanges();
    buttons()[1].click();
    fixture.detectChanges();
    // Parent [value] is still 'a' (no echo), yet the control shows Beta active.
    expect(host.value).toBe('a');
    expect(host.changed).toEqual(['b']);
    expect(child().active()).toBe('b');
    expect(buttons()[1].getAttribute('aria-selected')).toBe('true');
    expect(buttons()[0].getAttribute('aria-selected')).toBe('false');
  });

  it('a controlled [value] change re-syncs the active segment (fixes programmatic switch)', () => {
    fixture.detectChanges();
    host.value = 'b';
    fixture.detectChanges();
    expect(child().active()).toBe('b');
    expect(buttons()[1].getAttribute('aria-selected')).toBe('true');
  });

  it('disabled item is not selectable and is skipped by arrow navigation', () => {
    fixture.detectChanges();
    const b = buttons();
    expect(b[2].disabled).toBe(true);
    // ArrowRight from Beta (index 1) skips disabled Gamma → Delta.
    host.value = 'b';
    fixture.detectChanges();
    key(buttons()[1], 'ArrowRight');
    fixture.detectChanges();
    expect(child().active()).toBe('d');
    expect(host.changed).toContain('d');
  });

  it('keyboard: Arrow/Home/End move + auto-select (default activation)', () => {
    fixture.detectChanges();
    key(buttons()[0], 'ArrowRight');
    fixture.detectChanges();
    expect(child().active()).toBe('b');

    key(buttons()[1], 'End');
    fixture.detectChanges();
    expect(child().active()).toBe('d');

    key(buttons()[3], 'Home');
    fixture.detectChanges();
    expect(child().active()).toBe('a');

    // Wrap: ArrowLeft from first enabled → last enabled.
    key(buttons()[0], 'ArrowLeft');
    fixture.detectChanges();
    expect(child().active()).toBe('d');
  });

  it('manualActivation: arrows do NOT select; Enter/Space do', () => {
    host.manualActivation = true;
    fixture.detectChanges();
    key(buttons()[0], 'ArrowRight');
    fixture.detectChanges();
    expect(child().active()).toBe('a'); // unchanged
    expect(host.changed).toEqual([]);

    key(buttons()[1], 'Enter');
    fixture.detectChanges();
    expect(child().active()).toBe('b');
    expect(host.changed).toEqual(['b']);
  });

  it('renders a trailing asterisk for items with hasError', () => {
    host.items = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta', hasError: true },
    ];
    fixture.detectChanges();
    expect(buttons()[0].textContent).not.toContain('*');
    expect(buttons()[1].textContent).toContain('*');
  });

  it('router mode: renders anchors with aria-current on active, no role="tab"', () => {
    host.items = ROUTER_ITEMS;
    host.mode = 'router';
    fixture.detectChanges();
    const anchors = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLElement[];
    expect(anchors.length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('button[role="tab"]').length).toBe(0);
    expect(anchors[0].getAttribute('aria-current')).toBe('page');
    expect(anchors[1].getAttribute('aria-current')).toBeNull();
  });

  it('projects the #icon template with { $implicit: item, active } context', () => {
    const iconFixture = TestBed.createComponent(IconHostComponent);
    iconFixture.detectChanges();
    const icons = Array.from(iconFixture.nativeElement.querySelectorAll('i.ic')) as HTMLElement[];
    expect(icons.length).toBe(2);
    expect(icons[0].getAttribute('data-icon')).toBe('star');
    expect(icons[0].getAttribute('data-active')).toBe('true'); // value 'a' is active
    expect(icons[1].getAttribute('data-icon')).toBe('heart');
    expect(icons[1].getAttribute('data-active')).toBe('false');
    iconFixture.destroy();
  });

  it('syncGlider math: positions the glider at Σ preceding widths / active width, and guards width 0', () => {
    // Build a bare instance and stub the measured segments so the math is deterministic
    // (Tailwind layout is not applied in the unit context, so we assert the maths, not pixels).
    const bare = TestBed.createComponent(DnSegmentedComponent).componentInstance;
    bare.items = VALUE_ITEMS;
    const fakeSegs = (lefts: number[], widths: number[]) => ({
      get: (i: number) => ({ nativeElement: { offsetLeft: lefts[i], offsetWidth: widths[i] } }),
    });

    // active = 'b' (index 1)
    bare.active.set('b');
    (bare as unknown as { segs: unknown }).segs = fakeSegs([0, 100, 210, 320], [90, 100, 100, 120]);
    (bare as unknown as { syncGlider(): void }).syncGlider();
    expect(bare.gliderLeft()).toBe(100);
    expect(bare.gliderWidth()).toBe(100);

    // active = 'd' (index 3)
    bare.active.set('d');
    (bare as unknown as { syncGlider(): void }).syncGlider();
    expect(bare.gliderLeft()).toBe(320);
    expect(bare.gliderWidth()).toBe(120);

    // A zero width (detached / not laid out) is ignored — last good geometry is kept.
    (bare as unknown as { segs: unknown }).segs = fakeSegs([0, 100, 210, 999], [90, 100, 100, 0]);
    (bare as unknown as { syncGlider(): void }).syncGlider();
    expect(bare.gliderLeft()).toBe(320);
    expect(bare.gliderWidth()).toBe(120);
  });
});
