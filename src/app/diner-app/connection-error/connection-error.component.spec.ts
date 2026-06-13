import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DinerConnectionErrorComponent } from './connection-error.component';

describe('DinerConnectionErrorComponent', () => {
  let fixture: ComponentFixture<DinerConnectionErrorComponent>;
  let component: DinerConnectionErrorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DinerConnectionErrorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DinerConnectionErrorComponent);
    component = fixture.componentInstance;
  });

  it('renders the calm headline, guidance, and a Try again button', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain("We couldn't load this page");
    expect(text).toContain('try again');
    const button = el.querySelector('button');
    expect(button?.textContent).toContain('Try again');
  });

  it('shows the restaurant name only when provided', () => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Test Bistro');

    component.restaurantName = 'Test Bistro';
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Test Bistro');
  });

  it('emits retry when the button is clicked', () => {
    const retrySpy = jasmine.createSpy('retry');
    component.retry.subscribe(retrySpy);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();

    expect(retrySpy).toHaveBeenCalledTimes(1);
  });
});
