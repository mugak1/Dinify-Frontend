import { ElementRef } from '@angular/core';
import { ScrollSpyCommonDirective } from './scroll-spy-common.directive';

/** Fake spied children — plain objects are enough; the directive only reads
 *  `tagName`, `id`, and `offsetTop`. */
function hostWith(children: { id: string; offsetTop: number }[]): ElementRef {
  return {
    nativeElement: {
      children: children.map((c) => ({ tagName: 'DIV', id: c.id, offsetTop: c.offsetTop })),
    },
  } as unknown as ElementRef;
}

describe('ScrollSpyCommonDirective', () => {
  function make(children: { id: string; offsetTop: number }[]) {
    const dir = new ScrollSpyCommonDirective(hostWith(children));
    dir.spiedTags = ['DIV'];
    const emitted: string[] = [];
    dir.sectionChange.subscribe((s) => emitted.push(s));
    return { dir, emitted };
  }

  const SECTIONS = [
    { id: 'a', offsetTop: 0 },
    { id: 'b', offsetTop: 300 },
    { id: 'c', offsetTop: 600 },
  ];

  it('with no offset, activates the last section whose top has passed the viewport top', () => {
    const { dir, emitted } = make(SECTIONS);
    (dir as any).findCurrentSection(250, 0); // b starts at 300 → still on a
    expect(emitted.at(-1)).toBe('a');
  });

  it('with an offsetTop (sticky banner), activates a section once its top clears the banner', () => {
    const { dir, emitted } = make(SECTIONS);
    dir.stickyOffset = 100;
    (dir as any).findCurrentSection(250, 0); // 300 <= 250 + 100 → b is active earlier
    expect(emitted.at(-1)).toBe('b');
  });

  it('always emits the first section at the very top regardless of offset', () => {
    const { dir, emitted } = make(SECTIONS);
    dir.stickyOffset = 150;
    (dir as any).findCurrentSection(0, 0);
    expect(emitted.at(-1)).toBe('a');
  });

  it('only emits when the active section actually changes', () => {
    const { dir, emitted } = make(SECTIONS);
    (dir as any).findCurrentSection(650, 0); // c
    (dir as any).findCurrentSection(660, 0); // still c
    expect(emitted).toEqual(['c']);
  });
});
