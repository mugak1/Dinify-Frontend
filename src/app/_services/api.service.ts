import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, EMPTY, defer, of } from 'rxjs';
import { catchError, expand, map, reduce } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { ApiResponse } from '../_models/app.models';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  _base: string = `${environment.apiUrl}/api/${environment.version}`;
  constructor(private _http: HttpClient) { }

  get<T>(id: any,url: string, parameters = {},version?:any):Observable<ApiResponse<T>> {
    const l = this.correctFormatForQueryUrl(parameters);
    return this._http["get"](`${version?environment.apiUrl + '/api/' + version:this._base}/${url}${id ? "/" + id : ""}${l}`) as any;
  }

  /**
   * Fetches every page of a paginated list endpoint and emits the concatenated
   * records once. Honours the DinifyPaginator response shape:
   *   { data: { records: T[], pagination: { has_next, current_page, ... } } }
   *
   * If the response has no pagination block (single-resource or non-paginated
   * list endpoints), returns `data.records` if it is an array, else `data` if
   * it is an array, else an empty array — the caller stays unaware of paging.
   *
   * Pages are fetched sequentially. Sequential is correct here: page N's
   * has_next is what tells us whether to fetch page N+1, and parallel
   * speculative fetching would over-issue requests on the common short-list
   * case.
   *
   * The page number is tracked locally rather than read from
   * `pagination.current_page`. The backend's DinifyPaginator returns
   * `current_page` as a string (`request.GET.get('page')` without int
   * coercion), so reading it back and adding 1 yields `"1" + 1 === "11"`
   * — the previous regression. Keeping the counter in JS guarantees a
   * numeric increment regardless of backend type fidelity.
   *
   * Termination signals (any one stops the loop):
   *   - has_next === false on the canonical pagination block
   *   - records array is empty or shorter than page_size (we are past the
   *     real last page even if the backend says has_next: true)
   *   - MAX_PAGES hard cap reached (defensive guard against runaway loops)
   *   - a per-page request fails (the loop ends and partial data is returned)
   */
  loadAllPages<T>(
    url: string,
    parameters: Record<string, any> = {},
    version?: string,
  ): Observable<T[]> {
    // 50 pages * 25 records/page = 1250 records, well above any real menu.
    // If we ever cap, log loudly so the runaway can be diagnosed.
    const MAX_PAGES = 50;

    const fetchPage = (
      page: number,
    ): Observable<{ page: number; res: ApiResponse<T> | null }> =>
      this.get<T>(null, url, { ...parameters, page }, version).pipe(
        map((res) => ({ page, res: res as ApiResponse<T> | null })),
        catchError((err) => {
          console.warn(
            `[loadAllPages] ${url} page ${page} failed; ` +
              `returning partial data collected so far.`,
            err,
          );
          return of({ page, res: null });
        }),
      );

    return defer(() =>
      fetchPage(1).pipe(
        expand(({ page, res }) => {
          if (!res) return EMPTY;

          if (page >= MAX_PAGES) {
            console.warn(
              `[loadAllPages] ${url} hit MAX_PAGES cap (${MAX_PAGES}); ` +
                `returning collected records to guard against runaway pagination.`,
            );
            return EMPTY;
          }

          // Backend may surface pagination at data.pagination (DinifyPaginator)
          // or at the top level. Prefer the canonical location, fall back.
          const data: any = res.data;
          const pagination =
            data?.pagination ?? (res as any)?.pagination ?? null;

          if (!pagination || pagination.has_next !== true) return EMPTY;

          // Defensive: trust records over has_next. If the page came back
          // empty or under-filled, we are past the real last page no matter
          // what the flag says — this is the guard that stops a buggy
          // has_next: true from looping forever.
          // The DinifyPaginator surfaces page size as `page_size`; older
          // shapes used `records_per_page`, fall back for compatibility.
          const records: any[] = Array.isArray(data?.records) ? data.records : [];
          const pageSizeRaw = pagination?.page_size ?? pagination?.records_per_page;
          const pageSize = typeof pageSizeRaw === 'number'
            ? pageSizeRaw
            : Number(pageSizeRaw);
          if (records.length === 0) return EMPTY;
          if (Number.isFinite(pageSize) && pageSize > 0 && records.length < pageSize) {
            return EMPTY;
          }

          return fetchPage(page + 1);
        }),
        map(({ res }) => {
          if (!res) return [] as T[];
          const data: any = res.data;
          if (data && Array.isArray(data.records)) return data.records as T[];
          if (Array.isArray(data)) return data as T[];
          return [] as T[];
        }),
        reduce((acc, records) => acc.concat(records), [] as T[]),
      ),
    );
  }

  postPatch(url: string, data: any,method:'get'|'post'|'put', id?:any, params?:object, isFormData?: boolean,version?:string,_has_false?:boolean){
    const queryParams = this.correctFormatForQueryUrl(params);

  let payload: any;

  if (isFormData) {
    payload = this.toFormData(data);  // Don't reduce or filter FormData input
  } else {
    // Preserve all values except null and undefined.
    // The has_false flag kept all entries; without it the old code stripped
    // legitimate falsey values (false, 0, ""). Now the default behaviour is
    // safe for falsey values, and has_false is kept for backward compat.
    payload = Object.entries(data).reduce(
      (y: { [key: string]: any }, [w, T]) => {
        if (T !== null && T !== undefined) {
          y[w] = T;
        }
        return y;
      }, {});
  }

  return this._http[method](
    `${version ? environment.apiUrl + '/api/' + version : this._base}/${url}${id ? "/" + id : ""}${queryParams}`,
    payload
  );
  }
  Delete(url: string, data: any,version?:string) {
    const h:any = Object.entries(data).reduce((y:{[key:string]:any}, [w, T]) => {
      if (T !== null && T !== undefined) { y[w] = T; }
      return y;
    }, {});
    return this._http.delete(`${version?environment.apiUrl+'/api/'+version:this._base}/${url}`, {body: h}).pipe(_e=>_e);
  }
  postFileWithProgress(url: string, data: any) {
    return this._http.post(`${this._base}/${url}`, this.toFormData(data), {
      reportProgress: true,
      observe: "events"
    })
  }
  correctFormatForQueryUrl(url: any) {
    if (!url)
      return "";
    const i = this.mapQueryParamsToUrl(url);
    return 0 === i.length ? "" : `?${i.join("&")}`
  }
  mapQueryParamsToUrl(e: any) {
    return Object.keys(e).map(i => `${i}=${e[i]}`)
  }
  UserChangePasswordOnLogin(data: any, authToken?: string) {
    const r = `${this._base}/users/auth/change-password/`;

    const headers: any = { Accept: "application/json, text/plain, */*" };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    const l: any = {
      headers: new HttpHeaders(headers),
      reportProgress: true,
      observe: "response"
    };
    return this._http.post(r, data, l).pipe(_e=>_e)
  }
  toFormData<T>(obj: T|any) {
    const formData = new FormData();

    Object.keys(obj).forEach(key => {
      const value = obj[key];

      if (value === null || value === undefined) {
        return;
      }

      if (value instanceof File) {
        formData.append(key, value);
      } else if (Array.isArray(value)) {
        formData.append(key, JSON.stringify(value));
      } else if (typeof value === 'object') {
        formData.append(key, value.id ? String(value.id) : JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    });

    return formData;
  }
}

