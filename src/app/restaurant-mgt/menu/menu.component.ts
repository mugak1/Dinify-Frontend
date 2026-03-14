import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { ApiResponse, MenuItem, MenuSectionListItem, RestaurantDetail } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.css']
})
export class MenuComponent {
  ObjectRef = Object;
  @ViewChild('hasGroups') hasGroups!: ElementRef;
minimise_approval=true;
showModal=false;
is_submitted=false;
CategoryForm?:FormGroup;
CategoryGroupForm?:FormGroup;
ItemForm?:FormGroup;
fileName: string='';
restaurant:string='';
imageURL: string='';

today: string;


section?:MenuSectionListItem;
section_list:MenuSectionListItem[]=[];
section_groups:any[]=[];
has_groups=false;

menu_list?:MenuItem[]|any[]=[];
extra_list?:MenuItem[]|any[]=[];
search_list?:MenuItem[]|any[]=[];
grouped_menu:any;
item_groups:any[]=[];
menu_item:any;

tabs_list=[ 'details','options','extras','discounts'];
active_tab=this.tabs_list[0]
  group_menu_keys: string[]=[];
  grouped_groups: { [key: string]: any } = {};
  temp_extra:any;
  temp_extra_list:any[]=[];

  view_menu=false;
  restaurant_profile?:RestaurantDetail;
  is_new: boolean=false;
  days_of_week=['mon','tue','wed','thu','fri','sat','sun']
  searchQuery: string = '';
  isExpanded: boolean = false;
  @ViewChild('searchInput') searchInput!: ElementRef;
  is_searching: boolean=false;;
  currentGroup = { group_name: '' };
  showNewInput=false;
  fileError='';
  isThirdChild: boolean = false;
  showSearchBar = false;
  loading=false
  isSearching=false;
  isFocused=false;
/**
 *
 */
constructor(private fb:FormBuilder, private api:ApiService, private route:ActivatedRoute, private dialog:ConfirmDialogService,public auth:AuthenticationService) {
  const now = new Date();
    this.today = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD

  const depth = this.route.pathFromRoot.length; // Count the 
  this.isThirdChild = (depth === 5);
  
  if(auth.currentRestaurantRole?.restaurant_id){
    this.restaurant=auth.currentRestaurantRole?.restaurant_id;
    this.loadSections();
  }else  if(this.route.parent?.snapshot.params['id']){
    this.restaurant=this.route.parent?.snapshot.params['id'];
  this.loadRestaurant();
    this.loadSections();
  }


}
loadRestaurant(){
  this.api.get<RestaurantDetail>(null,'restaurant-setup/'+'details/',{id:this.restaurant,record:'restaurants'}).subscribe((x)=>{
    if(this.auth.currentRestaurantRole?.restaurant_id){
      this.auth.setCurrentRestaurant(x.data);
   
    }else{
     this.restaurant_profile=x.data as any;  
    }
  })
}
initCategory(rest:string){
  return this.fb.group({
    id:[''],
    name:[''],
    restaurant:[rest],
    description:[''],
 //   section_banner_image:[''],
    available:[true],
    has_groups:[false],
    groups:this.fb.array([])
  })
}
 initMenuItem(){
  return this.fb.group({
    id:[''],
    name:['',Validators.required],
    section:['',Validators.required],
    description:[''],
    section_group:[''],
    image:['',Validators.required],
    primary_price:[0,[Validators.min(1)]],
    has_discount: [false],  
    discount_details: this.fb.group({}),//this.InitDiscountObject(),
    available:[true],
    has_options:[false],
    options:this.fb.group({}),
    has_extras:[false],
    is_extra:[false],
    is_special:[false],
    extras_applicable:[[]],
    extras:[[]],
    allergens:[[]]
  },{ validator: this.validateForm })
 }
 toggleDiscountFields(event: any) {
  const isChecked = event.target.checked;
  const discountControlExists = this.ItemForm?.contains('discount_details');
  const discountValue = this.ItemForm?.get('discount_details')?.value;

  if (isChecked) {
    if (discountControlExists) {
      this.ItemForm?.removeControl('discount_details');
    }
   //if (!discountControlExists) {
      this.ItemForm?.addControl('discount_details', this.InitDiscountObject());
  // }
    this.ItemForm?.get('discount_details')?.patchValue(this.menu_item?.discount_details);
  } else {
    if (discountControlExists) {
      this.ItemForm?.removeControl('discount_details');
    }
    this.ItemForm?.addControl('discount_details', this.fb.group({}));
    //this.ItemForm?.get('discount_details')?.reset();
    this.ItemForm?.get('has_discount')?.setValue(false);
  }



   /*  const discountValue = this.ItemForm?.get('discount_details')?.value;
    if (
       Object.keys(discountValue).length === 0
    ) {
      console.log(event.target.checked)
      this.ItemForm?.addControl('discount_details', this.InitDiscountObject());
      if(this.menu_item?.discount_details){
        this.ItemForm?.get('discount_details')?.patchValue(this.menu_item.discount_details);
      }
    } */
   // this.ItemForm?.get('discount_details')?.patchValue(this.menu_item.discount_details || {});
/*   if (event.target.checked) {
    // Add discount_details group when checked
    this.ItemForm?.addControl('discount_details', this.InitDiscountObject());
    this.ItemForm?.get('discount_details')?.patchValue(this.menu_item.discount_details || {});
  } else {
    // Remove discount_details group when unchecked
    this.ItemForm?.removeControl('discount_details');
    this.ItemForm?.get('has_discount')?.setValue(false);
    this.ItemForm?.get('discount_details')?.reset();
    this.ItemForm?.get('discount_details')?.setValue({});

  } */
}
 validateForm(form: FormGroup) {
  const primaryPrice = form.get('discount_details.discount_amount')?.value;
  const discountPrice = form.get('primary_price')?.value;
  const startDate = form.get('discount_details.start_date')?.value;
  const endDate = form.get('discount_details.end_date')?.value;

  let errors: any = {};

  if (discountPrice && primaryPrice && discountPrice < primaryPrice) {
    errors.discountInvalid = true;
  }

  if (endDate && startDate && endDate < startDate) {
    errors.dateInvalid = true;
  }

  return Object.keys(errors).length ? errors : null;
}
 loadSections(id?:string,reloadItems?:boolean){
  this.api.get<MenuSectionListItem>(null,'restaurant-setup/menusections/',{restaurant:this.restaurant}).subscribe((x)=>{
        this.section_list =x?.data?.records  as MenuSectionListItem[]
    if(id){
this.section=x?.data?.records.filter((s:MenuSectionListItem)=>s.id==id)[0];
if(reloadItems){
  this.loadMenuItems(this.section as any,null as any,true);
 /*  this.menu_list =x?.data?.records;
  this.grouped_menu= groupBy<MenuItem,any>(this.menu_list as any[],l=> l?.group?.id)
  this.group_menu_keys = Object.keys(this.grouped_menu);
  this.section?.groups.forEach(sg=>{
    this.grouped_groups[sg.id]=sg;
  }) */
}
    }else{
      

    if(!this.section||reloadItems){
      this.section=this.section_list[0]
        this.loadMenuItems(this.section_list[0])
    }
    }
    
  })
 }
 
