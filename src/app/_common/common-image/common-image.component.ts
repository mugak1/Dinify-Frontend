import { Component, ElementRef, Input, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import {environment} from '../../../environments/environment'

@Component({
    selector: 'app-common-image',
    templateUrl: './common-image.component.html',
    styleUrls: ['./common-image.component.css'],
    standalone: false
})
export class CommonImageComponent implements AfterViewInit, OnDestroy {
@Input() src?:string;
@Input() alt?: string;
@Input() width?:string;
@Input() height?:string;
@Input() imgclass?:string;
@Input() container?:boolean
url=environment.apiUrl

@ViewChild('imageElement') imageElement?: ElementRef;
@ViewChild('imageElementContainer') imageElementContainer?: ElementRef;
  loaded: boolean = false;

  private observer?: IntersectionObserver;

  ngAfterViewInit() {
    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        this.loaded = true;
        this.observer?.unobserve(entry.target);
      }
    }, { rootMargin: '200px' });

    if (this.container && this.imageElementContainer?.nativeElement) {
      this.observer.observe(this.imageElementContainer.nativeElement);
    } else if (this.imageElement?.nativeElement) {
      this.observer.observe(this.imageElement.nativeElement);
    }
  }
  
  ngOnDestroy() {
    
    this.observer?.disconnect();
  }
}
