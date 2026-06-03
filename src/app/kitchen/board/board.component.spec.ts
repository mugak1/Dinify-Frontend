import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';

import { BoardComponent } from './board.component';

describe('BoardComponent', () => {
  let fixture: ComponentFixture<BoardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BoardComponent] }).compileComponents();
    fixture = TestBed.createComponent(BoardComponent);
  });

  it('creates and renders the chrome', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Kitchen');
    expect(text).toContain('Enable sound');
    fixture.destroy();
  });

  it('renders the mock ticket set after load', fakeAsync(() => {
    fixture.detectChanges(); // ngOnInit → loadActive()
    tick(400); // resolve the mock delay
    fixture.detectChanges();

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('app-kitchen-ticket-card');
    expect(cards.length).toBeGreaterThan(0);

    fixture.destroy();
    discardPeriodicTasks(); // clear the 1s age ticker
  }));

  it('cycles the connection state via the dev control', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.service.connectionState()).toBe('connected');
    component.cycleConnection();
    expect(component.service.connectionState()).toBe('reconnecting');
    component.cycleConnection();
    expect(component.service.connectionState()).toBe('offline');
    component.cycleConnection();
    expect(component.service.connectionState()).toBe('connected');
    fixture.destroy();
  });
});
