/**
 * The menu item image: what is compressed, with what, and what reaches the save.
 *
 * The dialog had no compression coverage. These specs drive `onFileSelected` with
 * real `File`s and substitute only the compressor, shaped the way the library
 * shapes its output (a Blob carrying `name` and `lastModified`). Where the
 * library's worker loads its own code is asserted here as an option the dialog
 * passes; that the URL serves a working library is asserted by
 * image-compression-lib-url.spec.ts, against the real file and a real worker.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ItemFormDialogComponent } from './item-form-dialog.component';
import { MenuService } from '../../services/menu.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { imageCompressionLibUrl } from 'src/app/_shared/utils/image-compression-lib-url';

type Compressor = (file: File, options: object) => Promise<Blob>;

const KIB = 1024;

/** The options the dialog passes; identical to the cover photo's. */
const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1280,
  useWebWorker: true,
  libURL: imageCompressionLibUrl(),
  initialQuality: 0.85,
  fileType: 'image/jpeg',
};

function bytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

function photo(name: string, type: string, length: number): File {
  return new File([bytes(length, 7)], name, { type, lastModified: 1_790_000_000_000 });
}

/** What the library resolves with: a Blob carrying the original's name and time. */
function libraryOutput(content: Uint8Array<ArrayBuffer>, original: File): Blob {
  const out = new Blob([content], { type: 'image/jpeg' });
  return Object.assign(out, { name: original.name, lastModified: original.lastModified });
}

describe('ItemFormDialogComponent — the item image', () => {
  let fixture: ComponentFixture<ItemFormDialogComponent>;
  let component: ItemFormDialogComponent;
  let compressor: jasmine.Spy<Compressor>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    toast = jasmine.createSpyObj('ToastService', ['error', 'success', 'info']);
    await TestBed.configureTestingModule({
      imports: [ItemFormDialogComponent],
      providers: [
        { provide: MenuService, useValue: { sections$: of([]), extras$: of([]) } },
        { provide: ToastService, useValue: toast },
        { provide: AuthenticationService, useValue: { currentRestaurantRole: { restaurant_id: 'rest-1' } } },
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemFormDialogComponent);
    component = fixture.componentInstance;
    component.sectionId = 'sec-1';
    fixture.detectChanges();
    compressor = jasmine.createSpy<Compressor>('imageCompression');
    (component as unknown as { imageCompression: Compressor }).imageCompression = compressor;
    spyOn(console, 'error'); // the dialog logs a compression failure
  });

  async function pick(file: File): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    await component.onFileSelected({ target: input } as unknown as Event);
  }

  const staged = () => component.form.get('image')?.value as unknown;

  /** Saves a valid item and returns the image the saved payload carries. */
  function saveAndReadImage(): unknown {
    let payload: Record<string, unknown> | undefined;
    component.saved.subscribe((p: Record<string, unknown>) => (payload = p));
    component.form.patchValue({ name: 'Test Item', section: 'sec-1', primary_price: 10000 });
    component.onSubmit();
    expect(payload).withContext('the dialog emitted a save').toBeDefined();
    return payload!['image'];
  }

  it('CONTRACT: compression is asked for with the cover photo\'s options, the library from this origin', async () => {
    const original = photo('dish.jpg', 'image/jpeg', 300 * KIB);
    compressor.and.callFake(async (file) => libraryOutput(bytes(40 * KIB, 1), file));

    await pick(original);

    expect(compressor).toHaveBeenCalledOnceWith(original, COMPRESSION_OPTIONS);
    const { libURL } = compressor.calls.mostRecent().args[1] as { libURL: string };
    expect(new URL(libURL).origin).toBe(location.origin);
    expect(libURL).not.toContain('jsdelivr');
  });

  it('REGRESSION: a PNG compressed to JPEG is saved as a .jpg File carrying the compressed bytes', async () => {
    const compressed = bytes(60 * KIB, 3);
    compressor.and.callFake(async (file) => libraryOutput(compressed, file));

    await pick(photo('Grilled Tilapia.png', 'image/png', 900 * KIB));
    const image = saveAndReadImage();

    expect(image instanceof File).withContext('the saved image is a File').toBeTrue();
    const file = image as File;
    expect(file.name).toBe('Grilled Tilapia.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(compressed);
  });

  it('CONTRACT: the dialog reports it is compressing until the library answers', async () => {
    let answer!: (b: Blob) => void;
    compressor.and.returnValue(new Promise<Blob>((resolve) => (answer = resolve)));
    const original = photo('dish.jpg', 'image/jpeg', 300 * KIB);

    const picking = pick(original);
    expect(component.isCompressing).toBeTrue();
    answer(libraryOutput(bytes(40 * KIB, 1), original));
    await picking;

    expect(component.isCompressing).toBeFalse();
  });

  it('CONTROL: an image at or under 200 KiB is staged as the original file, uncompressed', async () => {
    const original = photo('small.jpg', 'image/jpeg', 200 * KIB);

    await pick(original);

    expect(compressor).not.toHaveBeenCalled();
    expect(staged()).toBe(original);
  });

  it('CONTROL: output that is not smaller keeps the original file', async () => {
    const original = photo('already-small.jpg', 'image/jpeg', 250 * KIB);
    compressor.and.callFake(async (file) => libraryOutput(bytes(250 * KIB, 2), file));

    await pick(original);

    expect(staged()).toBe(original);
  });

  it('CONTROL: a compression failure says so and keeps the original file', async () => {
    const original = photo('odd.jpg', 'image/jpeg', 400 * KIB);
    compressor.and.rejectWith(new Error('decode failed'));

    await pick(original);

    expect(staged()).toBe(original);
    expect(toast.error).toHaveBeenCalledWith('Could not compress image; uploading original (may be slow).');
    expect(component.isCompressing).toBeFalse();
  });

  it('CONTROL: a type the dialog does not accept is refused before compression', async () => {
    await pick(photo('dish.webp', 'image/webp', 300 * KIB));

    expect(compressor).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Image must be JPEG, PNG, or GIF.');
  });
});
