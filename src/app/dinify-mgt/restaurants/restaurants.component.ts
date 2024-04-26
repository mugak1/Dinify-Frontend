import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiResponse, RestaurantList } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

@Component({
  selector: 'app-restaurants',
  templateUrl: './restaurants.component.html',
  styleUrls: ['./restaurants.component.css']
})
export class RestaurantsComponent {
  showModal = false;
  restModal=false;
  rest?:RestaurantList;
  RestaurantForm!:FormGroup;
  is_submitted=false;
  fileName='';
  list?:RestaurantList[]=[];


  /**
   *
   */
  constructor(private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute) {
   
    console.log(this.route?.firstChild?.snapshot.params['id'])
  let sel_rest_id = this.route?.firstChild?.snapshot.params['id']
         if(sel_rest_id){
        this.loadRestaurants(sel_rest_id)
      }
        this.loadRestaurants(); 
    
  }
  
  toggleModal(val?:RestaurantList,view_rest?:boolean){
    if(view_rest){
this.restModal=true;
this.rest=val;
    }else{
        this.RestaurantForm=this.initRestaurantForm();
        this.RestaurantForm.get('logo')?.setValidators([]);
        this.RestaurantForm.get('logo')?.updateValueAndValidity();
    if(val){
      this.RestaurantForm.patchValue(val);
      
    }  
    }
    this.showModal = !this.showModal;
  
  }
  typOf(val:any){
    return typeof val
  }
  closeModal(){
    this.rest=undefined;
    this.RestaurantForm=null!;
    if(this.restModal){
      this.restModal=false;
      if(this.list?.length==0)this.loadRestaurants();
    }    
    this.showModal = !this.showModal;
  }
  initRestaurantForm(){
return this.fb.group({
  id:[''],
  name:['',Validators.required],
  location:['',Validators.required],
  logo:['',Validators.required],
  status:['']
})
  }

  InputLogo($event:any){
    const file:File = $event.target.files[0];
    if (file) {

      this.fileName = file.name;
      this.RestaurantForm.get('logo')?.setValue(file);


  }
  }
  Save(){
let logo_field_type = typeof (this.RestaurantForm?.get('logo')?.value)
if(logo_field_type=='string'){
  this.RestaurantForm.get('logo')?.setValue('')
}
    this.api.postPatch('restaurant-setup/restaurants/',this.RestaurantForm.value,this.RestaurantForm.get('id')?.value?'put':'post','',{},typeof (this.RestaurantForm?.get('logo')?.value)=='string'?false:true).subscribe({
      next: ()=>{
this.closeModal();
this.loadRestaurants();
      }
     
      //console.log(x)
    })
  }
  loadRestaurants(id?:string){
    
    this.api.get<RestaurantList>(null,'restaurant-setup/'+(id?'details/':'restaurants/'),(id?{id:id,record:'restaurants'}:{})).subscribe((x)=>{
      if(id){
this.rest=x?.data as any;
this.toggleModal(this.rest,true);

      }else{
      this.list=x?.data?.records  
      }
      
    })
  }
}
