import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportPlaceholderComponent } from './report-placeholder.component';

describe('ReportPlaceholderComponent', () => {
  let component: ReportPlaceholderComponent;
  let fixture: ComponentFixture<ReportPlaceholderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportPlaceholderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportPlaceholderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the under-construction state', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain("We're still building this report");
  });
});
