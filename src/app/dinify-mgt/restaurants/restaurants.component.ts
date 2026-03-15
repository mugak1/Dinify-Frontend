import { Component, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, NavigationStart, Router } from '@angular/router';
import { SearchCountryField, CountryISO, PhoneNumberFormat } from 'ngx-intl-telephone-input';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { Utilities } from 'src/app/_helpers/utilities';
import { RestaurantDetail, RestaurantList, User } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { MessageService } from 'src/app/_services/message.service';
import { environment } from 'src/environments/environment';


@Component({
  selector: 'app-restaurants',
  templateUrl: './restaurants.component.html',
  styleUrls: ['./restaurants.component.css'],
})
export class RestaurantsComponent implements OnDestroy {
  search:any='';
  require_otp=false;
  data='';
  showModal = false;
  restModal=false;
  rest?:RestaurantList|undefined;
 
  RestaurantForm!:FormGroup;
  is_submitted=false;
  fileName='';
  list?:RestaurantList[]=[];
  listCache?:RestaurantList[]=[]
  details: RestaurantList| undefined;
  detail_full?:RestaurantDetail;
  imageURL: string='';
  @ViewChild('photoUpload') InputLogo_field: ElementRef|any;
  baseUrl=environment.apiUrl;
  detailUser?:User;
  fileError: string = '';

  separateDialCode = false;
  SearchCountryField = SearchCountryField;
 // TooltipLabel = TooltipLabel;
  CountryISO = CountryISO;
  number_format = PhoneNumberFormat.National
  preferredCountries: CountryISO[] = [
    CountryISO.Uganda,
    CountryISO.Kenya
  ];
  selectedStatus:any='';
  /**
   *
   */
  constructor(private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute, private dialog:ConfirmDialogService,private router:Router,private message:MessageService) {
   router.events.subscribe((event: NavigationStart|any) => {
     if (event.navigationTrigger === 'popstate') {
      if(event.url==='/mgt-app/restaurants'){
        if(this.showModal){
        this.closeModal();
        }
      }
      // Perform actions
     }
   });
   this.route.firstChild?.url.subscribe(x=>{
    if(x==undefined||x?.length==0){
      this.closeModal()
    }
   })
  
  const sel_rest_id = this.route?.firstChild?.snapshot.params['id'];
         if(sel_rest_id){
        this.loadRestaurants(sel_rest_id)
      }else{
             this.loadRestaurants();
             if(this.showModal){
              // modal is already open, no action needed
             }

      }
   
    
  }

  toggleModal(val?:RestaurantList,view_rest?:boolean,detail?:any,nav?:any){
    if(view_rest){
      if(detail){
this.details=val;
this.api.get<RestaurantDetail>(null,'restaurant-setup/'+'details/',{id:val?.id,record:'restaurants'}).subscribe((x:any)=>{
  this.detail_full=x.data
})
      }else{
       this.restModal=true;
this.rest=val; 
      }

    }else{
        this.RestaurantForm=this.initRestaurantForm();
        this.RestaurantForm.get('logo')?.setValidators([]);
        this.RestaurantForm.get('logo')?.updateValueAndValidity();
    if(val){
      
      this.RestaurantForm.get('first_name')?.setValidators([]);
      this.RestaurantForm.get('last_name')?.setValidators([]);
      this.RestaurantForm.get('email')?.setValidators([]);
      this.RestaurantForm.get('phone_number')?.setValidators([]);
      this.RestaurantForm.get('first_name')?.updateValueAndValidity();
      this.RestaurantForm.get('last_name')?.updateValueAndValidity();
      this.RestaurantForm.get('email')?.updateValueAndValidity();
      this.RestaurantForm.get('phone_number')?.updateValueAndValidity();
     this.loadRestaurants(val.id,true);
      
    }  
    }
    this.showModal = !this.showModal;
    if (this.showModal) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
  if(nav){
    this.router.navigate(['rest-app',val?.id],{relativeTo:this.route})
  }
  }
  typOf(val:any){
    return typeof val
  }
  closeModal(){
    this.rest=undefined;
    this.details=undefined;
    this.RestaurantForm=null!;
    if(this.restModal){
      this.restModal=false;
      if(this.list?.length==0)this.loadRestaurants();
    }    
    this.showModal = !this.showModal;
    this.router.navigate(['/mgt-app/restaurants'])
    this.require_otp=false;
    if(this.InputLogo_field){
    this.InputLogo_field.nativeElement.value='';
    }
    this.imageURL='';
    this.fileName='';
    this.detailUser=undefined;
  }
  initRestaurantForm(){
return this.fb.group({
  id:[''],
  name:['',[Validators.required,Validators.minLength(5)]],
  location:['',[Validators.required,Validators.minLength(5)]],
  logo:['',Validators.required],
  status:[''],
  'first_name': ['',[Validators.required,Validators.minLength(2)]],
  'last_name': ['',[Validators.required,Validators.minLength(2)]],  
  email:['',[Validators.email,Validators.required,Validators.minLength(5)]],
  'phone_number': ['',Validators.required],
  phone:[''],
  'country': ['UG'],
  preferred_subscription_method:['per_order'],
  order_surcharge_percentage:[0.0],
  flat_fee:[0],
  order_surcharge_cap_amount:[0],
  order_surcharge_min_amount:[0],
  otp:['']
})
  }

