import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of, map } from 'rxjs';
import { ApiResponse, LoginResponse, OTPResponse, RestaurantDetail, RestaurantRole} from '../_models/app.models';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private userSubject: BehaviorSubject<LoginResponse | null>;
  public user: Observable<LoginResponse | null>;
  private _base = `${environment.apiUrl}/api/${environment.version}`;

  constructor(
      private router: Router,
      private http: HttpClient
  ) {
      this.userSubject = new BehaviorSubject(JSON.parse(localStorage.getItem('user')!));
      this.user = this.userSubject.asObservable();
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
              // store user details and jwt token in local storage to keep user logged in between page refreshes
              localStorage.setItem('user', JSON.stringify((response.data)));
              this.userSubject.next(response.data as any)
              return response;
          }));
  }
  updateProfile(profile:any){
    const u:any =this.userValue;
u.profile=profile;
localStorage.setItem('user', JSON.stringify((u)));
this.userSubject.next(u as any)
  }
  UpdateUser(otpResponse:OTPResponse){
const u:any = this.userValue;
u.refresh=otpResponse.refresh;
u.token=otpResponse.token;
localStorage.setItem('user', JSON.stringify((u)));
this.userSubject.next(u as any)
return u

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
   * Attempt a silent token refresh using the stored refresh token.
   *
   * BACKEND DEPENDENCY: This requires the backend to expose:
   *   POST /api/{version}/users/auth/token/refresh/
   *   Request:  { "refresh": "<refresh-token>" }
   *   Response: { "data": { "token": "<new-access>", "refresh": "<new-refresh>" } }
   *
   * Until the backend endpoint is confirmed, this method returns null
   * (triggering a logout in the error interceptor).
   *
   * To enable: uncomment the HTTP call below and remove the `of(null)` fallback.
   */
  attemptTokenRefresh(): Observable<string | null> {
    const user = this.userValue;
    if (!user?.refresh) {
      return of(null);
    }

    // --- Uncomment when backend refresh endpoint is confirmed ---
    // return this.http.post<ApiResponse<{ token: string; refresh: string }>>(
    //   `${this._base}/users/auth/token/refresh/`,
    //   { refresh: user.refresh }
    // ).pipe(
    //   map((response) => {
    //     const data = response.data;
    //     if (data?.token) {
    //       const updated = { ...user, token: data.token, refresh: data.refresh };
    //       localStorage.setItem('user', JSON.stringify(updated));
    //       this.userSubject.next(updated as any);
    //       return data.token;
    //     }
    //     return null;
    //   })
    // );

    // Fallback: refresh not yet available from backend
    return of(null);
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
