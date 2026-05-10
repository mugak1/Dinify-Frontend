import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';

@Component({
    selector: 'app-branding',
    templateUrl: './branding.component.html',
    styleUrls: ['./branding.component.css'],
    standalone: false
})
export class BrandingComponent {
  ConfigForm!:FormGroup
  restaurant: any;
  rest:any;

  constructor(private auth:AuthenticationService, private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute) {
if(auth.currentRestaurantRole?.restaurant_id){
  this.restaurant=auth.currentRestaurantRole?.restaurant_id;
  this.loadRestaurant(this.restaurant,true);

}else if(this.route.parent?.parent?.snapshot.params['id']){
  this.restaurant=this.route.parent?.parent?.snapshot.params['id'];
  this.loadRestaurant(this.restaurant,true);
}

  }
  get HomeForm (){
    return <FormGroup> this.ConfigForm?.get('home')
  }

  Save(){
        this.api.postPatch('restaurant-setup/restaurants/',{id:this.restaurant,branding_configuration:this.ConfigForm.value},'put').subscribe({
          next: ()=>{

    this.loadRestaurant(this.restaurant);
          }

          //console.log(x)
        })
      }
  loadRestaurant(id:string,load_form?:boolean){

    this.api.get<any>(null,'restaurant-setup/'+(id?'details/':'restaurants/'),(id?{id:id,record:'restaurants'}:{})).subscribe((x)=>{

this.rest=x?.data as any;
if(load_form){
 this.ConfigForm=this.fb.group({
  home:this.fb.group({
    brand_color: ['#171717', [Validators.required]],
  })
})
}

if(Object.keys(this.rest.branding_configuration).length==0){
this.Save();
}else{
this.ConfigForm.patchValue(this.rest.branding_configuration);
}




    })
  }
}