 ReconstructGroups(){
  this.group_menu_keys=[];

 }
 loadGroups(id?:any){
  if(id){
    this.has_groups=false;
    this.section_groups=[];
    let i=id.target.value;
   let s = this.section_list?.find(x=>x.id==i);
   
   this.has_groups=s?.has_groups as boolean;
   if(!this.has_groups){
    this.ItemForm?.get('section_group')?.patchValue('');
   }
  }
  this.api.get<any>(null,'restaurant-setup/sectiongroups/',{section:id? id.target.value:this.section?.id}).subscribe((x)=>{
    if(id){
this.section_groups=x?.data?.records as any[]
    }else{
    this.CategoryGroups.clear();
    x?.data?.records.forEach((g,i)=>{
      this.CategoryGroups.push(this.fb.group({group_name:'',id:''}))
      this.CategoryGroups.at(i).patchValue({group_name:g.name,id:g.id})
    });
    //(<FormArray>this.CategoryForm?.get('groups')).push(this.fb.group({group_name:''}))
  }
  })

 }

 SelectSection(s:any){
  if(s.id!=this.section?.id){
    //  this.section=s;
  this.menu_list=[];

  this.loadMenuItems(s)
  }

 }
 loadExtras(i:MenuItem){
  this.extra_list=[];
  this.api.get<MenuItem>(null,'restaurant-setup/menuitems/',{is_extra:true,restaurant:this.restaurant}).subscribe((x)=>{
    this.extra_list=x?.data?.records;
    if(i?.extras.length>0){
      this.temp_extra_list=[];
      this.temp_extra_list = (this.extra_list??[]).filter((ex:MenuItem)=>i.extras.some(exx=>ex.id==exx.id));
     this.ItemForm?.get('extras_applicable')?.setValue(this.temp_extra_list.map((x:MenuItem)=>x.id))
    }
 //   this.temp_extra_list=x?.data?.records as any;
//this.temp_extra=x?.data?.records[0];
  })
 }
 removeExtra(index: number) {
  if(confirm('Are you sure you want to remove this extra?')){
  const extras = this.ItemForm?.get('extras_applicable')?.value as string[];
  const extraId = this.temp_extra_list[index].id;
  const extraIndex = extras.indexOf(extraId);
  if (extraIndex > -1) {
    extras.splice(extraIndex, 1); // Remove ID from extras array
    this.ItemForm?.get('extras_applicable')?.setValue(extras);
  this.temp_extra_list.splice(index, 1); // Remove item from array
  }
  this.loadMenuItems(this.section as any);
}
}

