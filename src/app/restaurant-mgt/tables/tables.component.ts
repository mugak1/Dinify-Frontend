import { DOCUMENT, Location } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormGroup, FormBuilder, Validators } from '@angular/forms';
import { SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { DiningArea, DiningAreaTable, GroupedTableAreas, TableListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { Buffer } from 'buffer';
import * as JSLZString from 'lz-string';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';

@Component({
  selector: 'app-tables',
  templateUrl: './tables.component.html',
  styleUrls: ['./tables.component.css']
})
export class TablesComponent {
  showModal = false;
  detailModal=false;
  rest?:any;
  TableForm!:FormGroup;
  DiningAreaForm!:FormGroup;
  TableEditForm!:FormGroup;
  is_submitted=false;
  fileName='';
  list?:GroupedTableAreas[]=[];
  restaurant: any;
  enc_restaurant:any='';
bsref='';

public qrCodeDownloadLink: SafeUrl = "";
areas: string[] = ['Main Hall', 'VIP Section']; // Example: List of areas
isSingleArea = false;

  /**
   *
   */
  constructor(private auth:AuthenticationService, private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute,@Inject(DOCUMENT) private document: Document, private dialog:ConfirmDialogService) {
    if(auth.currentRestaurantRole?.restaurant_id){
      this.restaurant=auth.currentRestaurantRole?.restaurant_id;
      this.enc_restaurant=btoa(this.restaurant)
        this.loadAreas(); 
    }else 
    if(this.route.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.snapshot.params['id'];
      this.enc_restaurant=btoa(this.restaurant)
        this.loadAreas(); 
    }
this.bsref=this.document.location.origin;
//this.CreateTable5();
  }
  
  toggleModal(val?:any,view_detaail?:boolean,area?:DiningArea){
    if(view_detaail){
this.detailModal=true;
this.rest=val;
    }else{

    if(val){
      this.TableEditForm=this.initTableForm()
      val.dining_area=area?.id;
      this.TableEditForm.patchValue(val);    
    }else{
           this.TableForm=this.initSectionTableForm();   
    }  
    }
    this.showModal = !this.showModal;  
  }
  typOf(val:any){
    return typeof val
  }
  closeModal(){
    this.rest=undefined;
    this.TableForm=null!;
    this.TableEditForm=null!;
    this.DiningAreaForm=null!;
    if(this.detailModal){this.detailModal=false;}    
    this.showModal = !this.showModal;
  }
  initTableForm(){
return this.fb.group({
  id:[''],
  restaurant:[this.restaurant],
  number:['',[Validators.required,Validators.pattern('^[1-9]\\d*$'),Validators.min(1)]],
  //room_name:[''],
  prepayment_required:[''],
  "outdoor_seating": [true],
  smoking_zone:[true],
  available:[true],
dining_area:[''],
})
  }
  onAreaModeChange(mode: string) {
    this.isSingleArea = mode === 'single';
  
    if (this.isSingleArea) {
      // Set the default area if only one area exists
      //this.areas.patchValue({ room_name: this.areas[0] });
      this.DiningAreaForm.patchValue({name:this.areas[0]})
    } else {
      // Clear the room_name when switching to multiple areas
      this.DiningAreaForm.patchValue({ name: '' });
    }
  }
  initSectionTableForm(){
    return this.fb.group({
      id:[''],
      restaurant:[this.restaurant],
      number:[''],
      name:[''],
      prepayment_required:[''],
      smoking_zone:[true],
      outdoor_seating:[true],
      "consideration": ["range"],
      available:[true],
      start:['',Validators.required],
      end:['',Validators.required]
    })
      }

  CreateTable5(){
    this.TableForm=this.initTableForm();
    this.TableForm.patchValue({"restaurant":"bb6ee380-0b1d-4061-b3a2-ca6fb5e9e258","number":"6","room_name":"Non Smoking Zone","available":true});
    this.Save();
  }
 
  Save(){

    this.api.postPatch('restaurant-setup/tables/',this.TableForm.value,this.TableForm.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{
        let ind = this.list?.filter(x=>x.dining_area.id==this.TableForm.get('dining_area')?.value)
        if(ind&&this.list){
          // ind[0].tables.push(this.TableForm.value)
          
           
           this.closeModal();
this.loadAreas(null as any,this.list?.indexOf(ind[0]));
//this.list[ as number].isCollapsed=false;
          // this.list?.indexOf(ind[0])
          // console.log(this.list?.indexOf(ind[0]))
         }




      
//this.list?.indexOf(x=>x.id==this.TableForm.get('dining_area')?.value)
      },
     error:(err)=>{

      alert(err)
     }
      //console.log(x)
    })
  }
  SaveSections(){

    this.api.postPatch(this.TableForm.get('id')?.value?'restaurant-setup/tables/':'restaurant-setup/section-tables/',this.TableForm.value,this.TableForm.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{
this.closeModal();
this.loadTables();
      },
     error:(err)=>{

      alert(err)
     }
      //console.log(x)
    })
  }
  ask_multiple:boolean=false;
  loadTables(id?:string){
    
    this.api.get<any>(null,'restaurant-setup/tables/',{restaurant:this.restaurant}).subscribe((x)=>{
      if(id){
this.rest=x?.data?.records[0];
this.showModal!=this.showModal;
      }else{
      this.list=x?.data?.records  
      // Extract all distinct names
const distinctNames = new Set(this.list?.map(item => item.dining_area.name));

// Count distinct items
const countDistinct = distinctNames.size;
      if(this.list?.length==0&&countDistinct>1){
this.ask_multiple=true;

      }
      }
      
    })
  }
  loadNullAreas(id?:string,openIndex?:number){
    
    this.api.get<any>(null,'restaurant-setup/diningareas/',{restaurant:this.restaurant}).subscribe((x)=>{
      if(id){
/* this.rest=x?.data?.records[0];
this.showModal!=this.showModal; */
      }else{
      this.list=x?.data?.records.map(area => ({ ...area, isCollapsed: x?.data?.records.length==1? (false):true }));
      if(openIndex&&this.list){
        this.list[openIndex].isCollapsed=false;
      }


      }
      
    })
  }
  loadAreas(id?:string,openIndex?:number){
    
    this.api.get(null,'restaurant-setup/tables/',{restaurant:this.restaurant,grouping:'areas'}).subscribe((x)=>{
      if(id){
/* this.rest=x?.data?.records[0];
this.showModal!=this.showModal; */
      }else{
        let d :any[] =x?.data as any;
      this.list=d.map(area => ({ ...area, isCollapsed: d.length==1? (false):true }));
      if(openIndex&&this.list){
        this.list[openIndex].isCollapsed=false;
      }


      }
      
    })
  }
  onChangeURL(url: SafeUrl) {
    this.qrCodeDownloadLink = url;
  }
  DeleteTable(table:DiningAreaTable,areaIndex:number){
    let ref = this.dialog.openModal({
      title:'Delete',
      has_reason:true,
      submitButtonText:'Delete',
      cancelButtonText:'Cancel',
      reason_required:true,
      //action_info:'This table will no longer be available for booking',
      message:'Are you sure you want to <strong>Delete</strong> Table No. '+table.number +'? <br> Please provide the reason for deleting the table',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.Delete('restaurant-setup/tables/',{id:table.id,deletion_reason:x?.reason}).subscribe({
          next: ()=>{
      //this.save.emit(x)
      this.loadAreas(null as any,areaIndex);
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
  NewArea(){
    this.isSingleArea = false;
    this.DiningAreaForm=this.initArea();
          // Extract all distinct names
const distinctNames = new Set(this.list?.map(item => item.dining_area.name));

// Count distinct items
const countDistinct = distinctNames.size;
      if(this.list?.length==0){
this.ask_multiple=true;


      }else if (this.list?.length as number>1&&countDistinct>1){
        this.ask_multiple=true;
      }else{
        this.ask_multiple=false;
      }
    this.showModal = !this.showModal;  
  }
  initArea(){
    return this.fb.group({
      restaurant:[this.restaurant,Validators.required],
      name:['',Validators.required],
      description:['',Validators.required],
      outdoor_seating:[true],
      smoking_zone:[true],
      available:[true],
      create_tables: [true],
    consideration: ["range"],
      start:['',[Validators.required,Validators.pattern('^[1-9]\\d*$')]],
      end:['',[Validators.required,Validators.pattern('^[1-9]\\d*$')]]
      //tables:this.fb.array([])
    })
  }
  preventInvalidInput(event: KeyboardEvent) {
    if (['e', 'E', '-', '+'].includes(event.key)) {
      event.preventDefault();
    }
  }

  diningAreas = [
    {
      restaurant: "c491d360-3f56-41b1-8fbe-b1b1989c1528",
      name: "Main Hall",
      description: "The main dining area for regular guests.",
      outdoor_seating: false,
      smoking_zone: false,
      tables: [
        { name: "Table 1", outdoor: false, smokingArea: false },
        { name: "Table 2", outdoor: false, smokingArea: true },
        { name: "Table 3", outdoor: true, smokingArea: false }
      ]
    },
    {
      restaurant: "c491d360-3f56-41b1-8fbe-b1b1989c1528",
      name: "Patio",
      description: "Outdoor seating with fresh air.",
      outdoor_seating: true,
      smoking_zone: true,
      tables: [
        { name: "Table 4", outdoor: true, smokingArea: true },
        { name: "Table 5", outdoor: true, smokingArea: false }
      ]
    },
    {
      restaurant: "c491d360-3f56-41b1-8fbe-b1b1989c1528",
      name: "VIP Lounge",
      description: "Exclusive area for VIP guests.",
      outdoor_seating: false,
      smoking_zone: false,
      tables: [
        { name: "Table 6", outdoor: false, smokingArea: false }
      ]
    }
  ];

  addTable(areaIndex: number,area:DiningArea) {
    this.TableForm=this.initTableForm();
    this.TableForm.patchValue({dining_area:area.id})
    if(this.list&&this.list[areaIndex].isCollapsed){
    this.list[areaIndex].isCollapsed=false;
    }
    this.showModal = !this.showModal;
/*     const newTable = {
      name: `Table ${this.diningAreas[areaIndex].tables.length + 1}`,
      outdoor: this.diningAreas[areaIndex].outdoor_seating,
      smokingArea: this.diningAreas[areaIndex].smoking_zone
    }; */
   // this.diningAreas[areaIndex].tables.push(newTable);
  }

  removeTable(areaIndex: number, tableIndex: number) {
    this.diningAreas[areaIndex].tables.splice(tableIndex, 1);
  }
  onSubmitArea(){
    this.api.postPatch('restaurant-setup/diningareas/',this.DiningAreaForm.value,this.DiningAreaForm.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{
this.closeModal();
this.loadAreas();
      },
     error:(err)=>{
      alert(err)
     }
      //console.log(x)
    })
  }

}
