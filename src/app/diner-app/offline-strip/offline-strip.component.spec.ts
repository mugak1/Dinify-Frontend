import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OfflineStripComponent } from './offline-strip.component';
import { DinerConnectivityService } from '../diner-connectivity.service';

describe('OfflineStripComponent', () => {
  let fixture: ComponentFixture<OfflineStripComponent>;
  // A real writable signal stands in for the service so the template reacts to
  // flips exactly as it would in production.
  const offline = signal(false);

  beforeEach(async () => {
    offline.set(false);
    await TestBed.configureTestingModule({
      imports: [OfflineStripComponent],
      providers: [
        { provide: DinerConnectivityService, useValue: { isOffline: offline.asReadonly() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OfflineStripComponent);
    fixture.detectChanges();
  });

  it('renders nothing while online', () => {
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('shows the calm offline strip with the reconnect copy when offline', () => {
    offline.set(true);
    fixture.detectChanges();

    const strip: HTMLElement | null = fixture.nativeElement.querySelector('[role="status"]');
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain("You're offline");
    expect(strip!.textContent).toContain('place your order once you reconnect');
    // Calm, not alarm-red.
    expect(strip!.className).toContain('bg-amber-50');
  });

  it('hides again on reconnect', () => {
    offline.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();

    offline.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
});
