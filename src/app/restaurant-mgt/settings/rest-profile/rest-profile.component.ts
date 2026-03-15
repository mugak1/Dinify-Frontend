import { Component } from '@angular/core';
import { FormGroup, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { RestaurantList } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';

@Component({
  selector: 'app-rest-profile',
  templateUrl: './rest-profile.component.html',
  styleUrls: ['./rest-profile.component.css']
})
export class RestProfileComponent {
  showModal = false;
  restModal=false;
  rest?:RestaurantList;
  RestaurantForm!:FormGroup;
  is_submitted=false;
  fileName='';
  list?:RestaurantList[]=[];
  restaurant: any;

 
  constructor(public auth:AuthenticationService, private api:ApiService, private fb:FormBuilder,private route:ActivatedRoute, private dialog:ConfirmDialogService ) {
    this.RestaurantForm=this.initRestaurantForm();
    if(auth.currentRestaurantRole?.restaurant_id){
      this.restaurant=auth.currentRestaurantRole?.restaurant_id;
      this.loadRestaurant(this.restaurant);
    }else   if(this.route.parent?.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.parent?.snapshot.params['id'];
      this.loadRestaurant(this.restaurant);
    }
  }
  initRestaurantForm(){
    return this.fb.group({
      id:[''],
      name:['',Validators.required],
      location:['',Validators.required],
      logo:['',Validators.required],
      cover_photo:[''],
      status:['',Validators.required],
      require_order_prepayments:[false],
      expose_order_ratings:[false],
      allow_deliveries:[false],
      allow_pickups:[false],
      preferred_subscription_method:['surcharge'],
      order_surcharge_percentage:[0],
      flat_fee:[0]
    })
      }
  Save(){
    const logo_field_type = typeof (this.RestaurantForm?.get('logo')?.value)
    if(logo_field_type=='string'){
      this.RestaurantForm.get('logo')?.setValue('')
    }
        this.api.postPatch('restaurant-setup/restaurants/',this.RestaurantForm.value,this.RestaurantForm.get('id')?.value?'put':'post','',{},typeof (this.RestaurantForm?.get('logo')?.value)=='string'?false:true).subscribe({
          next: ()=>{
    //this.closeModal();
          }
         
          //console.log(x)
        }
        )
      }
      InputLogo($event:any){
        const file:File = $event.target.files[0];
        if (file) {
    
          this.fileName = file.name;
          this.RestaurantForm.get('logo')?.setValue(file);
    
    
      }
      }
      loadRestaurant(id:string){
   
        this.api.get<RestaurantList>(null,'restaurant-setup/'+(id?'details/':'restaurants/'),(id?{id:id,record:'restaurants'}:{})).subscribe((x)=>{
          
    this.rest=x?.data as any;
   this.RestaurantForm.patchValue(x?.data as any)
    
        
          
        })
      }
      typOf(val:any){
        return typeof val
      }

      Block(){
        const ref = this.dialog.openModal({
          title:'BLOCK',
          message:'Are you sure you want to <b>BLOCK</b> '+this.rest?.name+' from access to Dinify?',
          has_reason:true,
          cancelButtonText:'Cancel',
          submitButtonText: 'Block Account'
        })?.subscribe((x:any)=>{
        
          if(x?.action=='yes'){
            
         const o =   {
              "restaurant": this.restaurant,
              "decision": status,
              "reason": x?.reason
          } 
      /*   this.api.postPatch('restaurant-setup/manager-actions/first-time-menu-review/',o,'post').subscribe({
                next: (x:any)=>{
                  if(x?.status==200){          
            this.dialog.closeModal();
            ref.unsubscribe();
                  }
                }
              })*/  
             ref.unsubscribe(); 
            } 
          else if(x?.action=='no'||x?.action=='reject'){
            ref.unsubscribe();
            this.dialog.closeModal();
          }
          })
        }

}
