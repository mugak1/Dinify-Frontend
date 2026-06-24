import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagPillComponent } from './tag-pill.component';

describe('TagPillComponent (restyle)', () => {
  let fixture: ComponentFixture<TagPillComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TagPillComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(TagPillComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  /** Sets inputs, renders, and returns the pill `<span>`. */
  function render(props: Partial<TagPillComponent>): HTMLElement {
    Object.assign(fixture.componentInstance, props);
    fixture.detectChanges();
    return host.firstElementChild as HTMLElement;
  }

  it('renders the tag name', () => {
    render({ name: 'Vegan', colour: 'green', icon: 'sprout' });
    expect(host.textContent).toContain('Vegan');
  });

  it('renders the served icon glyph inside a colour-filled disc', () => {
    const pill = render({ name: 'Vegan', colour: 'green', icon: 'sprout' });
    // The SVG must survive Angular's [innerHTML] binding (not be sanitised away).
    const svg = pill.querySelector('svg');
    expect(svg).withContext('icon SVG should render').toBeTruthy();
    const disc = svg!.parentElement as HTMLElement;
    expect(disc.className).toContain('bg-green-600'); // disc fill = tag colour
    expect(disc.className).toContain('text-white'); // white glyph
  });

  it('applies the data-driven pill-body colour (soft bg + family text + ring)', () => {
    const pill = render({ name: 'Spicy', colour: 'red', icon: 'flame' });
    expect(pill.className).toContain('bg-red-50');
    expect(pill.className).toContain('text-red-700');
    expect(pill.className).toContain('ring-inset');
  });

  it('omits the icon disc when the tag carries no icon', () => {
    const pill = render({ name: 'Plain', colour: 'blue', icon: null });
    expect(pill.querySelector('svg')).toBeNull();
    expect(pill.className).toContain('bg-blue-50');
  });

  it('omits the icon disc when the served icon has no catalog mapping', () => {
    const pill = render({ name: 'Unmapped', colour: 'purple', icon: 'not-a-real-icon' });
    expect(pill.querySelector('svg')).toBeNull();
  });

  it('falls back to a neutral grey pill for an unknown colour (legacy data)', () => {
    const pill = render({ name: 'Legacy', colour: 'chartreuse' as never, icon: null });
    expect(pill.className).toContain('bg-gray-50');
  });

  it('renders a larger disc and type for the md size', () => {
    const pill = render({ name: 'Big', colour: 'rose', icon: 'flame', size: 'md' });
    expect(pill.className).toContain('text-[13.5px]');
    const disc = pill.querySelector('svg')!.parentElement as HTMLElement;
    expect(disc.className).toContain('h-[19px]');
  });
});
