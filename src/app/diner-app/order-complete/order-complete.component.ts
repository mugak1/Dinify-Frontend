import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-order-complete',
    templateUrl: './order-complete.component.html',
    styleUrl: './order-complete.component.css',
    standalone: false
})
export class OrderCompleteComponent {
/**
 *
 */
isDinerApp=true;
constructor(private router:Router) {
 this.isDinerApp=!this.router.url.includes('tables')
}
 
  
}
