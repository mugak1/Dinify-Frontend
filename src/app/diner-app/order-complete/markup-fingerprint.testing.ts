/**
 * Spec-only helper: a fingerprint of a component's RENDERED markup, used to
 * prove a screen is byte-for-byte what it was before a change.
 *
 * Normalised only for what is not the screen: comment nodes (Angular's
 * control-flow anchors, which move whenever a block is added beside the markup)
 * and the framework's generated attributes (`_ngcontent-*` / `_nghost-*`, whose
 * ids derive from the component's whole template, and dev-mode `ng-reflect-*`).
 * Every element, attribute, class, text node and SVG path is kept verbatim.
 */
export function normalizedMarkup(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^(_ngcontent-|_nghost-|ng-reflect-)/.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return clone.innerHTML;
}

/** FNV-1a (32-bit), hex — stable and dependency-free. */
export function fingerprint(markup: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < markup.length; i++) {
    h ^= markup.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
