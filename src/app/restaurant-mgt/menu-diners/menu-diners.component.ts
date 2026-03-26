import { Component, Input, OnInit } from '@angular/core';
import { MenuItem, MenuSectionListItem } from 'src/app/_models/app.models';

@Component({
    selector: 'app-menu-diners',
    templateUrl: './menu-diners.component.html',
    styleUrl: './menu-diners.component.css',
    standalone: false
})
export class MenuDinersComponent implements OnInit{
  @Input() section_list!:MenuSectionListItem[];
@Input() menu_list?:MenuItem[]=[];
@Input() group_menu_keys?:string[];
@Input() grouped_groups?:any;
@Input() grouped_menu?:any;
section?:MenuSectionListItem|undefined;
constructor() {
 
  
}
ngOnInit(): void {
  this.section=this.section_list[0]
}
}
