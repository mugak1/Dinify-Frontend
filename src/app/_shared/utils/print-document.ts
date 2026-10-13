/**
 * Write a self-contained print document into a popup the CALLER has already
 * opened, and print it once the popup has finished loading.
 *
 * WHY THE OPENER RUNS THE LIFECYCLE. The print documents used to end in an
 * inline `<script>` that printed (and closed) the popup on load. A popup opened
 * with `window.open('', '_blank')` is `about:blank`, which inherits the
 * opener's Content Security Policy, so under any `script-src` that does not
 * allow inline script the browser refuses that script and nothing prints. Here
 * the document carries no script at all: the opener listens for the popup's
 * `load` event and calls `print()` itself. The popup is same-origin, so the
 * opener may do both.
 *
 * WHAT `load` WAITS FOR. The window's load event fires after the document and
 * its images have loaded or failed, so an image that errors does not stop the
 * print, and one that never answers stops it exactly as the old inline handlers
 * did. The print documents reference no web fonts.
 *
 * THE ORDER IS LOAD-BEARING. `document.open()` removes every event listener on
 * the document and on its window, and `document.write()` on a loaded document
 * performs that open implicitly. So the document is opened explicitly FIRST and
 * the listener is attached after it, before the markup is written; attached
 * earlier, it would be erased and nothing would print.
 *
 * WHAT THE CALLER KEEPS. Opening the popup synchronously inside the click (so
 * the popup blocker allows it), handling a blocked popup, and encoding every
 * dynamic value in `html` stay with the caller. This writes `html` verbatim.
 *
 * Returns false, writing nothing, when the popup has already been closed: the
 * operator closed it while the document was being prepared, and there is
 * nothing left to print.
 */
export function printDocument(
  printWindow: Window,
  html: string,
  options: { closeAfterPrint: boolean },
): boolean {
  if (printWindow.closed) return false;

  const doc = printWindow.document;
  doc.open();
  printWindow.addEventListener('load', () => {
    printWindow.print();
    if (options.closeAfterPrint) printWindow.close();
  });
  doc.write(html);
  doc.close();
  return true;
}
