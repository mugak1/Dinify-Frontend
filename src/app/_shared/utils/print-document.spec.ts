import { printDocument } from './print-document';

/** A 1×1 transparent GIF: an image that loads. */
const GOOD_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Not an image at all: one that fails. */
const BROKEN_IMAGE = 'data:image/png;base64,AAAA';

/**
 * printDocument runs in the OPENER, against a same-origin popup. The specs use
 * a real same-origin frame for the parts that depend on the browser (when
 * `load` fires, and what `document.open()` erases), and a fake popup for the
 * call order, which a real frame cannot record.
 */
describe('printDocument', () => {
  let frame: HTMLIFrameElement;

  beforeEach(() => {
    frame = document.createElement('iframe');
    document.body.appendChild(frame);
  });

  afterEach(() => frame.remove());

  /** What the document looked like at the moment print() was called. */
  interface PrintMoment {
    readyState: DocumentReadyState;
    title: string;
    images: { complete: boolean; loaded: boolean }[];
  }

  /**
   * Replace the frame's print() and close() with recorders. They are own
   * properties of the frame's Window, which `document.open()` keeps (it erases
   * listeners, not properties), so they survive the write.
   */
  function record(win: Window): { printed: Promise<PrintMoment>; print: jasmine.Spy; close: jasmine.Spy } {
    let resolve!: (m: PrintMoment) => void;
    const printed = new Promise<PrintMoment>(r => (resolve = r));
    const print = spyOn(win, 'print').and.callFake(() =>
      resolve({
        readyState: win.document.readyState,
        title: win.document.title,
        images: Array.from(win.document.images).map(img => ({
          complete: img.complete,
          loaded: img.naturalWidth > 0,
        })),
      }),
    );
    const close = spyOn(win, 'close');
    return { printed, print, close };
  }

  function within<T>(p: Promise<T>, ms = 3000): Promise<T | 'timed out'> {
    return Promise.race([p, new Promise<'timed out'>(r => setTimeout(() => r('timed out'), ms))]);
  }

  it('prints a real document once it has loaded, after its images have loaded or failed', async () => {
    const win = frame.contentWindow!;
    const rec = record(win);

    const written = printDocument(
      win,
      `<!DOCTYPE html><html><head><title>Sheet &amp; co</title></head><body>
        <img src="${GOOD_IMAGE}" alt="good"><img src="${BROKEN_IMAGE}" alt="broken">
      </body></html>`,
      { closeAfterPrint: true },
    );

    expect(written).toBeTrue();
    const moment = await within(rec.printed);
    expect(moment).not.toBe('timed out');
    const m = moment as PrintMoment;
    expect(m.readyState).toBe('complete');
    expect(m.title).toBe('Sheet & co');
    expect(m.images).toEqual([
      { complete: true, loaded: true },
      { complete: true, loaded: false },
    ]);
    expect(rec.print).toHaveBeenCalledTimes(1);
    expect(rec.close).toHaveBeenCalledTimes(1);
    expect(rec.print).toHaveBeenCalledBefore(rec.close);
  });

  it('leaves the popup open when asked to', async () => {
    const win = frame.contentWindow!;
    const rec = record(win);

    printDocument(win, '<!DOCTYPE html><title>Sheet</title><p>x</p>', { closeAfterPrint: false });

    expect(await within(rec.printed)).not.toBe('timed out');
    expect(rec.print).toHaveBeenCalledTimes(1);
    expect(rec.close).not.toHaveBeenCalled();
  });

  it('writes the markup verbatim and adds no script', async () => {
    const win = frame.contentWindow!;
    const rec = record(win);
    const body = '<p class="t">Café &quot;Ndiizi&quot; &lt;b&gt;</p>';

    printDocument(win, `<!DOCTYPE html><title>t</title>${body}`, { closeAfterPrint: false });
    await within(rec.printed);

    expect(win.document.querySelector('.t')!.textContent).toBe('Café "Ndiizi" <b>');
    expect(win.document.querySelectorAll('script').length).toBe(0);
  });

  /**
   * PREMISE for the order printDocument follows, and for the fake popup the
   * call-site specs use: in this browser, `document.open()` erases a `load`
   * listener the window already had. If this ever stops being true the order
   * stops mattering, but nothing else here changes.
   */
  it('PREMISE: document.open() erases a load listener attached before it', async () => {
    const win = frame.contentWindow!;
    let before = 0;
    let after = 0;
    win.addEventListener('load', () => before++);
    win.document.open();
    win.addEventListener('load', () => after++);
    win.document.write('<!DOCTYPE html><title>t</title><p>x</p>');
    win.document.close();

    await within(new Promise(r => win.addEventListener('load', r)));

    expect(before).toBe(0);
    expect(after).toBe(1);
  });

  describe('call order (fake popup)', () => {
    function fakePopup(closed = false) {
      const calls: string[] = [];
      const win = {
        closed,
        document: {
          open: () => calls.push('open'),
          write: () => calls.push('write'),
          close: () => calls.push('close'),
        },
        addEventListener: (type: string) => calls.push(`listen:${type}`),
        print: () => calls.push('print'),
        close: () => calls.push('windowClose'),
      };
      return { win: win as unknown as Window, calls };
    }

    it('opens the document, then listens for load, then writes, then closes the document', () => {
      const { win, calls } = fakePopup();

      expect(printDocument(win, '<p>x</p>', { closeAfterPrint: true })).toBeTrue();

      expect(calls).toEqual(['open', 'listen:load', 'write', 'close']);
    });

    it('writes nothing and returns false when the popup has already been closed', () => {
      const { win, calls } = fakePopup(true);

      expect(printDocument(win, '<p>x</p>', { closeAfterPrint: true })).toBeFalse();

      expect(calls).toEqual([]);
    });
  });
});
