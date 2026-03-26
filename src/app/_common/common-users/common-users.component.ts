import { AfterViewInit, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { CountryISO, PhoneNumberFormat, SearchCountryField } from 'ngx-intl-telephone-input';
import { EmployeeListUser } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { ConfirmDialogService } from '../confirm-dialog.service';
import { Utilities } from 'src/app/_helpers/utilities';

@Component({
    selector: 'app-common-users',
    templateUrl: './common-users.component.html',
    styleUrl: './common-users.component.css',
    standalone: false
})
export class CommonUsersComponent implements AfterViewInit {
@Input() users?:EmployeeListUser[];
@Input() restaurant:any;
@Input() cache?:EmployeeListUser[]
details:EmployeeListUser|undefined;
showModal=false;
is_submitted=false;
user_id:any;
checked=false;
RegisterForm:FormGroup=this.fb.group({
  first_name: [""],
  last_name: [""],
  phone:[''],
  phone_number: [""],
  password: [''],
  country: [""],
  email:[''],
  roles:[],
  role:['']
});

EditForm?:FormGroup;

@Output() save= new EventEmitter<any>();

roles=[    
  'owner',
  'manager',
 /*  'RESTAURANT_STAFF', */
  'kitchen',
  'waiter',
  'finance'
]
  usersCache?:EmployeeListUser[]=[];
  search:string=''

/* 'RESTAURANT_OWNER': 'owner',
'RESTAURANT_MANAGER': 'manager',
'RESTAURANT_STAFF': 'restaurant_staff',
'RESTAURANT_KITCHEN': 'kitchen',
'RESTAURANT_WAITER': 'waiter',
'RESTAURANT_FINANCE': 'finance',
'DINER': 'diner' */
constructor(private fb:FormBuilder,private api:ApiService,private dialog:ConfirmDialogService) {
    
}

ngAfterViewInit(): void {
  if(this.users){
  this.usersCache=[...this.users];//Object.assign([],this.users);
  }
}

separateDialCode = false;
SearchCountryField = SearchCountryField;
// TooltipLabel = TooltipLabel;
CountryISO = CountryISO;
number_format = PhoneNumberFormat.National
preferredCountries: CountryISO[] = [
  CountryISO.Uganda,
  CountryISO.Kenya
];
initRegisterForm(){
  return this.fb.group({
    first_name: [''],
    last_name: [''],
    phone:[''],
    phone_number: [''],
    password: [''],
    country: ["UG"],
    email:[''],
    roles:[''],
    role:['']
   
  })
}
Register(){
  if(this.user_id&& this.checked){

this.api.postPatch('restaurant-setup/employees/',{"user": this.user_id,
    "restaurant": this.restaurant,roles:[this.RegisterForm.get('roles')?.value]},'post').subscribe(x=>{
      this.save.emit(x);
      this.closeModal();
      })
  }else if(!this.user_id&&this.checked){
    const val =this.RegisterForm.value
    val.roles=[this.RegisterForm.get('roles')?.value];
    val.restaurant=this.restaurant;
   this.api.postPatch((this.restaurant?'restaurant-setup/create-employee/':'users/auth/register/'),val,'post').subscribe(x=>{
//this.LookUp()
//this.save.emit(x);
this.save.emit(x);
      this.closeModal();
}) 
  }else if(!this.checked){
    this.LookUp();
  }

}
onInputChange($event:any){
this.RegisterForm.get('phone')?.setValue($event);
this.RegisterForm.get('phone_number')?.setValue(String($event.phoneNumber).replace('+','').replace(/\s/g, ""));
this.RegisterForm.get('country')?.setValue(String($event.iso2Code).toUpperCase())
}
closeModal(){
  this.showModal=false
  this.user_id=null;
  this.checked=false;
  this.RegisterForm=null as any;
  this.EditForm=null as any;
  this.details=null as any;
}
removeUnderscore(x:string){
  return x.replace(/_/g," ").replace('RESTAURANT','');
}
LookUp(){
  this.api.get<any>(null,'users/user-lookup/?contact='+this.RegisterForm.get('phone_number')?.value).subscribe((x)=>{
    //this.users=x.data?.records as any
    if(x.status==400){
      this.user_id=null;
      this.checked=true;
    }else if(x.status==200){
      this.user_id=(<any>x.data)?.id
      this.checked=true;
    }
  })
}
NewUser(){
  this.RegisterForm= this.initRegisterForm();
  this.showModal=true;
}
Edit(user:EmployeeListUser){
  let role=null;
  if(user.roles.length>0){
role=user.roles[0];
  }
this.EditForm= this.fb.group({
  name:[user.name],
  id:[user.id],
  restaurant:[this.restaurant],
  roles: [role],
  active:[user.active]
})

this.showModal=true;
}
View(user:EmployeeListUser){
  this.details=user;
  this.showModal=true;
}
SaveEdit(){
  this.api.postPatch('restaurant-setup/employees/',{"id": this.EditForm?.get('id')?.value,
    roles:[this.EditForm?.get('roles')?.value],active:this.EditForm?.get('active')?.value},'put').subscribe(x=>{
      this.closeModal();
      this.save.emit(x)
      }) 
}
DeleteUser(user:EmployeeListUser){
  const ref = this.dialog.openModal({
    title:'Delete',
    has_reason:true,
    submitButtonText:'Delete',
    cancelButtonText:'Cancel',
    reason_required:true,
    action_info:'This user will no longer have access to this restaurant',
    message:'Are you sure you want to <strong>Delete</strong> '+user.name +'? <br> Please provide the reason for deleting the user',
  })?.subscribe((x:any)=>{
    if(x?.action=='yes'){
      this.api.postPatch('restaurant-setup/employees/',{id:user.id,deletion_reason:x?.reason,active:'false'},'put','',{},false,'',true).subscribe({
        next: ()=>{
    this.save.emit(x)
    
    this.dialog.closeModal();
    ref.unsubscribe();
        },
        error:(_err)=>{
        }
      });
      //this.dialog.closeModal();
    }
    if(x?.action=='no'||x?.action=='reject'){
      
      this.dialog.closeModal();
      ref.unsubscribe();
    }

    
  });


}
Search(term:any){
  this.users=this.cache?.filter(r=>Utilities.searchArray(term,false,r.name));
}
public searchArray(searchTerm: string, caseSensitive: boolean, ...values: any[]) {
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

}
