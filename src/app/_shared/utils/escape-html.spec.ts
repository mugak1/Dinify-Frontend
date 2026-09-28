import { escapeHtml } from './escape-html';

/**
 * `escapeHtml` encodes a value for HTML TEXT content and for a DOUBLE-QUOTED
 * attribute value — nothing more. These tests pin that contract, including
 * what it deliberately does NOT do (apostrophes are left alone, so it is not a
 * single-quoted-attribute encoder), and check the round trip through a real
 * HTML parser rather than only the replaced characters.
 */
describe('escapeHtml', () => {
  /** Parse `html` as body content and return the parsed body. Runs nothing. */
  function parseBody(html: string): HTMLElement {
    return new DOMParser().parseFromString(`<!DOCTYPE html><body>${html}</body>`, 'text/html').body;
  }

  it('encodes &, <, > and " as character references', () => {
    expect(escapeHtml(`a & b < c > d " e`)).toBe('a &amp; b &lt; c &gt; d &quot; e');
  });

  it('encodes & first, so an entity-looking input is displayed literally rather than decoded', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
    expect(parseBody(escapeHtml('&amp; &lt;b&gt; &#39;')).textContent).toBe('&amp; &lt;b&gt; &#39;');
  });

  it('leaves apostrophes untouched — it does not claim single-quoted attribute safety', () => {
    expect(escapeHtml(`Friends' Deck`)).toBe(`Friends' Deck`);
  });

  it('passes ordinary text, Unicode and emoji through unchanged', () => {
    for (const value of ['Main Dining', 'Café Ndiizi — Kampala', '食堂', '🍌🌿', '']) {
      expect(escapeHtml(value)).toBe(value);
    }
  });

  it('round-trips markup-looking input as TEXT through a real parser, creating no element or attribute', () => {
    const input = `Patio <dinify-probe data-d14="x">m</dinify-probe> & "Deck"`;
    const body = parseBody(`<div class="label">${escapeHtml(input)}</div>`);

    expect(body.querySelector('dinify-probe')).toBeNull();
    expect(body.querySelector('[data-d14]')).toBeNull();
    const label = body.querySelector('.label')!;
    expect(label.children.length).toBe(0);
    expect(label.textContent).toBe(input);
  });

  it('keeps a double-quoted attribute value intact, adding no attribute', () => {
    const input = `7" data-d14="x`;
    const body = parseBody(`<img alt="Table ${escapeHtml(input)}">`);

    const img = body.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe(`Table ${input}`);
    expect(img.hasAttribute('data-d14')).toBeFalse();
    expect(img.attributes.length).toBe(1);
  });

  it('keeps title-closing content inside the <title> element', () => {
    const input = '</title><dinify-probe data-d14="t"></dinify-probe>';
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><head><title>QR Codes – ${escapeHtml(input)}</title></head><body></body></html>`,
      'text/html',
    );

    expect(doc.title).toBe(`QR Codes – ${input}`);
    expect(doc.querySelector('dinify-probe')).toBeNull();
  });
});
