import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';

import { ConfirmaDialogData } from 'src/app/_models/app.models';
import { ConfirmDialogComponent } from './confirm-dialog.component';

/**
 * The dialog's three tones, rendered through its REAL template. The sibling spec swaps the
 * template out to test the pending lock; this one exists because the tone is presentation.
 *
 *   warning (absent)  — exactly as the dialog always looked: triangle + brand-red submit
 *   destructive       — losing work: no triangle, destructive submit
 *   neutral           — e.g. logging out: no triangle, the dialog's one primary submit
 */
describe('ConfirmDialogComponent (tones)', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;

  function render(data: ConfirmaDialogData): HTMLElement {
    fixture.componentInstance.data = data;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const triangle = (el: HTMLElement) => el.querySelector('div.bg-red-100 svg');
  const buttons = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('.bg-gray-50 button')) as HTMLButtonElement[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ConfirmDialogComponent],
      imports: [CommonModule, FormsModule],
    });
    fixture = TestBed.createComponent(ConfirmDialogComponent);
  });

  it('an absent tone renders exactly as before: the triangle and a brand-red submit', () => {
    const el = render({
      title: "You'll be logged out soon",
      message: 'Move your mouse to stay signed in.',
      submitButtonText: 'Stay signed in',
      cancelButtonText: 'Stay signed in',
    });
    expect(fixture.componentInstance.tone).toBe('warning');
    expect(triangle(el)).withContext('the warning triangle').not.toBeNull();
    const [submit] = buttons(el);
    expect(submit.className).toContain('bg-primary');
    expect(submit.className).not.toContain('bg-destructive');
  });

  it('destructive: no triangle, a destructive submit, and labels rendered verbatim', () => {
    const el = render({
      title: 'Discard changes?',
      message: 'You have unsaved changes that will be lost if you leave this page.',
      tone: 'destructive',
      submitButtonText: 'Discard changes',
      cancelButtonText: 'Keep editing',
    });
    expect(triangle(el)).toBeNull();
    const [submit, cancel] = buttons(el);
    expect(submit.className).toContain('bg-destructive');
    expect(submit.className).toContain('text-destructive-foreground');
    expect(submit.className).not.toContain('bg-primary');
    // Sentence case survives — the titlecase pipe would have printed "Discard Changes".
    expect(submit.textContent?.trim()).toBe('Discard changes');
    expect(cancel.textContent?.trim()).toBe('Keep editing');
  });

  it('neutral: no triangle and the dialog\'s one primary submit', () => {
    const el = render({
      title: 'Log out of Dinify?',
      message: 'You can sign back in at any time.',
      tone: 'neutral',
      submitButtonText: 'Log out',
    });
    expect(triangle(el)).toBeNull();
    const [submit, cancel] = buttons(el);
    expect(submit.className).toContain('bg-primary');
    expect(submit.className).not.toContain('bg-destructive');
    expect(submit.textContent?.trim()).toBe('Log out');
    expect(cancel.textContent?.trim()).toBe('Cancel');
  });

  it('CONTROL: the default labels read verbatim (OK / Cancel)', () => {
    const el = render({ title: 'Confirm', message: 'Sure?' });
    const [submit, cancel] = buttons(el);
    expect(submit.textContent?.trim()).toBe('OK');
    expect(cancel.textContent?.trim()).toBe('Cancel');
  });
});
