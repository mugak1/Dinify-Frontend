import { Component, ElementRef, Input, ViewChild } from '@angular/core';
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
@Input() height?:string;
@Input() imgclass?:string;
@Input() container?:boolean
url=environment.apiUrl

@ViewChild('imageElement') imageElement?: ElementRef;
@ViewChild('imageElement') imageElementContainer?: ElementRef;
  loaded: boolean = false;

  private observer?: IntersectionObserver;

  ngAfterViewInit() {
    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        this.loaded = true;
        this.observer?.unobserve(entry.target);
      }
    });
  
    if (this.container && this.imageElementContainer?.nativeElement) {
      this.observer.observe(this.imageElementContainer.nativeElement);
    } else if (this.imageElement?.nativeElement) {
      this.observer.observe(this.imageElement.nativeElement);
    } else {
    }
  }
  
  ngOnDestroy() {
    
    this.observer?.disconnect();
  }
}
