import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommonImageComponent } from './common-image/common-image.component';



@NgModule({
  declarations: [CommonImageComponent],
  exports:[CommonImageComponent],
  imports: [
    CommonModule    
  ]
})
export class DinifyCommonModule { }
