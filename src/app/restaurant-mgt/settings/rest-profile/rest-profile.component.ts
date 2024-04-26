import { Component } from '@angular/core';
import { FormGroup, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RestaurantList } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

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

 
  constructor(private api:ApiService, private fb:FormBuilder,private route:ActivatedRoute ) {
    this.RestaurantForm=this.initRestaurantForm();
    
    if(this.route.parent?.parent?.snapshot.params['id']){
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
    let logo_field_type = typeof (this.RestaurantForm?.get('logo')?.value)
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
          
            console.log(x.data)
    this.rest=x?.data as any;
   this.RestaurantForm.patchValue(x?.data as any)
    
        
          
        })
      }
      typOf(val:any){
        return typeof val
      }
}
