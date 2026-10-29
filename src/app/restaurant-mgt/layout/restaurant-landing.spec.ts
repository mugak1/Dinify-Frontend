import { landingPathFor } from './restaurant-landing';

describe('landingPathFor — the one landing rule after a restaurant change (SHELL-FINISH-00 PR 3)', () => {
  const all = { dashboard: true, menu: true, tables: true, reviews: true, reports: true, settings: true, kitchen: true, team: true, billing: true };
  const owner: any = { restaurant_id: 'r1', restaurant: 'A', roles: ['owner'], permissions: all };
  const noReports: any = { restaurant_id: 'r2', restaurant: 'B', roles: ['manager'], permissions: { ...all, reports: false } };
  const kitchenOnly: any = {
    restaurant_id: 'r3', restaurant: 'C', roles: ['kitchen'],
    permissions: { dashboard: false, menu: false, tables: false, reviews: false, reports: false, settings: false, kitchen: true, team: false, billing: false },
  };

  it('keeps the same top-level page when the new membership can open it', () => {
    expect(landingPathFor('/menu', owner)).toBe('/menu');
    expect(landingPathFor('/dining-tables', owner)).toBe('/dining-tables');
    expect(landingPathFor('/reports/sales', owner)).toBe('/reports');
  });

  it('drops deeper paths, query strings and fragments: they carry restaurant-specific ids', () => {
    expect(landingPathFor('/reviews/feed?review=abc#x', owner)).toBe('/reviews');
    expect(landingPathFor('/settings/team/members?id=9', owner)).toBe('/settings');
  });

  it('falls back to the first accessible route when the page is not open to the new membership', () => {
    expect(landingPathFor('/reports?from=2026-01-01', noReports)).toBe('/dashboard');
    expect(landingPathFor('/menu', kitchenOnly)).toBe('/kitchen');
  });

  it('keeps the pages every member may open', () => {
    for (const page of ['support', 'account', 'notifications']) {
      expect(landingPathFor(`/${page}`, kitchenOnly)).toBe(`/${page}`);
    }
  });

  it('an unknown or empty segment uses the first accessible route', () => {
    expect(landingPathFor('/', noReports)).toBe('/dashboard');
    expect(landingPathFor('/rest-app-ordering', owner)).toBe('/dashboard');
  });

  it('no membership (signed out in another tab) lands on /login', () => {
    expect(landingPathFor('/menu', null)).toBe('/login');
    expect(landingPathFor('/menu', undefined)).toBe('/login');
    expect(landingPathFor('/menu', { restaurant_id: '' } as any)).toBe('/login');
  });
});
