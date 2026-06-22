import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { RolePermissionsService, parseGrid } from './role-permissions.service';

describe('RolePermissionsService', () => {
  let service: RolePermissionsService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    const apiSpy = jasmine.createSpyObj('ApiService', ['get', 'postPatch']);
    TestBed.configureTestingModule({
      providers: [
        RolePermissionsService,
        { provide: ApiService, useValue: apiSpy },
      ],
    });
    service = TestBed.inject(RolePermissionsService);
    api = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
  });

  describe('getGrid', () => {
    it('GETs role-permissions/ scoped by restaurant and parses res.data into rows', (done) => {
      api.get.and.returnValue(of({
        data: [
          { role: 'owner', editable: false, modules: { dashboard: true, menu: true } },
          { role: 'manager', editable: true, modules: { dashboard: true, menu: false } },
        ],
      } as any));

      service.getGrid('rest-1').subscribe((rows) => {
        expect(api.get).toHaveBeenCalledWith(null, 'role-permissions/', { restaurant: 'rest-1' });
        expect(rows.length).toBe(2);
        expect(rows[0]).toEqual({ role: 'owner', editable: false, modules: { dashboard: true, menu: true } });
        expect(rows[1].editable).toBeTrue();
        done();
      });
    });
  });

  describe('saveRole', () => {
    it('PUTs {restaurant, role, modules} to role-permissions/', () => {
      api.postPatch.and.returnValue(of({ status: 200 } as any));
      const modules = { dashboard: true, menu: false };

      service.saveRole('rest-1', 'manager', modules).subscribe();

      expect(api.postPatch).toHaveBeenCalledWith(
        'role-permissions/',
        { restaurant: 'rest-1', role: 'manager', modules },
        'put',
      );
    });
  });

  describe('parseGrid (defensive envelope)', () => {
    const rows = [{ role: 'manager', editable: true, modules: { menu: true } }];

    it('accepts a bare array', () => {
      expect(parseGrid(rows).length).toBe(1);
    });
    it('accepts a {records:[…]} envelope', () => {
      expect(parseGrid({ records: rows })[0].role).toBe('manager');
    });
    it('accepts a {roles:[…]} envelope', () => {
      expect(parseGrid({ roles: rows })[0].role).toBe('manager');
    });
    it('accepts a role-keyed object and reads the permissions alias', () => {
      const parsed = parseGrid({ manager: { editable: true, permissions: { menu: true } } });
      expect(parsed[0]).toEqual({ role: 'manager', editable: true, modules: { menu: true } });
    });
    it('coerces editable, defaults modules, and drops malformed rows', () => {
      const parsed = parseGrid([{ role: 'manager' }, { editable: true }, null]);
      expect(parsed.length).toBe(1);
      expect(parsed[0]).toEqual({ role: 'manager', editable: false, modules: {} });
    });
    it('returns [] for null/garbage', () => {
      expect(parseGrid(null)).toEqual([]);
      expect(parseGrid(undefined)).toEqual([]);
    });
  });
});
