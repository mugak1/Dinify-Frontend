import { TestBed } from '@angular/core/testing';

import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmDialogService } from '../confirm-dialog.service';

// Exercises the class logic behind the "un-freeze" fix. The template (ngModel /
// *ngIf) is overridden away so we don't need CommonModule/FormsModule — the
// pending-state behaviour lives entirely in the component class.
describe('ConfirmDialogComponent (pending / un-freeze)', () => {
  let component: ConfirmDialogComponent;
  let service: ConfirmDialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ declarations: [ConfirmDialogComponent] });
    TestBed.overrideComponent(ConfirmDialogComponent, { set: { template: '' } });
    component = TestBed.createComponent(ConfirmDialogComponent).componentInstance;
    service = TestBed.inject(ConfirmDialogService);
  });

  it('locks the confirm action after the first confirm and emits "yes" only once', () => {
    component.openModal();
    expect(component.pending).toBeFalse();

    let emissions = 0;
    service.resultSub.subscribe(() => emissions++);
    const before = emissions; // BehaviorSubject fires its current value on subscribe

    component.toggleModal();
    expect(component.pending).toBeTrue();

    // A second tap while pending is a no-op — no duplicate 'yes'.
    component.toggleModal();
    expect(emissions - before).toBe(1);
  });

  it('resets pending each time the dialog re-opens', () => {
    component.toggleModal();
    expect(component.pending).toBeTrue();

    component.openModal();
    expect(component.pending).toBeFalse();
  });
});