 loadMenuItems(section:MenuSectionListItem,id?:string,reloadSections?:boolean){
  
    this.api.get<MenuItem>(null,'restaurant-setup/menuitems/',{section:section.id}).subscribe((x)=>{
          this.section=section;
    this.section.item_count=x?.data?.records.length??this.section.item_count;
      if(id){
  this.menu_item=x?.data?.records.filter((s:MenuItem)=>s.id==id)[0];
      }else{
        
        this.menu_list=[];
      this.menu_list =x?.data?.records;
      this.extra_list=x?.data?.records.filter((s:MenuItem)=>s.is_extra==true);
      this.grouped_menu= groupBy<MenuItem,any>(this.menu_list as any[],l=> l?.group?.id)
      this.group_menu_keys = Object.keys(this.grouped_menu);
      this.section?.groups.forEach(sg=>{
        this.grouped_groups[sg.id]=sg;
      })

    //  this.grouped_groups = groupBy(this.section?.groups as {id:any,name:any}[],gg=>gg.id);
     /*  this.section?.groups?.forEach(g=>{
       // g.items=gm[g.id]
      }) */
    }
    })

 }
 SectionAvailabilityChange(event:any,section:MenuSectionListItem,index:number){
 
  const confirmationRef = this.dialog.openModal({
    title: 'CONFIRMATION',
    message: `Are you sure you want to change the availability of ${section.name} to ${section.available ? 'available' : 'not available'}?`,
  }).subscribe((response: any) => {
    const isChecked = event.target.checked;

    if (response?.action === 'yes') {
      // Update the section availability
      this.api.postPatch('restaurant-setup/menusections/', {
        id: section.id,
        available: isChecked,
      }, 'put', '', {}, false,'',true).subscribe({
        next: () => {
          this.loadSections(); // Refresh the list of sections
          this.dialog.closeModal(); // Close the modal
          confirmationRef?.unsubscribe(); // Unsubscribe from the modal
        },
        error: (err) => {
          this.dialog.closeModal();
          confirmationRef?.unsubscribe();
        }
      });
    } else if (response?.action === 'no') {
      // Revert the toggle switch state
      this.section_list[index].available = !this.section_list[index].available;
      //this.loadSections(); // Refresh the list of sections
      this.dialog.closeModal();
      confirmationRef?.unsubscribe();
    }
  });

 }
  ItemAvailabilityChange(event:any,s:MenuItem,index:number,g?:any){
 
let ref =this.dialog.openModal(
  {
    title:'CONFIRMATION',
message:"Are you sure you want to change the availability of "+s.name+ " to <b>"+(s.available?"available":"not available") +"</b> ?",

}).subscribe((x:any)=>{
if(x?.action=='yes'){
  this.api.postPatch('restaurant-setup/menuitems/',{id:s.id,available:event.target.checked},'put','',{},false,'',true).subscribe({
    next: ()=>{
      this.loadMenuItems(this.section as any);
      this.loadSections();
this.dialog.closeModal();
ref?.unsubscribe();
    }
   
    //console.log(x)
  })
}
if(x?.action=='no'){
  if(!this.is_searching&&g){
  this.grouped_menu[g][index].available=!this.grouped_menu[g][index].available
  }
  if(this.search_list){
    this.search_list[index].available=!this.search_list[index].available
  }
 // this.loadMenuItems(this.section?.id as string);
/*  this.loadMenuItems(this.section?.id as string);
 this.loadSections(); */
 this.dialog.closeModal();
ref?.unsubscribe();
}
})

 }
 GroupAvailabilityChange(event:any,s:any,index:number,g:any){
  let ref =this.dialog.openModal(
    {
      title:'CONFIRMATION',
  message:"Are you sure you want to change the availability of "+s.name+ " to <b>"+(s.available?"available":"not available") +"</b> ?",
  }).subscribe((x:any)=>{
  if(x?.action=='yes'){
    this.api.postPatch('restaurant-setup/sectiongroups/',{id:s.id,available:event.target.checked},'put',null,{},false,'',true).subscribe({
      next: ()=>{

        /* this.loadSections();
        this.loadGroups(this.section?.id as string);
        this.loadMenuItems(this.section?.id as string); */
        this.ReconstructMenu(this.section,s);
  this.dialog.closeModal();
  ref?.unsubscribe();
      }
     
      //console.log(x)
    })
  }
  if(x?.action=='no'){
   // this.grouped_groups[s].available=!this.grouped_groups[s].available;
   // this.grouped_menu[g][index].available=!this.grouped_menu[g][index].available
   /* this.loadSections();
   this.loadGroups();
   this.loadMenuItems(this.section?.id as string); */
   this.grouped_groups[g].available=!this.grouped_groups[g]?.available;
//this.ReconstructMenu(this.section,s);
   this.dialog.closeModal();

  ref?.unsubscribe();
  }
  })
  
   }
toggleCategoryModal(){
  this.CategoryForm=this.initCategory(this.restaurant);

 this.CategoryForm.get('has_groups')?.valueChanges.subscribe(x=>{
  if(x=='true'){
(<FormArray>this.CategoryForm?.get('groups')).push(this.fb.group({group_name:''}))
  }
    if(x=='false'){
      this.CategoryGroups.clear();
    }
});
this.CategoryForm.get('')?.valueChanges.subscribe(x=>{
  if(x==true){
    let c = this.InitOptionObject();
this.CategoryForm?.get('options')?.setValue(c.value)
  }
})
  this.showModal=!this.showModal
}
EditSection(s:MenuSectionListItem){
  this.section=s;
  this.CategoryForm=this.initCategory(this.restaurant);
  this.CategoryForm.patchValue(s);
    this.CategoryGroups.reset();
  this.loadGroups();

 /*  if(!s.has_groups){
  this.CategoryForm.get('has_groups')?.valueChanges.subscribe(x=>{
    //console.log(x)
    if(x=='Yes'){
      if(this.CategoryGroups.length==0){
  (<FormArray>this.CategoryForm?.get('groups')).push(this.fb.group({group_name:''}))
      }else{
        this.loadGroups();
      }
  
    }
  }); 
  }*/

  this.showModal=!this.showModal
}
get CategoryGroups(){
  return<FormArray>this.CategoryForm?.get('groups')
}
AddGroup(){
 
  //let g = this.CategoryGroups.at(i).value;


}
SubmitGroup(){
  let g_obj={
    "section": this.section?.id,
    "name": this.currentGroup.group_name
}

/* */   this.api.postPatch('restaurant-setup/sectiongroups/',g_obj,'post',null,{},false,'',true).subscribe({
    next: ()=>{
      this.showNewInput=false;
      this.currentGroup.group_name='';
  //(<FormArray>this.CategoryForm?.get('groups')).push(this.fb.group({group_name:''}))
  this.loadGroups();
  }
});
}
EditGroup(gr:any){
this.CategoryGroupForm= this.fb.group({id:[''],name:['',Validators.required],available:[true]});
this.CategoryGroupForm.patchValue(gr);
this.showModal=!this.showModal
}
SaveGroupEdit(){
  this.api.postPatch('restaurant-setup/sectiongroups/',this.CategoryGroupForm?.value,'put',null,{},false,'',true).subscribe({
    next: ()=>{
      this.loadSections(undefined,true);
     // this.loadMenuItems(this.section?.id as string);
      
this.showModal=false;
this.CategoryGroupForm=null as any;
  }
});
}
Update(e:any,i:number){
 /* this.item_groups.splice(i,1,e.target.value) */
this.CategoryGroups.at(i).setValue({group_name:e.target.value})
}
SaveSection(){
  let image_field_type = typeof (this.CategoryForm?.get('section_banner_image')?.value)
  if(image_field_type=='string'){
    this.CategoryForm?.get('section_banner_image')?.setValue('');
  }
  let obj = this.CategoryForm?.value;
  let grps:any[]=(<FormArray>this.CategoryForm?.get('groups')).value;
  obj.groups=grps.map(x=>x.group_name)
      this.api.postPatch('restaurant-setup/menusections/',obj,this.CategoryForm?.get('id')?.value?'put':'post','',{},typeof (this.CategoryForm?.get('section_banner_image')?.value)=='string'?false:true,'',true).subscribe({
        next: ()=>{
  this.closeModal();
  this.loadSections();
        }
       
        //console.log(x)
      })
}
closeModal(){
  this.showModal = !this.showModal;
  this.ItemForm?.reset();
  this.CategoryForm?.reset();  
  this.CategoryForm=null as any;
  this.CategoryGroupForm=null as any;
  this.ItemForm=null as any;
  this.fileName='';
  this.imageURL='';
  this.fileError='';
  this.temp_extra='';
  this.temp_extra_list=[];
  //this.CategoryGroups.clear();
  this.active_tab=this.tabs_list[0];
  this.view_menu=false
  this.is_new=false;

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
  this.ItemForm.get('has_options')?.valueChanges.subscribe(x=>{
    if(x){
this.ItemForm?.setControl('options',this.InitOptionObject())
    }else{
      this.ItemForm?.removeControl('options');
      this.ItemForm?.get('options')?.setValue(null)
    }
  })
  this.showModal=!this.showModal
}
preventInvalidInput(event: KeyboardEvent) {
  if (['e', 'E', '-', '+'].includes(event.key)) {
    event.preventDefault();
  }
}
SaveMenuItem(){
  this.loading = true;
  const rawValues = this.ItemForm?.getRawValue();
  const method = this.ItemForm?.get('id')?.value ? 'put' : 'post';

  const imageField = rawValues.image;
  const imageFile = imageField?.file || imageField;

  const isImageFile = imageFile instanceof File;

  let payload: any = { ...rawValues };

  // If image is a File, keep it for FormData
  // Else remove image from JSON payload
  if (!isImageFile) {
    delete payload.image;
  }

  // Proceed to API Call
  this.api.postPatch(
    'restaurant-setup/menuitems/',
    payload,               // Pass full raw payload
    method,
    '',
    {},
    isImageFile,          // Let postPatch handle FormData
    '',
    true                  // Pass has_false if you want falsy values included
  ).subscribe({
    next: (x: any) => {
      this.imageURL = '';
this.loading=false;
      if (this.is_new || isImageFile) {
        // Remove image control after first upload
        this.ItemForm?.removeControl('image');
        this.ItemForm?.get('id')?.setValue(x?.data?.id);
        this.SaveMenuItem(); // Re-trigger for JSON update
        this.is_new = false;
      } else {
        this.closeModal();
        this.loadSections(this.section?.id as string, true);
      }
    },
    error: (err) => {
      this.loading=false;
    }
  });
 /* let image_field_type = typeof (this.ItemForm?.get('image')?.value)
  if(image_field_type=='string'){
    this.ItemForm?.removeControl('image');
  //  this.ItemForm?.get('image')?.setValue(null);
  }
///posting form data first
      this.api.postPatch('restaurant-setup/menuitems/',this.ItemForm?.value,this.ItemForm?.get('id')?.value?'put':'post','',{},image_field_type=='string'?false:true,'',true).subscribe({
        next: (x:any)=>{      
 
this.imageURL='';

if(this.is_new||image_field_type!='string'){
  this.ItemForm?.removeControl('image');
  this.ItemForm?.get('id')?.setValue(x?.data?.id) 
  //if new item post json data too
  this.SaveMenuItem()
  this.is_new=false;
}else{
   this.closeModal();
  //this.loadMenuItems(this.section?.id as string,);
  this.loadSections(this.section?.id as string,true);
}
        },
        error(err) {
          
        },
       complete: ()=> {
       
      }
        //console.log(x)
      })*/
}
SavePhoto(id:any,file:any){
  let ImgForm= this.fb.group({
    id:[''],
    image:['']
  })
  ImgForm.get('id')?.setValue(id);
  ImgForm.get('image')?.setValue(file);
  this.api.postPatch('restaurant-setup/menuitems/',ImgForm,'put','',{},true,'',true).subscribe({
    next: ()=>{
this.closeModal();
this.loadMenuItems(this.section as any);
this.loadSections();
this.imageURL='';
    }
   
    //console.log(x)
  })
}
InputItemImage($event:any){
  this.fileError = '';
  const file:File = $event.target.files[0];
  
  if (file) {
    const validImageTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!validImageTypes.includes(file.type)) {
      this.fileError = 'Only image files (JPG, PNG, GIF) are allowed.';
      $event.target.value = ''; // Clear the input if the file is invalid
    } else {
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
public removeItem(item: any): void {
  this.CategoryGroups.removeAt(item);
  //list.splice(list.indexOf(item), 1);
}
log(info:any,e:any){
}
public simpleList = [
  [
  'group1',
  'group2',
  'group3',
  ], 
  [
  'group4',
  'group5',
  'group6',
  ]
];

InitOptionObject(){
  return this.fb.group({
    min_selections: [1, [Validators.required, Validators.min(1), Validators.pattern('^[0-9]*$')]],
    max_selections: [1, [Validators.required, Validators.min(1), Validators.pattern('^[0-9]*$')]],
    options : this.fb.array([this.InitOptionItem()])
}, {
  validators: this.minLessThanMax('min_selections', 'max_selections')
})
}
minLessThanMax(minKey: string, maxKey: string) {
  return (group: AbstractControl) => {
    const min = group.get(minKey)?.value;
    const max = group.get(maxKey)?.value;
    return (min && max && min > max) ? { minGreaterThanMax: true } : null;
  };
}
InitDiscountObject(){
  return this.fb.group({
      recurring_days: [[]], 
      start_date: [''],
      end_date: [''],
/*       start_time: [''],
      end_time: [''], */
     // discount_percentage: 0.0,
      discount_amount: [0.0]
  })
}
validateDiscountPrice(form: FormGroup) {
  const primaryPrice = form.get('primary_price')?.value;
  const discountPrice = form.get('discount_details.discount_amount')?.value;

  return discountPrice && primaryPrice && discountPrice > primaryPrice 
    ? { discountInvalid: true } 
    : null;
}

SetRecurDay(id:number,val:any){

let disc:any[] = this.ItemForm?.get('discount_details')?.get('recurring_days')?.value??[];

if(val.checked){
disc.push(id);
this.ItemForm?.get('discount_details')?.get('recurring_days')?.setValue(disc);
}else{
  if(disc.includes(id)){
    let pos =disc.indexOf(id)
    disc.splice(pos,1);
    this.ItemForm?.get('discount_details')?.get('recurring_days')?.setValue(disc);
  }
}
}

InitOptionItem(){
  return this.fb.group({
    name: ['',Validators.required],
   selectable: [false],// i.e. does it have options to select from
   choices: [[]],//[Spicy, Not spicy, Extra spicy],
       cost: [0],
       required:[false],
       max_choices:[1, [Validators.min(1), Validators.pattern('^[0-9]*$')]],
   }
  )
}
 get Gos():FormArray{
  let g=<FormGroup> this.ItemForm?.get('options');
  
  return <FormArray>g?.get('options')
}
AddOption(){
  this.Gos.push(this.InitOptionItem())
}

RemoveOption(i:number){
this.Gos.removeAt(i)
}
EditItem(i:MenuItem){
  this.loadExtras(i);
  this.ItemForm=this.initMenuItem();
  this.ItemForm.get('has_options')?.valueChanges.subscribe(x=>{
   // console.log("has options",x)
    if(x){
this.ItemForm?.setControl('options',this.InitOptionObject())
    }else{
      if(i.has_options){
        this.Gos.controls.forEach((ioo,io)=>{
          this.Gos?.removeAt(io)
        })
      }
      this.ItemForm?.get('options')?.reset();
      this.ItemForm?.removeControl('options');
      this.ItemForm?.addControl('options',this.fb.group({}))
      //this.ItemForm?.get('options')?.setValue({});
      /*  */
    }
  })
i.has_discount=(Object.keys(i.discount_details).length > 0)
  // Handle discount details dynamically
   if (i.discount_details && Object.keys(i.discount_details).length > 0) {
    this.ItemForm?.removeControl('discount_details');
      this.ItemForm?.addControl('discount_details', this.InitDiscountObject());
   // this.ItemForm.addControl('discount_details', this.InitDiscountObject());
  } else {
   // this.ItemForm.removeControl('discount_details');
    this.ItemForm.get('discount_details')?.setValue({});
  }
/* // Ensure the control exists before patching
if (i.has_discount) {
  this.ItemForm.addControl('discount_details', this.InitDiscountObject());
} else if (!i.has_discount) {
  // Optional: reset instead of removing if you want to persist empty object
  this.ItemForm.get('discount_details')?.reset();
} */


this.ItemForm?.patchValue(i);
this.ItemForm.get('section')?.setValue(this.section?.id);
if(i.group?.id){
  this.api.get<any>(null,'restaurant-setup/sectiongroups/',{section:this.section?.id}).subscribe((x)=>{
  
this.section_groups=x?.data?.records as any[];  
  this.ItemForm?.get('section_group')?.setValue(i.group.id)
  this.has_groups=true;
})
}
if(i.has_options){
 
  i?.options?.options?.forEach((ioo,io)=>{
   
    if(io>0){
      this.AddOption();
    }
    this.Gos.at(io).patchValue(ioo);
  })
}
i.has_extras=i?.extras?.length>0?true:false;
this.ItemForm?.get('has_extras')?.setValue(i.has_extras);




this.showModal=!this.showModal
}
InitItemFormEdit(){
  
}
typOf(val:any){
  return typeof val
} 

AddChoice(f:any,id:number){
let choice_array:any[]=f.get('choices')?.value?f.get('choices')?.value:[];
var ch = (<HTMLInputElement>document.getElementById('choice-'+id)).value;
if(ch){
choice_array.push(ch);
//console.log(choice_array);
(<HTMLInputElement>document.getElementById('choice-'+id)).value='';
f.get('choices')?.patchValue(choice_array);
}
}
DeleteChoice(i:number,ci:number){
  let v= this.Gos.at(i);
let choices_:any[]=v.get('choices')?.value;
choices_.splice(ci,1);
v.get('choices')?.patchValue(choices_);
}
LoadExtra(event:any){
this.temp_extra=event;
}
AddExtra(){ 
let extras:any[]=this.ItemForm?.get('extras_applicable')?.value?this.ItemForm?.get('extras_applicable')?.value:[];
 if(this.temp_extra){
  extras.push(this.temp_extra.id);
  this.temp_extra_list.push(this.temp_extra)
  this.ItemForm?.get('extras_applicable')?.setValue(extras);
  let input:any = document.querySelector("#autocompleteInput");
  input.value = '';
  this.temp_extra='';
}

}
ApproveMenu(status:any){
  let ref = this.dialog.openModal({
    title:status.toUpperCase(),
    message:'Are you sure you want to <b>'+status.toUpperCase()+'</b> the <b>MENU</b>?',
    has_reason:true,
    cancelButtonText:'Cancel',
    submitButtonText: status
  })?.subscribe((x:any)=>{
  
    if(x?.action=='yes'){
      
   let o =   {
        "restaurant": this.restaurant,
        "decision": status,
        "reason": x?.reason
    } 
/**/      this.api.postPatch('restaurant-setup/manager-actions/first-time-menu-review/',o,'post').subscribe({
          next: (x:any)=>{
            if(x?.status==200){
     this.loadRestaurant();
      this.dialog.closeModal();
      ref.unsubscribe();
            }
            if(x?.status==401){
              alert(x.message)
              this.dialog.closeModal()
              ref.unsubscribe();
            }
            if(x?.status==400){
              this.loadRestaurant();
              this.dialog.closeModal();
              ref.unsubscribe();
            }
          },
          error(err) {
            alert(err)
          },
        }); 
         
        }
        if(x?.action=='no'||x?.action=='reject'){
          this.dialog.closeModal();
      ref.unsubscribe();
        }
    
  })
}


AddAllergen(val:any){
  if(val){
 let alls:any[]=this.ItemForm?.get('allergens')?.value;  
 alls.push(val);
 this.ItemForm?.get('allergens')?.setValue(alls);
 let input:any = document.querySelector("#allergenfield");
  input.value = '';
  }

}
DeleteAllergen(i:number){
  let alls:any[]=this.ItemForm?.get('allergens')?.value;  
  alls.splice(i,1)
  this.ItemForm?.get('allergens')?.setValue(alls);
}

toggleSearch() {
  this.isExpanded = true;
  setTimeout(() => this.searchInput?.nativeElement?.focus(), 100);
}
has_loaded=false;
onSearch() {
  this.search_list=[];
  this.isSearching=true;
 // this.is_searching=true;
  this.has_loaded=false;
  if (this.searchQuery.trim()) {
   // this.search.emit(this.searchQuery);
   this.api.get<MenuItem>(null,'restaurant-setup/menuitems/',{name:this.searchQuery, restaurant: this.restaurant}).subscribe((x)=>{
   // this.isExpanded=false;
//this.menu_item=x?.data?.records[0];

this.search_list =x?.data?.records;
this.has_loaded=true;
 this.isSearching = false;   
  })
}
  //this.isExpanded = false; // Hide after searching
}

closeSearch(event: Event) {
  
  if (this.isExpanded && !(event.target as HTMLElement).closest('.absolute')) {
    this.isExpanded = false;
  }
}
DeleteSection(section:MenuSectionListItem){
    let ref = this.dialog.openModal({
      title:'Delete',
      has_reason:true,
      submitButtonText:'Delete',
      cancelButtonText:'Cancel',
      reason_required:true,
      //action_info:'This table will no longer be available for booking',
      message:'Are you sure you want to <strong>Delete</strong> Menu Section - '+section.name +'?<br>Deleting this section also deletes all groups and items within it.<br> Please provide the reason for deleting the section',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.Delete('restaurant-setup/menusections/',{id:section.id,deletion_reason:x?.reason}).subscribe({
          next: ()=>{
      //this.save.emit(x)
      this.loadSections(null as any,true);
      this.dialog.closeModal();
      ref.unsubscribe();
          },
          error:(err)=>{
           // alert(err)
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

  DeleteItem(menuItem:MenuItem,grouped_menu_index:number,itemIndex:number){
    let ref = this.dialog.openModal({
      title:'Delete',
      has_reason:true,
      submitButtonText:'Delete',
      cancelButtonText:'Cancel',
      reason_required:true,
      //action_info:'This table will no longer be available for booking',
      message:'Are you sure you want to <strong>Delete</strong> Menu Item - '+menuItem.name +'? <br> Please provide the reason for deleting the item',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.Delete('restaurant-setup/menuitems/',{id:menuItem.id,deletion_reason:x?.reason}).subscribe({
          next: ()=>{
      //this.save.emit(x)
      setTimeout(() => {
        const groupKey = this.group_menu_keys[grouped_menu_index];
        this.grouped_menu[groupKey].splice(itemIndex,1);
      //this.loadMenuItems(this.section?.id as any);
      }, 1000);
      this.dialog.closeModal();
      ref.unsubscribe();
          },
          error:(err)=>{
           // alert(err)
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
  DeleteSectionGroup(section_group:any){
    /* console.log(section_group)
    let prevShowModal= this.showModal;
    if(this.showModal){
      this.showModal=false;
    } */
    let ref = this.dialog.openModal({
      title:'Delete',
      has_reason:true,
      submitButtonText:'Delete',
      cancelButtonText:'Cancel',
      reason_required:true,
      //action_info:'This table will no longer be available for booking',
      message:'Are you sure you want to <strong>Delete</strong> Menu Group - '+section_group.name +'? <br> Please provide the reason for deleting the group',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.Delete('restaurant-setup/sectiongroups/',{id:section_group.id,deletion_reason:x?.reason}).subscribe({
          next: ()=>{
            this.ReconstructMenu(this.section,section_group);
      //this.save.emit(x)
     /* this.loadGroups();
     this.loadSections(this.section?.id as string,true); */
      this.dialog.closeModal();
      ref.unsubscribe();
/* if(prevShowModal){
  this.showModal=true;
} */
          },
          error:(err)=>{
           // alert(err)
          }
        });
        //this.dialog.closeModal();
      }
      if(x?.action=='no'||x?.action=='reject'){
        
      //  this.loadGroups();
    /*  this.loadSections(this.section?.id as any,true);
      this.loadMenuItems(this.section?.id as any);*/
        this.dialog.closeModal();
        ref?.unsubscribe();
       /*  if(prevShowModal){
          this.showModal=true;
        } */
      }      
    });  
  }
  ReconstructMenu(section?:MenuSectionListItem,group?:any,menu?:MenuItem){
    this.api.get<MenuSectionListItem>(null,'restaurant-setup/menusections/',{restaurant:this.restaurant}).subscribe((x)=>{
      if(section){
  this.section=x?.data?.records.filter((s:MenuSectionListItem)=>s.id==section.id)[0];
      }else{
        this.section=x?.data?.records[0]
      }    
    
  if(this.section?.has_groups){
    this.api.get<any>(null,'restaurant-setup/sectiongroups/',{section:this.section?.id}).subscribe((gx)=>{
      this.section_groups=gx?.data?.records as any[];
      if(group){
  //this.section_groups=gx?.data?.records.filter((s:MenuSectionListItem)=>s.id==group.id)[0];
  }else{
   // this.section_groups=gx?.data?.records.filter((s:MenuSectionListItem)=>s.id==group.id)[0];
  }
  
  this.api.get<MenuItem>(null,'restaurant-setup/menuitems/',{section:this.section?.id}).subscribe((mx)=>{

    if(menu){
      this.menu_item=mx?.data?.records.filter((s:MenuItem)=>s.id==menu.id)[0];
    }else{
      this.menu_list=[];
      this.menu_list =mx?.data?.records;
      this.extra_list=mx?.data?.records.filter((s:MenuItem)=>s.is_extra==true);
      this.grouped_menu= groupBy<MenuItem,any>(this.menu_list as any[],l=> l?.group?.id)
      this.group_menu_keys = Object.keys(this.grouped_menu);
      this.section?.groups.forEach(sg=>{
        this.grouped_groups[sg.id]=sg;
      })
    }
    
   // this.section_groups=x?.data?.records.filter((s:MenuSectionListItem)=>s.id==group.id)[0];
  });
});
  }
});
  }

  getAvailableStatus(groupKey: string): boolean {
    return this.grouped_groups[groupKey]?.available || false;
  }
  drop(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.section_list, event.previousIndex, event.currentIndex);
    
    // Update listing_position based on new order
    this.section_list.forEach((section, index) => {
      section.listing_position = index + 1;
    });

    // Submit new order to the backend
    this.submitNewOrder();
  }
  
  submitNewOrder() {
    const updatePayload = this.section_list.map(section => section.id)/* {
      id: section.id,
      listing_position: section.listing_position
    } );*/

    this.api.postPatch('restaurant-setup/reorder-menu-items/',{'ordering':updatePayload}, 'put')
      .subscribe({
        next: () => {
        },
        error: (err) => {
        }
      });
  }
}


const groupBy = <T, K extends keyof any>(arr: T[], key: (i: T) => K) =>
  arr.reduce((groups, item) => {
    (groups[key(item)] ||= []).push(item);
    return groups;
  }, {} as Record<K, T[]>);