  InputLogo($event:any){
    this.fileError='';
    const file:File = $event.target.files[0];
    if (file) {
      const validImageTypes = ['image/jpeg', 'image/png', 'image/gif'];
      if (!validImageTypes.includes(file.type)) {
        this.fileError = 'Only image files (JPG, PNG, GIF) are allowed.';
        $event.target.value = ''; // Clear the input if the file is invalid
      } else {
      this.fileName = file.name;
      this.RestaurantForm.get('logo')?.setValue(file);
      const reader = new FileReader();
      reader.onload = () => {
        this.imageURL = reader.result as string;
      }
      reader.readAsDataURL(file)
    }

  }
  }

  ViewRest(l:RestaurantList){
    if(l.status=='active'|| l.status=='inactive'){
      this.toggleModal(l,true,null,'nav');
    }

  }
  Save(){
const logo_field_type = typeof (this.RestaurantForm?.get('logo')?.value)
if(logo_field_type=='string'){
  this.RestaurantForm.get('logo')?.setValue('')
}
//if(this.RestaurantForm.get('id')?.value){
    this.api.postPatch(this.RestaurantForm.get('id')?.value?'restaurant-setup/restaurants/':'restaurant-setup/admin-register-restaurant/',this.RestaurantForm.value,this.RestaurantForm.get('id')?.value?'put':'post','',{},typeof (this.RestaurantForm?.get('logo')?.value)=='string'?false:true).subscribe({
      next: ()=>{
this.closeModal();
this.loadRestaurants();
      }
     
      //console.log(x)
    })
  /*}else{
    if(this.data&&this.require_otp){
      this.RestaurantForm.get('otp')?.setValue(this.data);
      this.api.postPatch(this.RestaurantForm.get('id')?.value?'restaurant-setup/restaurants/':'restaurant-setup/admin-register-restaurant/',this.RestaurantForm.value,this.RestaurantForm.get('id')?.value?'put':'post','',{},typeof (this.RestaurantForm?.get('logo')?.value)=='string'?false:true).subscribe({
        next: (x:any)=>{
          let res=x?.data;
          if(x.status==200){
            this.message.add(x.message);
            this.closeModal();
              //this.router.navigate(['/diner','payment-details',res.transaction_id])
            this.loadRestaurants(); 
           //window.location.href=res.redirect_url; 
          }
         // 
        console.log(x);
        }
      })
    }else{
    this.api.get<any>(null,'users/msisdn-lookup/?msisdn='+this.RestaurantForm.get('phone_number')?.value).subscribe((x)=>{
      if(x.status==400){
this.sendOtp('msisdn',this.RestaurantForm?.get('phone_number')?.value,null);
      }else if(x.status==200){
       
        this.api.postPatch(this.RestaurantForm.get('id')?.value?'restaurant-setup/restaurants/':'restaurant-setup/admin-register-restaurant/',this.RestaurantForm.value,this.RestaurantForm.get('id')?.value?'put':'post','',{},typeof (this.RestaurantForm?.get('logo')?.value)=='string'?false:true).subscribe({
        next: (xm:any)=>{
          let res=xm?.data;
          if(x.status==200){
            this.message.add(xm.message);
            this.loadRestaurants();
            this.closeModal();
              //this.router.navigate(['/diner','payment-details',res.transaction_id])
            
           //window.location.href=res.redirect_url; 
          }
         // 
        console.log(x);
        }
      })
      }    
    })
  }
  }*/
  }
  Search(term:any){
    this.list=this.listCache?.filter(r=>Utilities.searchArray(term,false,r.name));
  }
  loadRestaurants(id?:string,patch?:boolean){
    
    this.api.get<RestaurantList>(null,'restaurant-setup/'+(id?'details/':'restaurants/'),(id?{id:id,record:'restaurants'}:(this.selectedStatus?{status:this.selectedStatus}:{}))).subscribe((x:any)=>{
      if(id){
this.rest=x?.data as any;


if(patch){
  this.RestaurantForm.patchValue(this.rest as any);
}else{

  this.toggleModal(this.rest as RestaurantList,true);
}



      }else{
      this.list=x?.data?.records  
      this.listCache = x?.data?.records
      }
      
    })
  }
  fetchRestaurantsByStatus(_status: string) {
    this.api.get<RestaurantList>(null,'restaurant-setup/restaurants/',this.selectedStatus?{status:this.selectedStatus}:{}).subscribe((x:any)=>{
      this.list=x?.data?.records  
      this.listCache = x?.data?.records
    });
  }
  changeApprovalStatus(status:string,statusToset:any,rest:RestaurantList){
    const ref = this.dialog.openModal({
       title:status.toUpperCase(),
       submitButtonText:status.toUpperCase(),
       message:'Are you sure you want to '+status.toUpperCase()+' the client <strong>'+rest.name+'</strong> ?'
     })?.subscribe((x:any)=>{
       if(x?.action=='yes'){
        
        this.api.postPatch('restaurant-setup/restaurants/',{id:rest.id,status:statusToset},'put').subscribe({
             next: ()=>{
         this.loadRestaurants();
         this.dialog.closeModal();
              ref.unsubscribe();
             }
           });
            
             //console.log(x)
           }
       
     })

   
    }
    onInputChange($event:any){
      this.RestaurantForm.get('phone')?.setValue($event);
      this.RestaurantForm.get('phone_number')?.setValue(String($event.phoneNumber).replace('+','').replace(/\s/g, ""));
      this.RestaurantForm.get('country')?.setValue(String($event.iso2Code).toUpperCase())
      if($event.isNumberValid){
      this.api.get<any>(null,'users/user-lookup/?contact='+this.RestaurantForm.get('phone_number')?.value).subscribe((x)=>{
        if(x.status==400){ /* no user found - no action needed */ }
        else if(x.status==200){
          this.detailUser=x.data as any as User;
          this.RestaurantForm.get('first_name')?.setValidators([]);
          this.RestaurantForm.get('last_name')?.setValidators([]);
          this.RestaurantForm.get('email')?.setValidators([]);
          this.RestaurantForm.get('phone_number')?.setValidators([]);
          this.RestaurantForm.get('first_name')?.updateValueAndValidity();
          this.RestaurantForm.get('last_name')?.updateValueAndValidity();
          this.RestaurantForm.get('email')?.updateValueAndValidity();
          this.RestaurantForm.get('phone_number')?.updateValueAndValidity();
          //this.sendOtp('msisdn',this.RestaurantForm?.get('phone_number')?.value,null);
        }else{
          this.detailUser=undefined;
          this.RestaurantForm.get('first_name')?.setValidators([Validators.required,Validators.minLength(2)]);
          this.RestaurantForm.get('last_name')?.setValidators([Validators.required,Validators.minLength(2)]);
          this.RestaurantForm.get('email')?.setValidators([Validators.email,Validators.required,Validators.minLength(5)]);
          //this.RestaurantForm.get('phone_number')?.setValidators([]);
          this.RestaurantForm.get('first_name')?.updateValueAndValidity();
          this.RestaurantForm.get('last_name')?.updateValueAndValidity();
          this.RestaurantForm.get('email')?.updateValueAndValidity();
         // this.RestaurantForm.get('phone_number')?.updateValueAndValidity();
        }
      });
      }else{
        this.detailUser=undefined;
        this.RestaurantForm.get('first_name')?.setValidators([Validators.required,Validators.minLength(2)]);
        this.RestaurantForm.get('last_name')?.setValidators([Validators.required,Validators.minLength(2)]);
        this.RestaurantForm.get('email')?.setValidators([Validators.email,Validators.required,Validators.minLength(5)]);
        //this.RestaurantForm.get('phone_number')?.setValidators([]);
        this.RestaurantForm.get('first_name')?.updateValueAndValidity();
        this.RestaurantForm.get('last_name')?.updateValueAndValidity();
        this.RestaurantForm.get('email')?.updateValueAndValidity();
       // this.RestaurantForm.get('phone_number')?.updateValueAndValidity();
      }
       }
      
       sendOtp(identification:any,identifier:any,purpose:any,send_message?:any){
        this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose, skip_auth:'yes'},'post').subscribe((x:any)=>{
          this.require_otp=true 
          // store user details and jwt token in local storage to keep user logged in between page refreshes
          //  localStorage.setItem('user', JSON.stringify((response.data)));
          //  this.userSubject.next(response.data as any)
           if(send_message){
            this.message.add(x?.message);
           } 
        });
      }
      public static searchArray(searchTerm: string, caseSensitive: boolean, ...values: any[]) {
        if (!searchTerm) {
          return true;
        }
    
        let filter = searchTerm.trim();
        let data = values.join();
    
        if (!caseSensitive) {
          filter = filter.toLowerCase();
          data = data.toLowerCase();
        }
    
        return data.indexOf(filter) != -1;
      }
       // Ensure cleanup when the component is destroyed
  ngOnDestroy(): void {
    document.body.classList.remove('overflow-hidden');
  }
}
