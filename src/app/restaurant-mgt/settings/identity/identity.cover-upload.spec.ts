/**
 * The cover photo reaches the server as an image, not as JSON text.
 *
 * browser-image-compression declares `Promise<File>` but returns a `Blob` with
 * `name` and `lastModified` assigned to it. `ApiService.toFormData` sends a value
 * as a file part only when it is a `File`; any other object is JSON-stringified.
 * So a cover above the 200 KiB skip threshold went out as the text
 * `{"name":"…","lastModified":…}` in place of the photo.
 *
 * These specs drive the component through the REAL RestaurantIdentityService and
 * ApiService and read the multipart body the request actually carries, because
 * the defect sat between the component and the wire: a spy on `uploadImages`
 * accepted the Blob exactly as it accepted a File. Only the compressor is
 * substituted, with output shaped the way the library shapes it.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { IdentityComponent } from './identity.component';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { RestaurantDetail } from 'src/app/_models/app.models';

type Compressor = (file: File, options: object) => Promise<Blob>;

const KIB = 1024;

/** The options the component passes today; this change must not move them. */
const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1280,
  useWebWorker: true,
  initialQuality: 0.85,
  fileType: 'image/jpeg',
};

function detail(): RestaurantDetail {
  return {
    id: 'r1',
    name: 'The Lawns',
    location: 'Nakasero',
    logo: '',
    cover_photo: null,
    tagline: '',
    cuisine_types: [],
    contact_phone: '',
    contact_email: '',
    landmark: '',
    socials: { instagram: '', facebook: '', x: '', tiktok: '' },
    branding_configuration: { home: {} },
  } as unknown as RestaurantDetail;
}

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

async function contentOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('IdentityComponent — the cover photo on the wire', () => {
  let component: IdentityComponent;
  let http: HttpTestingController;
  let compressor: jasmine.Spy<Compressor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IdentityComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']) },
        { provide: AuthenticationService, useValue: { currentRestaurantRole: { restaurant_id: 'r1' } } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(IdentityComponent);
    component = fixture.componentInstance;
    compressor = jasmine.createSpy<Compressor>('imageCompression');
    (component as unknown as { imageCompression: Compressor }).imageCompression = compressor;

    component.ngOnInit();
    flushDetail();
    expect(component.loadState).toBe('ready');
  });

  afterEach(() => http.verify());

  async function pick(file: File): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    await component.onPickImage({ target: input } as unknown as Event);
  }

  function flushDetail(): void {
    http
      .expectOne((r) => r.method === 'GET' && r.url.includes('restaurant-setup/details/'))
      .flush({ status: 200, data: detail() });
  }

  /** Saves, and returns the cover part of the multipart PUT that went out. */
  function saveAndReadCover(): FormDataEntryValue | null {
    component.onSave();
    const req = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('restaurant-setup/restaurants/'));
    const body = req.request.body;
    expect(body instanceof FormData).withContext('the image upload is multipart').toBeTrue();
    expect((body as FormData).get('id')).toBe('r1');
    const cover = (body as FormData).get('cover_photo');
    req.flush({ status: 200 });
    flushDetail(); // a successful save re-reads the restaurant
    return cover;
  }

  it('REGRESSION: a compressed cover is sent as a file part carrying the compressed bytes', async () => {
    const original = photo('cover.jpg', 'image/jpeg', 300 * KIB);
    const compressed = bytes(40 * KIB, 99);
    compressor.and.callFake(async (file) => libraryOutput(compressed, file));

    await pick(original);
    const staged = (component as unknown as { coverFile?: unknown }).coverFile;
    expect(staged instanceof File).withContext('the staged cover is a File').toBeTrue();

    const cover = saveAndReadCover();
    expect(typeof cover).not.toBe('string');
    expect(cover instanceof File).withContext('the multipart value is a file part').toBeTrue();
    const part = cover as File;
    expect(part.type).toBe('image/jpeg');
    expect(part.name).toBe('cover.jpg');
    expect(part.size).toBe(compressed.length);
    expect(await contentOf(part)).toEqual(compressed);
  });

  it('REGRESSION: a PNG compressed to JPEG goes out under a .jpg name', async () => {
    const original = photo('Terrace View.png', 'image/png', 900 * KIB);
    compressor.and.callFake(async (file) => libraryOutput(bytes(60 * KIB, 3), file));

    await pick(original);
    const part = saveAndReadCover() as File;

    expect(part instanceof File).toBeTrue();
    expect(part.name).toBe('Terrace View.jpg');
    expect(part.type).toBe('image/jpeg');
  });

  it('CONTRACT: a .jpeg name is kept as it is', async () => {
    const original = photo('front.JPEG', 'image/jpeg', 500 * KIB);
    compressor.and.callFake(async (file) => libraryOutput(bytes(50 * KIB, 5), file));

    await pick(original);
    expect((saveAndReadCover() as File).name).toBe('front.JPEG');
  });

  it('CONTRACT: a name without an extension, or with nothing before it, gets a .jpg name', async () => {
    compressor.and.callFake(async (file) => libraryOutput(bytes(50 * KIB, 4), file));

    for (const [picked, sent] of [['photo', 'photo.jpg'], ['.png', 'cover.jpg']]) {
      await pick(photo(picked, 'image/png', 500 * KIB));
      expect((saveAndReadCover() as File).name).withContext(picked).toBe(sent);
    }
  });

  it('CONTRACT: compression is asked for with the options it had before this change', async () => {
    const original = photo('cover.jpg', 'image/jpeg', 300 * KIB);
    compressor.and.callFake(async (file) => libraryOutput(bytes(40 * KIB, 1), file));

    await pick(original);

    expect(compressor).toHaveBeenCalledOnceWith(original, COMPRESSION_OPTIONS);
    saveAndReadCover();
  });

  it('CONTROL: a cover at or under 200 KiB is sent as the original file, uncompressed', async () => {
    const original = photo('small.jpg', 'image/jpeg', 200 * KIB);

    await pick(original);

    expect(compressor).not.toHaveBeenCalled();
    expect(saveAndReadCover()).toBe(original);
  });

  it('CONTROL: output that is not smaller keeps the original file', async () => {
    const original = photo('already-small.jpg', 'image/jpeg', 250 * KIB);
    compressor.and.callFake(async (file) => libraryOutput(bytes(250 * KIB, 2), file));

    await pick(original);

    expect(saveAndReadCover()).toBe(original);
  });

  it('CONTROL: a compression failure keeps the original file', async () => {
    const original = photo('odd.jpg', 'image/jpeg', 400 * KIB);
    compressor.and.rejectWith(new Error('decode failed'));

    await pick(original);

    expect(saveAndReadCover()).toBe(original);
  });
});
