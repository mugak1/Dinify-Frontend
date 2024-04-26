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
  
  get<T>(id: any,url: string, parameters = {}):Observable<ApiResponse<T>> {
    const l = this.correctFormatForQueryUrl(parameters);
    return this._http["get"](`${this._base}/${url}${id ? "/" + id : ""}${l}`) as any;
  }
  postPatch(url: string, data: any,method:'get'|'post'|'put', id?:string, params?:{}, isFormData?: boolean) {
    const d = this.correctFormatForQueryUrl(params);
      const h:any = Object.entries(data).reduce((y:{[key:string]:any}, [w, T]) => (T && (y[w] = T), y), {});
    return this._http[method](`${this._base}/${url}${id ? "/" + id : ""}${d}`, isFormData ? this.toFormData<any>(h) : h)
  }
  Delete(url: string, i: any, reason: string) {
    return this._http.delete(`${this._base}/${url}`, {body: {id: i, deletion_reason: reason }}).pipe(e=>e);
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
  UserChangePasswordOnLogin(data: any, token: any) {
    const r = `${this._base}/users/auth/change-password/`;
    
    let l: any = {
      headers: new HttpHeaders({
        Authorization: "Token " + token,
        Accept: "application/json, text/plain, */*"
      }),
      reportProgress: true,
      observe: "events"
    };
    return this._http.post(r, data, l)
  }
  toFormData<T>(formValue: T|any) {
    const formData = new FormData();

    for (const key of Object.keys(formValue)) {
      const value:any = formValue[key as keyof T];
      formData.append(key, value);
    }

    return formData;
  }
}

