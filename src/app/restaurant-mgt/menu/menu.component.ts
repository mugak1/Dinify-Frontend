import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { MenuItem, MenuSectionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.css']
})
export class MenuComponent {
showModal=false;
is_submitted=false;
CategoryForm?:FormGroup|null;
ItemForm?:FormGroup|null;
fileName: string='';
restaurant:string='';
imageURL: string='';

section?:MenuSectionListItem;
section_list?:MenuSectionListItem[]|any=[];

menu_list?:MenuItem[]=[];
menu_item:any;
/**
 *
 */
constructor(private fb:FormBuilder, private api:ApiService, private route:ActivatedRoute, private dialog:ConfirmDialogService) {

  if(this.route.parent?.snapshot.params['id']){
    this.restaurant=this.route.parent?.snapshot.params['id'];
    this.loadSections();
  }


}

initCategory(rest:string){
  return this.fb.group({
    id:[''],
    name:[''],
    restaurant:[rest],
    description:[''],
    section_banner_image:[''],
    available:[true]
  })
}
 initMenuItem(){
  return this.fb.group({
    id:[''],
    name:['',Validators.required],
    section:['',Validators.required],
    description:[''],
    image:[''],
    primary_price:[0,[Validators.min(1)]],
    discounted_price:[0],
    running_discount:[0],
    available:[true]
  })
 }

 loadSections(id?:string){
  this.api.get<MenuSectionListItem>(null,'restaurant-setup/menusections/',{restaurant:this.restaurant}).subscribe((x)=>{
    if(id){
this.section=x?.data?.records[0];
    }else{
      
    this.section_list =x?.data?.records  
    if(!this.section){
      this.section=this.section_list[0]
        this.loadMenuItems(this.section_list[0].id)
    }
    }
    
  })
 }
 loadMenuItems(section:string,id?:string){
  
    this.api.get<MenuItem>(null,'restaurant-setup/menuitems/',{section:section}).subscribe((x)=>{
      if(id){
  this.menu_item=x?.data?.records[0];
      }else{
        
      this.menu_list =x?.data?.records 
    }
    })

 }
 SectionAvailabilityChange(event:any,s:MenuSectionListItem){
 
this.dialog.openModal(
  {
    title:'CONFIRMATION',
message:"Are you sure you want to change the availability of "+s.name+ " to "+(s.available?"not available":"available") +" ?",

})
 }
toggleCategoryModal(){
  this.CategoryForm=this.initCategory(this.restaurant);
  this.showModal=!this.showModal
}
SaveSection(){
  let image_field_type = typeof (this.CategoryForm?.get('section_banner_image')?.value)
  if(image_field_type=='string'){
    this.CategoryForm?.get('section_banner_image')?.setValue('');
  }
      this.api.postPatch('restaurant-setup/menusections/',this.CategoryForm?.value,this.CategoryForm?.get('id')?.value?'put':'post','',{},typeof (this.CategoryForm?.get('section_banner_image')?.value)=='string'?false:true).subscribe({
        next: ()=>{
  this.closeModal();
  this.loadSections();
        }
       
        //console.log(x)
      })
}
closeModal(){
  this.CategoryForm=null;
  this.ItemForm=null;
  this.showModal = !this.showModal;
}
InputLogo($event:any){
  const file:File = $event.target.files[0];
  if (file) {

    this.fileName = file.name;
    this.CategoryForm?.get('section_banner_image')?.setValue(file);


}
}

toggleMenuIemModal(){
  this.ItemForm=this.initMenuItem();
  this.showModal=!this.showModal
}
SaveMenuItem(){
  let image_field_type = typeof (this.ItemForm?.get('image')?.value)
  if(image_field_type=='string'){
    this.ItemForm?.get('image')?.setValue('');
  }
      this.api.postPatch('restaurant-setup/menuitems/',this.ItemForm?.value,this.ItemForm?.get('id')?.value?'put':'post','',{},typeof (this.ItemForm?.get('image')?.value)=='string'?false:true).subscribe({
        next: ()=>{
  this.closeModal();
  this.loadMenuItems(this.section?.id as string)
        }
       
        //console.log(x)
      })
}
InputItemImage($event:any){
  const file:File = $event.target.files[0];
  
  if (file) {

    this.fileName = file.name;
    this.ItemForm?.get('image')?.setValue(file);
    const reader = new FileReader();
    reader.onload = () => {
      this.imageURL = reader.result as string;
    }
    reader.readAsDataURL(file)

  }
}
}
