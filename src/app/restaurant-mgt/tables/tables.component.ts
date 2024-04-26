import { DOCUMENT, Location } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormGroup, FormBuilder } from '@angular/forms';
import { SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { TableListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { Buffer } from 'buffer';
import * as JSLZString from 'lz-string';

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
  is_submitted=false;
  fileName='';
  list?:TableListItem[]=[];
  restaurant: any;
  enc_restaurant:any='';
bsref='';

public qrCodeDownloadLink: SafeUrl = "";

  /**
   *
   */
  constructor(private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute,@Inject(DOCUMENT) private document: Document) {
    if(this.route.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.snapshot.params['id'];
      this.enc_restaurant=btoa(this.restaurant)
        this.loadTables(); 
    }
this.bsref=this.document.location.origin;
  }
  
  toggleModal(val?:any,view_detaail?:boolean){
    if(view_detaail){
this.detailModal=true;
this.rest=val;
    }else{
        this.TableForm=this.initTableForm();
    if(val){
      this.TableForm.patchValue(val);
      
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
    if(this.detailModal){this.detailModal=false;}    
    this.showModal = !this.showModal;
  }
  initTableForm(){
return this.fb.group({
  id:[''],
  restaurant:[this.restaurant],
  number:[''],
  room_name:[''],
  prepayment_required:[''],
  smoking_zone:[],
  available:[true]
})
  }

 
  Save(){

    this.api.postPatch('restaurant-setup/tables/',this.TableForm.value,this.TableForm.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{
this.closeModal();
this.loadTables();
      }
     
      //console.log(x)
    })
  }
  loadTables(id?:string){
    
    this.api.get<any>(null,'restaurant-setup/tables/').subscribe((x)=>{
      if(id){
this.rest=x?.data?.records[0];
this.showModal!=this.showModal;
      }else{
      this.list=x?.data?.records  
      }
      
    })
  }
  onChangeURL(url: SafeUrl) {
    this.qrCodeDownloadLink = url;
  }
}
