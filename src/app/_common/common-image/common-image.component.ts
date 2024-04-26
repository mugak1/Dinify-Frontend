import { Component, Input } from '@angular/core';
import {environment} from '../../../environments/environment'

@Component({
  selector: 'app-common-image',
  templateUrl: './common-image.component.html',
  styleUrls: ['./common-image.component.css']
})
export class CommonImageComponent {
@Input() src?:string;
@Input() alt?: string;
@Input() width?:string;
url=environment.apiUrl
}
