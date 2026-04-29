import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of, map, catchError } from 'rxjs';
import { ApiResponse, LoginResponse, OTPResponse, RestaurantDetail, RestaurantRole} from '../_models/app.models';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private userSubject: BehaviorSubject<LoginResponse | null>;
  public user: Observable<LoginResponse | null>;
  private _base = `${environment.apiUrl}/api/${environment.version}`;
  private rawHttp: HttpClient;

  constructor(
      private router: Router,
      private http: HttpClient,
      httpBackend: HttpBackend
  ) {
      this.userSubject = new BehaviorSubject(JSON.parse(localStorage.getItem('user')!));
      this.user = this.userSubject.asObservable();
      // Bypasses interceptors so refresh requests can't recurse through ErrorInterceptor.handle401.
      this.rawHttp = new HttpClient(httpBackend);
  }

  public get userValue() {
      return this.userSubject.value;
  }

  public get currentRestaurantRole(){
    return JSON.parse(localStorage.getItem('rest_role') as any) as unknown as RestaurantRole
  }
  public get currentRestaurant(){
    return JSON.parse(localStorage.getItem('current_resta') as any) as unknown as RestaurantDetail
  }

  login(username: string, password: string,source?:any) {
      return this.http.post<any>(`${this._base}/users/auth/login/`, source?{username,password,source}:{ username, password })
          .pipe(map((response:ApiResponse<LoginResponse>) => {
              const data = response.data as unknown as LoginResponse;
              if (!data.require_otp && !data.prompt_password_change) {
                // Only persist tokens when login is complete (no OTP/password-change pending)
                localStorage.setItem('user', JSON.stringify(data));
                this.userSubject.next(data as any);
              }
              return response;
          }));
  }
  updateProfile(profile:any){
    const u:any =this.userValue;
u.profile=profile;
localStorage.setItem('user', JSON.stringify((u)));
this.userSubject.next(u as any)
  }
  /**
   * Persist user after OTP verification.
   * Takes the original login response (which may not have been persisted if OTP
   * was required) and merges the real tokens from the verify-otp response.
   */
  UpdateUser(otpResponse:OTPResponse, loginResponse?: LoginResponse){
    const base: any = loginResponse || this.userValue;
    if (!base) return null;
    const u = { ...base, token: otpResponse.token, refresh: otpResponse.refresh };
    localStorage.setItem('user', JSON.stringify(u));
    this.userSubject.next(u as any);
    return u;
  }
  setOtp(user:any,otp:any){
    return this.http.post<any>(`${this._base}/users/auth/verify-otp/`,{ user,otp })
    .pipe(map((response:ApiResponse<OTPResponse>) => {
        // store user details and jwt token in local storage to keep user logged in between page refreshes
      //  localStorage.setItem('user', JSON.stringify((response.data)));
      //  this.userSubject.next(response.data as any)
        return response;
    }));
  }
 
  resendOtp(identification:any,identifier:any){
    return this.http.post<any>(`${this._base}/users/auth/resend-otp/`,{"identification": identification, "identifier": identifier,"purpose": 'login'})
    .pipe(map((response:ApiResponse<OTPResponse>) => {
        // store user details and jwt token in local storage to keep user logged in between page refreshes
      //  localStorage.setItem('user', JSON.stringify((response.data)));
      //  this.userSubject.next(response.data as any)
        return response;
    }));
  
  }
 
  setCurrentRestaurantRole(role:any){
    localStorage.setItem('rest_role', JSON.stringify((role)));    
  }
  setCurrentRestaurant(restaurant:any){
    localStorage.setItem('current_resta', JSON.stringify((restaurant)));    
  }

  resetStorage(){
    localStorage.removeItem('rest_role');
    localStorage.removeItem('current_resta');
    localStorage.removeItem('user');
  }

  /**
   * Silent access-token refresh.
   *
   * Backend endpoint is SimpleJWT's TokenRefreshView, which uses the native
   * top-level shape — NOT the wrapped `{data: ...}` envelope used elsewhere
   * in the Dinify API:
   *   POST /api/{version}/users/auth/token/refresh/
   *   Request:  { "refresh": "<refresh-token>" }
   *   Response: { "access": "<new-access-token>" }
   *
   * Assumes ROTATE_REFRESH_TOKENS = False on the backend, so only `access` is
   * returned and the stored refresh token is reused. If rotation is later
   * enabled, also persist `response.refresh` here.
   *
   * Uses HttpBackend (rawHttp) to bypass interceptors — otherwise a 401 from
   * this endpoint would re-enter ErrorInterceptor.handle401 and deadlock the
   * single-flight queue.
   *
   * Returns the new access token on success, or null on any failure. Never
   * calls logout(); that decision belongs to ErrorInterceptor.
   */
  attemptTokenRefresh(): Observable<string | null> {
    const user = this.userValue;
    if (!user?.refresh) {
      return of(null);
    }

    return this.rawHttp.post<{ access: string }>(
      `${this._base}/users/auth/token/refresh/`,
      { refresh: user.refresh }
    ).pipe(
      map((response) => {
        if (!response?.access) {
          return null;
        }
        const updated = { ...user, token: response.access };
        localStorage.setItem('user', JSON.stringify(updated));
        this.userSubject.next(updated as any);
        return response.access;
      }),
      catchError(() => of(null))
    );
  }

  logout(no_redirect?:boolean) {
      // remove user from local storage to log user out
      localStorage.removeItem('user');
      this.resetStorage();
      this.userSubject.next(null);
      if(!no_redirect){
      this.router.navigate(['/login']);
      }
  }
}
