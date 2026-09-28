/**
 * Encode a value for HTML TEXT content and for a DOUBLE-QUOTED attribute value.
 *
 * Moved unchanged from the report print sheet (D14 B1) so the table print
 * documents — which are assembled as strings and written with
 * `document.write` into a same-origin popup — share one encoder. Call it once,
 * where the value is interpolated into markup, and on nothing else.
 *
 * WHAT IT DOES: replaces `&`, `<`, `>` and `"` with their character
 * references, so the value is displayed exactly as given — including an
 * ampersand, quotes, angle brackets, Unicode, and text that merely looks like
 * an entity (`&amp;` stays visible as `&amp;`).
 *
 * WHAT IT IS NOT: it does not encode apostrophes, so it is NOT safe inside a
 * single-quoted or unquoted attribute. It is not a JavaScript, CSS or URL
 * sanitizer either — never use it to build a script, a style block, or an
 * `href`/`src` from untrusted input. It does not strip, reject or rewrite
 * anything, and stored or API values are never passed through it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
