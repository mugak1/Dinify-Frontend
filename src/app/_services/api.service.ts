import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
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
  postPatch(url: string, data: any,method:'get'|'post'|'put', id?:any, params?:{}, isFormData?: boolean,version?:string,has_false?:boolean){
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
    return this._http.delete(`${version?environment.apiUrl+'/api/'+version:this._base}/${url}`, {body: h}).pipe(e=>e);
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
  UserChangePasswordOnLogin(data: any) {
    const r = `${this._base}/users/auth/change-password/`;
    
    const l: any = {
      headers: new HttpHeaders({
       // Authorization: "Token " + token,
        Accept: "application/json, text/plain, */*"
      }),
      reportProgress: true,
      observe: "response"
    };
    return this._http.post(r, data, l).pipe(e=>e)
  }
  toFormData<T>(obj: T|any) {
    const formData = new FormData();

    Object.keys(obj).forEach(key => {
      const value = obj[key];
  
      if (value instanceof File) {
        formData.append(key, value);
      } else if (typeof value === 'object' && value !== null) {
        formData.append(key, value?.id || '');
      } else {
        formData.append(key, String(value));
      }
    });
  
    return formData;
  }
}

