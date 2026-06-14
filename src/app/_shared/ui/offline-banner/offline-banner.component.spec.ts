import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OfflineBannerComponent } from './offline-banner.component';
import { ConnectivityService } from '../../../_services/connectivity.service';

describe('OfflineBannerComponent', () => {
  let fixture: ComponentFixture<OfflineBannerComponent>;
  // A real writable signal stands in for the service so the template reacts to
  // flips exactly as it would in production.
  const offline = signal(false);

  beforeEach(async () => {
    offline.set(false);
    await TestBed.configureTestingModule({
      imports: [OfflineBannerComponent],
      providers: [
        { provide: ConnectivityService, useValue: { isOffline: offline.asReadonly() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OfflineBannerComponent);
    fixture.detectChanges();
  });

  it('renders nothing while online', () => {
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('shows the amber offline banner with the check-connection copy when offline', () => {
    offline.set(true);
    fixture.detectChanges();

    const banner: HTMLElement | null = fixture.nativeElement.querySelector('[role="status"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("You're offline");
    expect(banner!.textContent).toContain('check your connection');
    // Calm amber status, not alarm-red.
    expect(banner!.className).toContain('bg-amber-50');
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
