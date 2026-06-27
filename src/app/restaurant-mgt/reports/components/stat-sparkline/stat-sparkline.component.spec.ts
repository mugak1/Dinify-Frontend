import { ReportSparklineComponent } from './stat-sparkline.component';

// Pure (no TestBed): the sparkline only builds a chart.js dataset from its inputs;
// rendering the canvas is exercised by the cards that mount it.
describe('ReportSparklineComponent', () => {
  it('builds a single dataset from the values, with the given colour', () => {
    const c = new ReportSparklineComponent();
    c.values = [1, 4, 2, 8];
    c.color = 'hsl(142, 71%, 45%)';
    c.ngOnChanges();

    expect(c.data.datasets.length).toBe(1);
    expect(c.data.datasets[0].data).toEqual([1, 4, 2, 8]);
    expect(c.data.datasets[0].borderColor).toBe('hsl(142, 71%, 45%)');
    expect(c.data.labels?.length).toBe(4);
  });

  it('hides points, axes, legend and tooltip', () => {
    const c = new ReportSparklineComponent();
    expect(c.options.plugins?.legend?.display).toBeFalse();
    expect(c.options.plugins?.tooltip?.enabled).toBeFalse();
    expect((c.options.scales?.['x'] as { display?: boolean }).display).toBeFalse();
    expect((c.options.scales?.['y'] as { display?: boolean }).display).toBeFalse();
  });
});
