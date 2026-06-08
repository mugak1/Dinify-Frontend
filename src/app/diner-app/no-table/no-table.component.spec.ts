import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoTableComponent } from './no-table.component';
import { SessionStorageService } from '../../_services/storage/session-storage.service';

describe('NoTableComponent', () => {
  let fixture: ComponentFixture<NoTableComponent>;
  let component: NoTableComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoTableComponent],
      providers: [
        { provide: SessionStorageService, useValue: { getItem: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NoTableComponent);
    component = fixture.componentInstance;
  });

  it('shows the default scan guidance when no message is provided', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Scan to Start Your Order');
    expect(text).toContain('scan the QR code');
  });

  it('shows the provided message under an error heading', () => {
    component.message =
      "This table isn't available right now — please ask a member of staff.";
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("We couldn't open this table");
    expect(text).toContain('please ask a member of staff');
    expect(text).not.toContain('Scan to Start Your Order');
  });
});
