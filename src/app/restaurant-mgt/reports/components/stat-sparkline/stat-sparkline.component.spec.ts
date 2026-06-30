import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportSparklineComponent } from './stat-sparkline.component';

// Mounted via TestBed (not `new`) so inject(ElementRef) has an injection context:
// the sparkline resolves any var()-based borderColor against its host element before
// handing it to chart.js. Literal colours pass straight through unchanged.
describe('ReportSparklineComponent', () => {
  let fixture: ComponentFixture<ReportSparklineComponent>;
  let c: ReportSparklineComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportSparklineComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportSparklineComponent);
    c = fixture.componentInstance;
  });

  it('builds a single dataset from the values, with the given colour', () => {
    c.values = [1, 4, 2, 8];
    c.color = 'hsl(142, 71%, 45%)';
    c.ngOnChanges();

    expect(c.data.datasets.length).toBe(1);
    expect(c.data.datasets[0].data).toEqual([1, 4, 2, 8]);
    expect(c.data.datasets[0].borderColor).toBe('hsl(142, 71%, 45%)');
    expect(c.data.labels?.length).toBe(4);
  });

  it('hides points, axes, legend and tooltip', () => {
    expect(c.options.plugins?.legend?.display).toBeFalse();
    expect(c.options.plugins?.tooltip?.enabled).toBeFalse();
    expect((c.options.scales?.['x'] as { display?: boolean }).display).toBeFalse();
    expect((c.options.scales?.['y'] as { display?: boolean }).display).toBeFalse();
  });
});
