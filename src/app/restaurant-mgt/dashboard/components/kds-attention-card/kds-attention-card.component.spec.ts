import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { KdsAttentionCardComponent } from './kds-attention-card.component';
import { getMockKdsData } from '../../data/dashboard-mock-data';

describe('KdsAttentionCardComponent — Open kitchen board link', () => {
  it('opens the Kitchen board in a new tab', async () => {
    await TestBed.configureTestingModule({
      imports: [KdsAttentionCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(KdsAttentionCardComponent);
    fixture.componentInstance.kdsData = getMockKdsData();
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[href="/kitchen"]')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
  });
});
