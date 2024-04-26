import { Component } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from 'src/app/_services/api.service';

@Component({
  selector: 'app-menu-design',
  templateUrl: './menu-design.component.html',
  styleUrls: ['./menu-design.component.css']
})
export class MenuDesignComponent {
  ConfigForm!:FormGroup
  color = '#ff00ff';
  branding_configs={
    home:{
  bgColor:'#ffffff',
  headerColor:'#000000',
  headerShow:'text', //logo or text
  headerShowName:'Title',
  headerFontWeight:'800',
  headerCase:'uppercase',//lowercase or uppercase or capitalize
  viewMenuBgColor:'#000000',
  viewMenuTextColor:'#ffffff',
    }
  }
  coverfileName='';
  restaurant: any;
  rest:any;
  /**
   *
   */
  constructor(private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute) {
this.ConfigForm=this.fb.group({
  home:this.fb.group({
    bgColor:['#000000'],
    headerColor:['#ffffff'],
    headerShow:['text'], //logo or text
    headerShowName:['Title'],
    headerTextColor:['#ffffff'],
    headerFontWeight:['800'],
    headerCase:['uppercase'],//lowercase or uppercase or capitalize
    viewMenuBgColor:['#ffffff'],
    viewMenuTextColor:['#000000'],
      })
})
if(this.route.parent?.parent?.snapshot.params['id']){
  this.restaurant=this.route.parent?.parent?.snapshot.params['id'];
  this.loadRestaurant(this.restaurant);
}
    
  }
  get HomeForm (){
    return <FormGroup> this.ConfigForm.get('home')
  }
  InputCover($event:any){
    let fm = this.fb.group({
      id:[this.restaurant],
      cover_photo:[]
    })
    const file:File = $event.target.files[0];
    if (file) {

     
      fm.get('cover_photo')?.setValue(file as any);


  }
        this.api.postPatch('restaurant-setup/restaurants/',fm?.value,'put','',{},true).subscribe({
          next: ()=>{
    
    this.loadRestaurant(this.restaurant);
          }
         
          //console.log(x)
        })
  }
  DeleteCoverPhoto(){
    this.api.postPatch('restaurant-setup/restaurants/',{id:this.restaurant,cover_photo:'null'},'put').subscribe({
      next: ()=>{

this.loadRestaurant(this.restaurant);
      }
     
      //console.log(x)
    })
  }
  Save(){
  /*   let logo_field_type = typeof (this.ConfigForm?.get('cover_photo')?.value)
    if(logo_field_type=='string'){
      this.ConfigForm.get('cover_photo')?.setValue('')
    } */
        this.api.postPatch('restaurant-setup/restaurants/',{id:this.restaurant,branding_configuration:this.ConfigForm.value},'put').subscribe({
          next: ()=>{
    
    this.loadRestaurant(this.restaurant);
          }
         
          //console.log(x)
        })
      }
  loadRestaurant(id:string){
   
    this.api.get<any>(null,'restaurant-setup/'+(id?'details/':'restaurants/'),(id?{id:id,record:'restaurants'}:{})).subscribe((x)=>{
      
        console.log(x.data)
this.rest=x?.data as any;

if(Object.keys(this.rest.branding_configuration).length==0){
this.Save();
}else{
this.ConfigForm.patchValue(this.rest.branding_configuration);
}



    
      
    })
  }
}
