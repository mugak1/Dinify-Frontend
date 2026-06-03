import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
} from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { getMockTickets } from '../mock/kitchen-mock-data';
import { BoardComponent } from './board.component';

describe('BoardComponent', () => {
  let fixture: ComponentFixture<BoardComponent>;

  beforeEach(async () => {
    const apiStub = {
      get: jasmine.createSpy('get').and.callFake(() =>
        of({ status: 200, data: { records: getMockTickets() } })),
      postPatch: jasmine.createSpy('postPatch').and.returnValue(of({})),
    };
    const authStub = {
      userValue: {
        profile: { restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] }] },
      },
    };

    await TestBed.configureTestingModule({
      imports: [BoardComponent],
      providers: [
        { provide: ApiService, useValue: apiStub },
        { provide: AuthenticationService, useValue: authStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardComponent);
  });

  it('creates and renders the chrome', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Kitchen');
    expect(text).toContain('Enable sound');
    fixture.destroy();
  });

  it('renders the active ticket set after the first poll', fakeAsync(() => {
    fixture.detectChanges(); // ngOnInit → startPolling() → first poll (sync stub)
    fixture.detectChanges(); // render the cards from the populated signal

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('app-kitchen-ticket-card');
    expect(cards.length).toBeGreaterThan(0);

    fixture.destroy();       // ngOnDestroy → stopPolling()
    discardPeriodicTasks();  // clear the 1s age ticker
  }));
});
